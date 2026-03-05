/**
 * Exports a normalized session to a self-contained directory.
 *
 * Output: ./session-export-<id>/
 *   transcript.md
 *   turns.json
 *   timeline.json
 *   metadata.json
 *   patches/      (reserved for future patch extraction)
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  getNormalizedSession,
  readTurns,
  readTimeline,
  readFileEvents,
  readMetadata,
  type NormalizedTurn,
  type TimelineEvent,
} from '../sessionModel/sessionStore.js';
import { consoleError, consoleLog } from '../logger.js';

export async function exportSession(rawSessionId: string, outDir?: string): Promise<string> {
  const meta = getNormalizedSession(rawSessionId);
  if (!meta) {
    consoleError(`Session not found: ${rawSessionId}. Run 'ais normalize' first.`);
    process.exit(1);
  }

  const exportDir = outDir ?? path.join(process.cwd(), `session-export-${meta.sessionId.slice(0, 12)}`);
  fs.mkdirSync(exportDir, { recursive: true });
  fs.mkdirSync(path.join(exportDir, 'patches'), { recursive: true });

  const turns = await readTurns(meta.sessionId);
  const timeline = readTimeline(meta.sessionId);
  const fileEvents = readFileEvents(meta.sessionId);

  // metadata.json
  fs.writeFileSync(
    path.join(exportDir, 'metadata.json'),
    JSON.stringify(meta, null, 2),
    'utf8',
  );

  // turns.json
  fs.writeFileSync(
    path.join(exportDir, 'turns.json'),
    JSON.stringify(turns, null, 2),
    'utf8',
  );

  // timeline.json
  fs.writeFileSync(
    path.join(exportDir, 'timeline.json'),
    JSON.stringify(timeline, null, 2),
    'utf8',
  );

  // transcript.md
  const transcript = buildTranscript(meta, turns, timeline);
  fs.writeFileSync(path.join(exportDir, 'transcript.md'), transcript, 'utf8');

  consoleLog(`Exported to: ${exportDir}`);
  return exportDir;
}

function buildTranscript(
  meta: ReturnType<typeof getNormalizedSession> & object,
  turns: NormalizedTurn[],
  timeline: TimelineEvent[],
): string {
  const lines: string[] = [];

  lines.push(`# Session Transcript`);
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| Source | ${meta!.source} |`);
  lines.push(`| Project | ${meta!.projectHint || 'unknown'} |`);
  lines.push(`| Created | ${meta!.createdAt} |`);
  lines.push(`| Updated | ${meta!.updatedAt} |`);
  lines.push(`| Machine | ${meta!.machineId} |`);
  lines.push(`| Session ID | \`${meta!.sessionId}\` |`);
  lines.push('');

  if (timeline.length > 0) {
    lines.push('## Timeline');
    lines.push('');
    for (const ev of timeline) {
      const time = ev.timestamp.slice(0, 16).replace('T', ' ');
      const label = ev.type.replace('_', ' ');
      const detail = ev.summary ? `: ${ev.summary}` : ev.file ? `: ${ev.file}` : '';
      lines.push(`- \`${time}\` **${label}**${detail}`);
    }
    lines.push('');
  }

  if (turns.length === 0) {
    lines.push('_No conversation turns available for this session._');
    return lines.join('\n');
  }

  lines.push('## Conversation');
  lines.push('');

  for (const turn of turns) {
    if (turn.role === 'system') {
      lines.push(`> _[system] ${turn.content.slice(0, 200)}_`);
      lines.push('');
      continue;
    }

    const roleLabel = turn.role === 'user' ? '**USER**' : '**ASSISTANT**';
    const time = turn.timestamp.slice(0, 16).replace('T', ' ');
    lines.push(`### ${roleLabel} <small><code>${time}</code></small>`);
    lines.push('');
    lines.push(turn.content.trim());
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}
