/**
 * Normalization pipeline.
 *
 * For each raw session (from the index DB), produce:
 *   - metadata.json
 *   - turns.jsonl  (append-only, idempotent via offset tracking)
 *   - files.json
 *   - timeline.json
 *
 * Safe to run repeatedly – already-processed offsets are skipped.
 */

import fs from 'node:fs';
import readline from 'node:readline';
import path from 'node:path';
import { getLogger } from '../logger.js';
import {
  writeMetadata,
  appendTurns,
  writeFileEvents,
  writeTimeline,
  readMetadata,
  countExistingTurns,
  readTimeline,
  type NormalizedTurn,
  type TimelineEvent,
  type SessionMetadata,
} from './sessionStore.js';
import type { SessionRow } from '../db.js';

const MAX_CONTENT_CHARS = 2000;

// ── Entry point ───────────────────────────────────────────────────────────────

export async function normalizeSession(row: SessionRow, machineId: string): Promise<void> {
  const log = getLogger();
  try {
    await _normalize(row, machineId);
  } catch (err) {
    log.warn({ err, sessionId: row.id }, 'Normalization failed (non-fatal)');
  }
}

async function _normalize(row: SessionRow, machineId: string): Promise<void> {
  const filePath = row.file_abs_path;
  if (!fs.existsSync(filePath)) return;

  const kind = resolveKind(row.kind);
  const meta: SessionMetadata = {
    sessionId: row.id,
    source: row.source as SessionMetadata['source'],
    createdAt: readMetadata(row.id)?.createdAt ?? new Date(row.updated_at_ms).toISOString(),
    updatedAt: new Date(row.updated_at_ms).toISOString(),
    projectHint: row.project_hint,
    originalFile: filePath,
    machineId,
    kind,
  };
  writeMetadata(meta);

  const existingCount = await countExistingTurns(row.id);
  const newTurns = await extractTurns(row, existingCount);
  appendTurns(row.id, newTurns);

  // rebuild timeline from all turns
  const allTurns = existingCount > 0
    ? [...(await loadAllTurns(row.id, existingCount)), ...newTurns]
    : newTurns;
  const timeline = buildTimeline(allTurns, row);
  writeTimeline(row.id, timeline);

  // files.json – best-effort from timeline events
  const fileEvents = timeline
    .filter((e) => e.type === 'file_edit' || e.type === 'file_create' || e.type === 'file_delete')
    .map((e) => ({
      path: e.file ?? '',
      operation: (e.type === 'file_create' ? 'create' : e.type === 'file_delete' ? 'delete' : 'edit') as 'edit' | 'create' | 'delete',
      timestamp: e.timestamp,
      tool: e.tool,
    }));
  writeFileEvents(row.id, fileEvents);
}

// ── Turn extraction ───────────────────────────────────────────────────────────

async function extractTurns(row: SessionRow, skipCount: number): Promise<NormalizedTurn[]> {
  const ext = path.extname(row.file_abs_path).toLowerCase();
  const source = row.source;

  if (ext === '.jsonl') return extractJsonlTurns(row, skipCount);
  if (ext === '.json') return extractJsonTurns(row, skipCount);
  if (ext === '.log') return extractLogTurns(row, skipCount);
  // DB / snapshot files: metadata-only entry
  if ((ext === '.db' || ext === '.sqlite' || ext === '.vscdb') && skipCount === 0) {
    return [makeMetaTurn(row)];
  }
  return [];
}

async function extractJsonlTurns(row: SessionRow, skipCount: number): Promise<NormalizedTurn[]> {
  const turns: NormalizedTurn[] = [];
  let offset = 0;
  let skippedTurns = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(row.file_abs_path),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const byteLen = Buffer.byteLength(line, 'utf8') + 1;

    if (!line.trim()) { offset += byteLen; continue; }

    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const turn = parseTurnObject(obj, row.source, row.file_abs_path, offset);
      if (turn) {
        if (skippedTurns < skipCount) {
          skippedTurns++;
        } else {
          turns.push(turn);
        }
      }
    } catch { /* skip bad lines */ }

    offset += byteLen;
  }

  return turns;
}

async function extractJsonTurns(row: SessionRow, skipCount: number): Promise<NormalizedTurn[]> {
  let raw: string;
  try {
    const stat = fs.statSync(row.file_abs_path);
    if (stat.size > 10 * 1024 * 1024) return skipCount === 0 ? [makeMetaTurn(row)] : [];
    raw = fs.readFileSync(row.file_abs_path, 'utf8');
  } catch { return []; }

  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return []; }

  const messages = extractMessagesArray(obj);
  const allTurns = messages
    .map((m, i) => parseTurnObject(m, row.source, row.file_abs_path, i))
    .filter((t): t is NormalizedTurn => t !== null);
  return allTurns.slice(skipCount);
}

async function extractLogTurns(row: SessionRow, skipCount: number): Promise<NormalizedTurn[]> {
  if (skipCount > 0) return [];
  // treat log as opaque; make a single meta entry
  return [makeMetaTurn(row)];
}

function makeMetaTurn(row: SessionRow): NormalizedTurn {
  return {
    timestamp: new Date(row.updated_at_ms).toISOString(),
    tool: row.source,
    role: 'system',
    content: `[${row.kind}] ${path.basename(row.file_abs_path)} — binary/opaque format, not parsed`,
    rawSource: row.file_abs_path,
    rawOffset: 0,
  };
}

