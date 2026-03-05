/**
 * Timeline display logic.
 * Aggregates timeline.json entries across sessions and formats them for terminal output.
 */

import fs from 'node:fs';
import path from 'node:path';
import { SESSIONS_DIR } from '../paths.js';
import { readTimeline, listNormalizedSessions, type TimelineEvent } from './sessionStore.js';

export type TimelineEntry = TimelineEvent & { sessionId: string; projectHint: string };

export function buildGlobalTimeline(limit = 200): TimelineEntry[] {
  const sessions = listNormalizedSessions();
  const entries: TimelineEntry[] = [];

  for (const meta of sessions) {
    const events = readTimeline(meta.sessionId);
    for (const ev of events) {
      entries.push({ ...ev, sessionId: meta.sessionId, projectHint: meta.projectHint });
    }
  }

  return entries
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}

export function buildSessionTimeline(sessionId: string): TimelineEntry[] {
  // resolve prefix
  let resolvedId = sessionId;
  if (!fs.existsSync(path.join(SESSIONS_DIR, sessionId))) {
    try {
      const dirs = fs.readdirSync(SESSIONS_DIR);
      resolvedId = dirs.find((d) => d.startsWith(sessionId)) ?? sessionId;
    } catch { /* ignore */ }
  }
  const events = readTimeline(resolvedId);
  return events.map((ev) => ({ ...ev, sessionId: resolvedId, projectHint: '' }));
}

export function formatTimelineEntry(entry: TimelineEntry): string {
  const time = formatTime(entry.timestamp);
  const tool = entry.tool.padEnd(10);
  const project = entry.projectHint ? `[${entry.projectHint.slice(0, 20)}] ` : '';

  switch (entry.type) {
    case 'prompt':
      return `${time}  ${tool}  ${project}prompt: "${(entry.summary ?? '').slice(0, 80)}"`;
    case 'response':
      return `${time}  ${tool}  ${project}response: "${(entry.summary ?? '').slice(0, 80)}"`;
    case 'file_edit':
      return `${time}  ${tool}  ${project}edited ${entry.file ?? ''}`;
    case 'file_create':
      return `${time}  ${tool}  ${project}created ${entry.file ?? ''}`;
    case 'file_delete':
      return `${time}  ${tool}  ${project}deleted ${entry.file ?? ''}`;
    case 'session_start':
      return `${time}  ${tool}  ── session start ${entry.summary ? `(${entry.summary})` : ''}`;
    case 'session_end':
      return `${time}  ${tool}  ── session end`;
    default:
      return `${time}  ${tool}  ${entry.summary ?? entry.type}`;
  }
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `${date} ${h}:${m}`;
  } catch {
    return iso.slice(0, 16);
  }
}
