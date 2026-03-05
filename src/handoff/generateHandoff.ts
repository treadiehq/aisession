/**
 * Phase 2.5 — Live Session Handoff
 *
 * Generates a compact, paste-ready continuation prompt from a normalized session.
 * No external LLM APIs used — purely local data from the unified session model.
 */

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import {
  getNormalizedSession,
  readTimeline,
  readFileEvents,
  type NormalizedTurn,
  type TimelineEvent,
  type FileEvent,
} from '../sessionModel/sessionStore.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type HandoffOptions = {
  format: 'text' | 'markdown' | 'json';
  turns: number;
  includeGit: boolean;
};

export type HandoffData = {
  project: string;
  summary: string[];
  lastPrompt: string;
  lastResponse: string;
  filesChanged: string[];
  gitStatus: string;
  gitDiffStat: string;
  suggestedNextTask: string;
  sessionId: string;
  source: string;
  updatedAt: string;
};

export const DEFAULT_OPTIONS: HandoffOptions = {
  format: 'markdown',
  turns: 6,
  includeGit: true,
};

const CONTINUATION_VERBS = /\b(add|implement|fix|refactor|update|create|build|write|extend|integrate|migrate|convert|replace|remove|delete|optimize|improve|debug|test|deploy)\b/i;

// ── Main entry point ──────────────────────────────────────────────────────────

export async function generateHandoff(
  rawSessionId: string,
  options: Partial<HandoffOptions> = {},
): Promise<HandoffData> {
  const opts: HandoffOptions = { ...DEFAULT_OPTIONS, ...options };
  const meta = getNormalizedSession(rawSessionId);
  if (!meta) {
    throw new Error(`Session not found: ${rawSessionId}. Run 'ais normalize' first.`);
  }

  const timeline = readTimeline(meta.sessionId);
  const fileEvents = readFileEvents(meta.sessionId);

  // Read only the tail of turns.jsonl — avoid loading entire file into memory
  const { lastPrompt, lastResponse } = await readLastTurns(meta.sessionId, opts.turns);

  const summary = buildSummary(timeline, lastPrompt, opts.turns);
  const filesChanged = extractRecentFiles(fileEvents);
  const { gitStatus, gitDiffStat } = opts.includeGit
    ? runGitInfo(meta.projectHint, meta.originalFile)
    : { gitStatus: '', gitDiffStat: '' };

  const suggestedNextTask = inferNextTask(lastPrompt, lastResponse);

  return {
    project: meta.projectHint || path.basename(meta.originalFile),
    summary,
    lastPrompt,
    lastResponse: lastResponse.slice(0, 800),
    filesChanged,
    gitStatus,
    gitDiffStat,
    suggestedNextTask,
    sessionId: meta.sessionId,
    source: meta.source,
    updatedAt: meta.updatedAt,
  };
}

// ── Turn reading (streaming, tail-only) ───────────────────────────────────────

async function readLastTurns(
  sessionId: string,
  n: number,
): Promise<{ lastPrompt: string; lastResponse: string }> {
  const { SESSIONS_DIR } = await import('../paths.js');
  const turnsPath = path.join(SESSIONS_DIR, sessionId, 'turns.jsonl');

  if (!fs.existsSync(turnsPath)) {
    return { lastPrompt: '', lastResponse: '' };
  }

  // Stream line-by-line and keep a rolling window — never loads full file
  const window: NormalizedTurn[] = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(turnsPath),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const t = JSON.parse(line) as NormalizedTurn;
      if (t.role === 'user' || t.role === 'assistant') {
        window.push(t);
        if (window.length > n * 2) window.shift(); // keep rolling window
      }
    } catch { /* skip bad lines */ }
  }

  // Find last user and assistant turns
  let lastPrompt = '';
  let lastResponse = '';
  for (let i = window.length - 1; i >= 0; i--) {
    const t = window[i]!;
    if (!lastResponse && t.role === 'assistant') lastResponse = t.content;
    if (!lastPrompt && t.role === 'user') lastPrompt = t.content;
    if (lastPrompt && lastResponse) break;
  }

  return { lastPrompt, lastResponse };
}

// ── Summary builder ───────────────────────────────────────────────────────────

export function buildSummary(
  timeline: TimelineEvent[],
  lastPrompt: string,
  maxItems: number,
): string[] {
  const items: string[] = [];

  // Collect prompts from timeline (newest-first then reverse for chronological)
  const prompts = timeline
    .filter((e) => e.type === 'prompt' && e.summary)
    .map((e) => e.summary!)
    .filter((s) => s.length > 0);

  const fileEdits = timeline
    .filter((e) => (e.type === 'file_edit' || e.type === 'file_create') && e.file)
    .map((e) => {
      const verb = e.type === 'file_create' ? 'Created' : 'Edited';
      return `${verb} ${path.basename(e.file!)}`;
    });

  // De-duplicate file edits and prompt summaries
  const uniqueFileEdits = [...new Set(fileEdits)];
  const uniquePrompts = [...new Set(prompts)];

  // Build summary: prompt summaries + file edits, capped at maxItems
  const promptItems = uniquePrompts.slice(-Math.ceil(maxItems / 2)).map(truncate80);
  const fileItems = uniqueFileEdits.slice(0, Math.floor(maxItems / 2));

  items.push(...promptItems, ...fileItems);

  // Fallback: use last prompt if nothing found
  if (items.length === 0 && lastPrompt) {
    items.push(truncate80(lastPrompt));
  }

  return items.slice(0, maxItems);
}

// ── File events ───────────────────────────────────────────────────────────────

