/**
 * Zero-setup export: discover → index → normalize → export in one shot.
 *
 * Designed for `npx aisession export` with no prior daemon or init required.
 * Uses an in-memory SQLite DB so it leaves no state behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { buildDefaultConfig, resolvedIncludePath } from '../config.js';
import { walkDir, isRedacted, matchesExclude, hashFile } from '../indexer.js';
import { upsertSource, upsertFile, upsertSession, listSessions } from '../db.js';
import { normalizeSession } from '../sessionModel/normalize.js';
import { exportSession } from './exportSession.js';
import { consoleLog, consoleWarn } from '../logger.js';
import { detectClaude } from '../detectors/claude.js';
import { detectCodex } from '../detectors/codex.js';
import { detectOpencode } from '../detectors/opencode.js';
import { detectCursor } from '../detectors/cursor.js';
import { SS_DIR } from '../paths.js';

const DETECTORS: Record<string, (a: string, r: string, b: string) => ReturnType<typeof detectClaude>> = {
  claude: detectClaude,
  codex: detectCodex,
  opencode: detectOpencode,
  cursor: detectCursor,
};

export async function quickExport(outDir?: string): Promise<void> {
  const cfg = buildDefaultConfig();
  const machineId = cfg.machineId;

  // In-memory DB — no files written to disk for the index
  const db = new Database(':memory:');
  initDb(db);

  consoleLog('');
  consoleLog('Scanning for AI sessions...');

  let totalFiles = 0;
  let totalSessions = 0;

  for (const entry of cfg.include) {
    const localPath = resolvedIncludePath(entry);
    if (!fs.existsSync(localPath)) continue;

    upsertSource(db, entry.name, localPath);
    const src = db.prepare('SELECT * FROM sources WHERE name = ?').get(entry.name) as { id: number } | undefined;
    if (!src) continue;

    const files = walkDir(localPath, cfg.exclude, cfg.redactFileNamePatterns, localPath);
    totalFiles += files.length;

    for (const absPath of files) {
      try {
        const stat = fs.statSync(absPath);
        const relPath = path.relative(localPath, absPath);
        const hash = hashFile(absPath);
        upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, hash);

        const detector = DETECTORS[entry.name];
        if (!detector) continue;
        const sessions = detector(absPath, relPath, localPath);
        for (const sess of sessions) {
          upsertSession(db, sess);
          totalSessions++;
        }
      } catch { /* skip unreadable files */ }
    }
  }

  if (totalSessions === 0) {
    consoleWarn('No AI sessions found. Make sure Claude, Codex, Cursor, or OpenCode has been used on this machine.');
    return;
  }

  consoleLog(`Found ${totalSessions} session(s) across ${totalFiles} files.`);
  consoleLog('Normalizing...');

  // Normalize needs the persistent sessions dir
  fs.mkdirSync(SS_DIR, { recursive: true });

  const sessions = listSessions(db, 9999);

  // Normalize all, collect those that produced turns
  const normalized: string[] = [];
  for (const sess of sessions) {
    try {
      await normalizeSession(sess, machineId);
      normalized.push(sess.id);
    } catch { /* skip */ }
  }

  if (normalized.length === 0) {
    consoleWarn('Sessions found but no conversation turns could be extracted.');
    return;
  }

  // Pick the most recently updated session
  const mostRecent = sessions.sort((a, b) => b.updated_at_ms - a.updated_at_ms)[0];

  consoleLog(`Exporting most recent session (${mostRecent.source} · ${mostRecent.project_hint || mostRecent.id.slice(0, 8)})...`);

  const exportDir = await exportSession(mostRecent.id, outDir);

  consoleLog('');
  consoleLog('Session saved:');
  consoleLog(`  prompts & conversation  → ${path.join(exportDir, 'transcript.md')}`);
  consoleLog(`  files changed           → ${path.join(exportDir, 'timeline.json')}`);
  consoleLog(`  full turn data          → ${path.join(exportDir, 'turns.json')}`);
  consoleLog(`  metadata                → ${path.join(exportDir, 'metadata.json')}`);
  consoleLog('');
  consoleLog('You can now:');
  consoleLog('  share it          → send the folder or run: ais share ' + mostRecent.id.slice(0, 8));
  consoleLog('  reopen it later   → open transcript.md');
  consoleLog('  continue anywhere → run: ais handoff ' + mostRecent.id.slice(0, 8));
  consoleLog('');
}

function initDb(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      local_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      abs_path TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT,
      indexed_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      UNIQUE(source_id, rel_path)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      project_hint TEXT NOT NULL DEFAULT '',
      updated_at_ms INTEGER NOT NULL,
      file_rel_path TEXT NOT NULL,
      file_abs_path TEXT NOT NULL,
      snapshot_id TEXT,
      indexed_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