// ── Object → NormalizedTurn ───────────────────────────────────────────────────

function parseTurnObject(
  obj: Record<string, unknown>,
  source: string,
  filePath: string,
  offset: number,
): NormalizedTurn | null {
  // Claude telemetry events – not chat turns
  if (obj['event_type'] && String(obj['event_type']).includes('Internal')) return null;

  // Codex CLI event format: { type: "response_item"|"event_msg", timestamp, payload: { role, content } }
  const evType = obj['type'];
  if (evType === 'response_item' || evType === 'event_msg') {
    const payload = obj['payload'];
    if (payload && typeof payload === 'object') {
      const p = payload as Record<string, unknown>;
      // event_msg uses p.message (string) as the user prompt content
      const synth: Record<string, unknown> = {
        role: p['role'] ?? (evType === 'event_msg' ? 'user' : undefined),
        content: p['content'] ?? p['message'] ?? p['text'] ?? '',
        timestamp: obj['timestamp'],
      };
      return parseTurnObject(synth, source, filePath, offset);
    }
    return null;
  }

  // session_meta / turn_context – structural, not chat turns
  if (evType === 'session_meta' || evType === 'turn_context') return null;

  const role = resolveRole(obj);
  if (!role) return null;
  const content = resolveContent(obj);
  if (!content) return null;

  const ts = resolveTimestamp(obj);

  return {
    timestamp: ts,
    tool: source,
    role,
    content: content.slice(0, MAX_CONTENT_CHARS),
    rawSource: filePath,
    rawOffset: offset,
  };
}

function resolveRole(obj: Record<string, unknown>): NormalizedTurn['role'] | null {
  const r = (obj['role'] ?? obj['type'] ?? '').toString().toLowerCase();
  if (r === 'user' || r === 'human') return 'user';
  if (r === 'assistant' || r === 'ai' || r === 'bot') return 'assistant';
  if (r === 'system' || r === 'tool') return 'system';
  return null;
}

function resolveContent(obj: Record<string, unknown>): string {
  const raw = obj['content'] ?? obj['text'] ?? obj['message'] ?? obj['body'] ?? '';
  return flattenContent(raw);
}

function flattenContent(val: unknown): string {
  if (typeof val === 'string') return val.trim();
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          const o = item as Record<string, unknown>;
          return flattenContent(o['text'] ?? o['content'] ?? '');
        }
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();
  }
  if (typeof val === 'object' && val !== null) {
    const o = val as Record<string, unknown>;
    return flattenContent(o['text'] ?? o['content'] ?? '');
  }
  return '';
}

function resolveTimestamp(obj: Record<string, unknown>): string {
  const ts =
    obj['timestamp'] ??
    obj['created_at'] ??
    obj['time'] ??
    obj['ts'] ??
    (obj['event_data'] as Record<string, unknown> | undefined)?.['client_timestamp'];
  if (ts && typeof ts === 'string') {
    try { return new Date(ts).toISOString(); } catch { /* fall through */ }
  }
  if (ts && typeof ts === 'number') {
    return new Date(ts).toISOString();
  }
  return new Date().toISOString();
}

function extractMessagesArray(obj: unknown): Record<string, unknown>[] {
  if (Array.isArray(obj)) {
    // array of message objects
    const flat = obj.flatMap((item) => {
      if (Array.isArray(item)) return item as Record<string, unknown>[];
      if (typeof item === 'object' && item !== null) return [item as Record<string, unknown>];
      return [];
    });
    return flat;
  }
  if (typeof obj === 'object' && obj !== null) {
    const o = obj as Record<string, unknown>;
    const arr = o['messages'] ?? o['turns'] ?? o['history'] ?? o['conversation'];
    if (Array.isArray(arr)) return extractMessagesArray(arr);
  }
  return [];
}

// ── Timeline builder ──────────────────────────────────────────────────────────

function buildTimeline(turns: NormalizedTurn[], row: SessionRow): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  events.push({
    timestamp: turns[0]?.timestamp ?? new Date(row.updated_at_ms).toISOString(),
    type: 'session_start',
    tool: row.source,
    summary: `Session started — ${row.project_hint || path.basename(row.file_abs_path)}`,
  });

  for (const turn of turns) {
    if (turn.role === 'system') continue;
    events.push({
      timestamp: turn.timestamp,
      type: turn.role === 'user' ? 'prompt' : 'response',
      tool: turn.tool,
      summary: turn.content.slice(0, 120).replace(/\n/g, ' '),
    });
  }

  if (turns.length > 0) {
    events.push({
      timestamp: turns[turns.length - 1]?.timestamp ?? new Date(row.updated_at_ms).toISOString(),
      type: 'session_end',
      tool: row.source,
    });
  }

  return events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveKind(kind: string): SessionMetadata['kind'] {
  if (kind.includes('jsonl')) return 'jsonl';
  if (kind.includes('json')) return 'json';
  if (kind.includes('log')) return 'log';
  if (kind.includes('snapshot')) return 'snapshot';
  return 'db';
}

async function loadAllTurns(sessionId: string, count: number): Promise<NormalizedTurn[]> {
  // Re-read existing turns for timeline rebuild
  const { readTurns } = await import('./sessionStore.js');
  const all = await readTurns(sessionId);
  return all.slice(0, count);
}