export function extractRecentFiles(fileEvents: FileEvent[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  // fileEvents are in timeline order; iterate backwards to get most-recent first
  for (let i = fileEvents.length - 1; i >= 0; i--) {
    const f = fileEvents[i]!.path;
    if (f && !seen.has(f)) {
      seen.add(f);
      result.push(f);
    }
    if (result.length >= 10) break;
  }
  return result;
}

// ── Git integration ───────────────────────────────────────────────────────────

export function runGitInfo(
  projectHint: string,
  originalFile: string,
): { gitStatus: string; gitDiffStat: string } {
  const candidates = [
    projectHint,
    path.dirname(originalFile),
    path.join(process.env['HOME'] ?? '', projectHint),
    path.join(process.env['HOME'] ?? '', 'code', projectHint),
    path.join(process.env['HOME'] ?? '', 'projects', projectHint),
  ].filter(Boolean);

  for (const dir of candidates) {
    try {
      if (!fs.existsSync(dir)) continue;
      const inside = execFileSync('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (inside !== 'true') continue;

      const status = execFileSync('git', ['-C', dir, 'status', '--porcelain'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      const diffStat = execFileSync('git', ['-C', dir, 'diff', '--stat'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();

      return { gitStatus: status, gitDiffStat: diffStat };
    } catch { /* try next */ }
  }

  return { gitStatus: '', gitDiffStat: '' };
}

// ── Next task heuristic ───────────────────────────────────────────────────────

export function inferNextTask(lastPrompt: string, _lastResponse: string): string {
  if (!lastPrompt) return 'Continue development based on the latest assistant response.';
  const match = CONTINUATION_VERBS.exec(lastPrompt);
  if (match) {
    // Take up to first 100 chars of the prompt as the continuation hint
    const hint = lastPrompt.slice(0, 100).replace(/\n/g, ' ').trim();
    return `Continue implementing: "${hint}"`;
  }
  return 'Continue development based on the latest assistant response.';
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatHandoff(data: HandoffData, format: HandoffOptions['format']): string {
  switch (format) {
    case 'json': return JSON.stringify(data, null, 2);
    case 'text': return formatText(data);
    case 'markdown':
    default: return formatMarkdown(data);
  }
}

function formatMarkdown(d: HandoffData): string {
  const lines: string[] = [];

  lines.push('# SESSION HANDOFF');
  lines.push('');
  lines.push(`**Project:** ${d.project}`);
  lines.push(`**Source:** ${d.source}`);
  lines.push(`**Updated:** ${new Date(d.updatedAt).toLocaleString()}`);
  lines.push('');

  if (d.summary.length > 0) {
    lines.push('## WORK COMPLETED');
    for (const item of d.summary) lines.push(`- ${item}`);
    lines.push('');
  }

  if (d.lastPrompt) {
    lines.push('## LAST USER PROMPT');
    lines.push('');
    lines.push('```');
    lines.push(d.lastPrompt.trim());
    lines.push('```');
    lines.push('');
  }

  if (d.lastResponse) {
    lines.push('## LAST ASSISTANT RESPONSE');
    lines.push('');
    lines.push(d.lastResponse.trim());
    lines.push('');
  }

  if (d.filesChanged.length > 0) {
    lines.push('## FILES MODIFIED');
    for (const f of d.filesChanged) lines.push(`- \`${f}\``);
    lines.push('');
  }

  if (d.gitStatus) {
    lines.push('## CURRENT GIT STATUS');
    lines.push('');
    lines.push('```');
    lines.push(d.gitStatus);
    lines.push('```');
    lines.push('');
  }

  if (d.gitDiffStat) {
    lines.push('## GIT DIFF STAT');
    lines.push('');
    lines.push('```');
    lines.push(d.gitDiffStat);
    lines.push('```');
    lines.push('');
  }

  lines.push('## NEXT SUGGESTED TASK');
  lines.push('');
  lines.push(d.suggestedNextTask);
  lines.push('');
  lines.push('---');
  lines.push('*Paste this block into Claude, Codex, Cursor, or another LLM to continue the session.*');

  return lines.join('\n');
}

function formatText(d: HandoffData): string {
  const lines: string[] = [];

  lines.push('SESSION HANDOFF');
  lines.push('');
  lines.push(`Project: ${d.project}`);
  lines.push(`Source:  ${d.source}`);
  lines.push(`Updated: ${new Date(d.updatedAt).toLocaleString()}`);
  lines.push('');

  if (d.summary.length > 0) {
    lines.push('WORK COMPLETED');
    for (const item of d.summary) lines.push(`  • ${item}`);
    lines.push('');
  }

  if (d.lastPrompt) {
    lines.push('LAST USER PROMPT');
    lines.push(d.lastPrompt.trim());
    lines.push('');
  }

  if (d.lastResponse) {
    lines.push('LAST ASSISTANT RESPONSE');
    lines.push(d.lastResponse.trim());
    lines.push('');
  }

  if (d.filesChanged.length > 0) {
    lines.push('FILES MODIFIED');
    for (const f of d.filesChanged) lines.push(`  ${f}`);
    lines.push('');
  }

  if (d.gitStatus) {
    lines.push('CURRENT GIT STATUS');
    lines.push(d.gitStatus);
    lines.push('');
  }

  if (d.gitDiffStat) {
    lines.push('GIT DIFF STAT');
    lines.push(d.gitDiffStat);
    lines.push('');
  }

  lines.push('NEXT SUGGESTED TASK');
  lines.push(d.suggestedNextTask);

  return lines.join('\n');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate80(s: string): string {
  const clean = s.replace(/\n/g, ' ').trim();
  return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
}
