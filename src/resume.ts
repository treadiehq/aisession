import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { SessionRow } from './db.js';

type Turn = {
  role: string;
  content: string;
};

function parseJsonlTurns(content: string, n: number): Turn[] {
  const lines = content.split('\n').filter(Boolean);
  const turns: Turn[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj['role'] && typeof obj['content'] === 'string') {
        turns.push({ role: String(obj['role']), content: String(obj['content']).slice(0, 400) });
      } else if (obj['type'] === 'assistant' || obj['type'] === 'human') {
        const role = obj['type'] === 'assistant' ? 'assistant' : 'user';
        const content = extractContent(obj['message'] ?? obj['content']);
        if (content) turns.push({ role, content: content.slice(0, 400) });
      }
    } catch { /* skip bad lines */ }
  }
  return turns.slice(-n);
}

function extractContent(val: unknown): string {
  if (typeof val === 'string') return val;
  if (Array.isArray(val)) {
    return val
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item === 'object' && item !== null) {
          const o = item as Record<string, unknown>;
          if (o['text']) return String(o['text']);
          if (o['content']) return String(o['content']);
        }
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof val === 'object' && val !== null) {
    const o = val as Record<string, unknown>;
    if (o['content']) return String(o['content']);
  }
  return '';
}

function parseJsonTurns(content: string, n: number): Turn[] {
  try {
    const obj = JSON.parse(content) as unknown;
    if (Array.isArray(obj)) {
      const turns: Turn[] = [];
      for (const item of obj) {
        if (typeof item === 'object' && item !== null) {
          const o = item as Record<string, unknown>;
          if (o['role'] && (o['content'] || o['message'])) {
            const content = extractContent(o['content'] ?? o['message']);
            if (content) turns.push({ role: String(o['role']), content: content.slice(0, 400) });
          }
        }
      }
      return turns.slice(-n);
    }
    // single object with messages array
    if (typeof obj === 'object' && obj !== null) {
      const o = obj as Record<string, unknown>;
      const msgs = o['messages'] ?? o['turns'] ?? o['history'];
      if (Array.isArray(msgs)) {
        return parseJsonTurns(JSON.stringify(msgs), n);
      }
    }
  } catch { /* ignore */ }
  return [];
}

function tailLines(content: string, n: number): string {
  return content.split('\n').slice(-n).join('\n');
}

function getGitInfo(projectHint: string): string {
  if (!projectHint || projectHint === 'unknown') return '';
  // try to locate a git repo at or near the project_hint if it looks like a path
  const candidates = [
    projectHint,
    path.join(process.env['HOME'] ?? '', projectHint),
    path.join(process.env['HOME'] ?? '', 'code', projectHint),
    path.join(process.env['HOME'] ?? '', 'projects', projectHint),
  ];

  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const stat = fs.statSync(candidate);
      if (!stat.isDirectory()) continue;

      const out = execFileSync('git', ['-C', candidate, 'rev-parse', '--is-inside-work-tree'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
        .toString()
        .trim();
      if (out !== 'true') continue;

      const status = execFileSync('git', ['-C', candidate, 'status', '--porcelain'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      const diffStat = execFileSync('git', ['-C', candidate, 'diff', '--stat'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();
      const branch = execFileSync('git', ['-C', candidate, 'rev-parse', '--abbrev-ref', 'HEAD'], {
        timeout: 2000,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString().trim();

      let info = `\n## Git Info (${candidate})\n`;
      info += `Branch: ${branch}\n`;
      if (status) info += `\nStatus:\n${status}\n`;
      if (diffStat) info += `\nDiff stat:\n${diffStat}\n`;
      return info;
    } catch { /* ignore */ }
  }
  return '';
}

export function buildResumeBlock(session: SessionRow, n = 10): string {
  const lines: string[] = [];
  lines.push('='.repeat(60));
  lines.push('## AI Session Resume Block');
  lines.push('='.repeat(60));
  lines.push(`Source:        ${session.source}`);
  lines.push(`Kind:          ${session.kind}`);
  lines.push(`Project:       ${session.project_hint || 'unknown'}`);
  lines.push(`Updated:       ${new Date(session.updated_at_ms).toISOString()}`);
  if (session.snapshot_id) {
    lines.push(`Snapshot ID:   ${session.snapshot_id}`);
  }
  lines.push('');

  const filePath = session.file_abs_path;
  if (!fs.existsSync(filePath)) {
    lines.push(`(File not found locally: ${filePath})`);
    lines.push('');
    lines.push(getGitInfo(session.project_hint));
    return lines.join('\n');
  }

  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    lines.push(`(Could not read file: ${filePath})`);
    return lines.join('\n');
  }

  const ext = path.extname(filePath).toLowerCase();
  let turns: Turn[] = [];

  if (ext === '.jsonl') {
    turns = parseJsonlTurns(content, n);
  } else if (ext === '.json') {
    turns = parseJsonTurns(content, n);
  }

  if (turns.length > 0) {
    lines.push(`## Last ${turns.length} Turns`);
    for (const turn of turns) {
      lines.push(`\n### [${turn.role.toUpperCase()}]`);
      lines.push(turn.content.trim());
    }
  } else {
    // unknown format: tail last 200 lines
    lines.push('## File Tail (last 200 lines)');
    lines.push(tailLines(content, 200));
  }

  const gitInfo = getGitInfo(session.project_hint);
  if (gitInfo) lines.push(gitInfo);

  lines.push('');
  lines.push('='.repeat(60));
  lines.push('Paste this block into your LLM to resume context.');
  lines.push('='.repeat(60));

  return lines.join('\n');
}
