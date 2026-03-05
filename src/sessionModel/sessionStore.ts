/**
 * Manages the normalized session store at ~/.sessionsync/sessions/<sessionId>/
 *
 * Each session directory contains:
 *   metadata.json  – session metadata
 *   turns.jsonl    – normalized turns (append-only)
 *   files.json     – files touched
 *   timeline.json  – ordered events
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { normalizedSessionDir, SESSIONS_DIR } from '../paths.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SessionMetadata = {
  sessionId: string;
  source: 'claude' | 'codex' | 'cursor' | 'opencode';
  createdAt: string;
  updatedAt: string;
  projectHint: string;
  originalFile: string;
  machineId: string;
  kind: 'jsonl' | 'json' | 'db' | 'snapshot' | 'log';
};

export type NormalizedTurn = {
  timestamp: string;
  tool: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  rawSource: string;
  rawOffset: number;
};

export type FileEvent = {
  path: string;
  operation: 'edit' | 'create' | 'delete';
  timestamp: string;
  tool: string;
};

export type TimelineEvent = {
  timestamp: string;
  type: 'prompt' | 'response' | 'file_edit' | 'file_create' | 'file_delete' | 'session_start' | 'session_end';
  tool: string;
  summary?: string;
  file?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function metaPath(sessionId: string): string {
  return path.join(normalizedSessionDir(sessionId), 'metadata.json');
}
function turnsPath(sessionId: string): string {
  return path.join(normalizedSessionDir(sessionId), 'turns.jsonl');
}
function filesPath(sessionId: string): string {
  return path.join(normalizedSessionDir(sessionId), 'files.json');
}
function timelinePath(sessionId: string): string {
  return path.join(normalizedSessionDir(sessionId), 'timeline.json');
}

function ensureDir(sessionId: string): void {
  fs.mkdirSync(normalizedSessionDir(sessionId), { recursive: true });
}

// ── Read ──────────────────────────────────────────────────────────────────────

export function readMetadata(sessionId: string): SessionMetadata | null {
  try {
    return JSON.parse(fs.readFileSync(metaPath(sessionId), 'utf8')) as SessionMetadata;
  } catch {
    return null;
  }
}

export function readTimeline(sessionId: string): TimelineEvent[] {
  try {
    return JSON.parse(fs.readFileSync(timelinePath(sessionId), 'utf8')) as TimelineEvent[];
  } catch {
    return [];
  }
}

export function readFileEvents(sessionId: string): FileEvent[] {
  try {
    return JSON.parse(fs.readFileSync(filesPath(sessionId), 'utf8')) as FileEvent[];
  } catch {
    return [];
  }
}

export async function readTurns(sessionId: string): Promise<NormalizedTurn[]> {
  const p = turnsPath(sessionId);
  if (!fs.existsSync(p)) return [];
  const turns: NormalizedTurn[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(p), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      turns.push(JSON.parse(line) as NormalizedTurn);
    } catch { /* skip bad lines */ }
  }
  return turns;
}

export function countExistingTurns(sessionId: string): number {
  const p = turnsPath(sessionId);
  if (!fs.existsSync(p)) return 0;
  try {
    const content = fs.readFileSync(p, 'utf8');
    return content.split('\n').filter((l) => l.trim()).length;
  } catch {
    return 0;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────

export function writeMetadata(meta: SessionMetadata): void {
  ensureDir(meta.sessionId);
  fs.writeFileSync(metaPath(meta.sessionId), JSON.stringify(meta, null, 2), 'utf8');
}

export function appendTurns(sessionId: string, turns: NormalizedTurn[]): void {
  if (turns.length === 0) return;
  ensureDir(sessionId);
  const lines = turns.map((t) => JSON.stringify(t)).join('\n') + '\n';
  fs.appendFileSync(turnsPath(sessionId), lines, 'utf8');
}

export function writeFileEvents(sessionId: string, events: FileEvent[]): void {
  ensureDir(sessionId);
  fs.writeFileSync(filesPath(sessionId), JSON.stringify(events, null, 2), 'utf8');
}

export function writeTimeline(sessionId: string, events: TimelineEvent[]): void {
  ensureDir(sessionId);
  fs.writeFileSync(timelinePath(sessionId), JSON.stringify(events, null, 2), 'utf8');
}

// ── List all normalized sessions ──────────────────────────────────────────────

export function listNormalizedSessions(): SessionMetadata[] {
  if (!fs.existsSync(SESSIONS_DIR)) return [];
  const results: SessionMetadata[] = [];
  let dirs: string[];
  try {
    dirs = fs.readdirSync(SESSIONS_DIR);
  } catch {
    return [];
  }
  for (const d of dirs) {
    const meta = readMetadata(d);
    if (meta) results.push(meta);
  }
  return results.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getNormalizedSession(sessionId: string): SessionMetadata | null {
  // exact match first
  if (readMetadata(sessionId)) return readMetadata(sessionId);
  // prefix match
  try {
    const dirs = fs.readdirSync(SESSIONS_DIR);
    const match = dirs.find((d) => d.startsWith(sessionId));
    if (match) return readMetadata(match);
  } catch { /* ignore */ }
  return null;
}
