import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import micromatch from 'micromatch';
import { Config, resolvedIncludePath } from './config.js';
import {
  upsertSource,
  upsertFile,
  upsertSession,
  getSource,
  listSessions,
} from './db.js';
import { getLogger } from './logger.js';
import { detectClaude } from './detectors/claude.js';
import { detectCodex } from './detectors/codex.js';
import { detectOpencode } from './detectors/opencode.js';
import { detectCursor } from './detectors/cursor.js';
import { normalizeSession } from './sessionModel/normalize.js';

const MAX_HASH_SIZE = 5 * 1024 * 1024; // 5 MB

export function isRedacted(filename: string, patterns: string[]): boolean {
  const base = path.basename(filename).toLowerCase();
  return micromatch.isMatch(base, patterns.map((p) => p.toLowerCase()));
}

export function matchesExclude(absPath: string, baseDir: string, patterns: string[]): boolean {
  const rel = path.relative(baseDir, absPath);
  return micromatch.isMatch(rel, patterns) || micromatch.isMatch(absPath, patterns);
}

export function hashFile(absPath: string): string | null {
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX_HASH_SIZE) return null;
    const buf = fs.readFileSync(absPath);
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}

export async function indexAll(cfg: Config, db: Database.Database): Promise<void> {
  const log = getLogger();
  const machineId = cfg.machineId;

  for (const entry of cfg.include) {
    const localPath = resolvedIncludePath(entry);
    upsertSource(db, entry.name, localPath);
    const src = getSource(db, entry.name);
    if (!src) continue;

    if (!fs.existsSync(localPath)) {
      log.warn({ source: entry.name, localPath }, 'Source path does not exist, skipping');
      continue;
    }

    const files = walkDir(localPath, cfg.exclude, cfg.redactFileNamePatterns, localPath);
    for (const absPath of files) {
      try {
        const stat = fs.statSync(absPath);
        const relPath = path.relative(localPath, absPath);
        const hash = hashFile(absPath);
        upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, hash);

        // detect sessions
        const sessions = detectSessions(entry.name, absPath, relPath, localPath);
        for (const sess of sessions) {
          upsertSession(db, sess);
          // Phase 2: normalize into unified session model (non-blocking, best-effort)
          normalizeSession(sess, machineId).catch(() => { /* ignore */ });
        }
      } catch (err) {
        log.warn({ err, absPath }, 'Failed to index file');
      }
    }
    log.info({ source: entry.name, count: files.length }, 'Indexed source');
  }
}

/**
 * Normalize all already-indexed sessions (backfill).
 * Safe to call repeatedly – normalize is idempotent.
 */
export async function normalizeAll(db: Database.Database, machineId: string): Promise<number> {
  const log = getLogger();
  const sessions = listSessions(db, 9999);
  let count = 0;
  for (const sess of sessions) {
    try {
      await normalizeSession(sess, machineId);
      count++;
    } catch (err) {
      log.warn({ err, sessionId: sess.id }, 'normalizeAll: skipped session');
    }
  }
  return count;
}

export function walkDir(
  dir: string,
  excludePatterns: string[],
  redactPatterns: string[],
  baseDir: string,
): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const absPath = path.join(dir, entry.name);
    if (matchesExclude(absPath, baseDir, excludePatterns)) continue;
    if (isRedacted(entry.name, redactPatterns)) continue;

    if (entry.isDirectory()) {
      results.push(...walkDir(absPath, excludePatterns, redactPatterns, baseDir));
    } else if (entry.isFile()) {
      results.push(absPath);
    }
  }
  return results;
}

type SessionCandidate = {
  id: string;
  source: string;
  kind: string;
  project_hint: string;
  updated_at_ms: number;
  file_rel_path: string;
  file_abs_path: string;
  snapshot_id: string | null;
};

function detectSessions(
  sourceName: string,
  absPath: string,
  relPath: string,
  baseDir: string,
): SessionCandidate[] {
  try {
    switch (sourceName) {
      case 'claude': return detectClaude(absPath, relPath, baseDir);
      case 'codex': return detectCodex(absPath, relPath, baseDir);
      case 'opencode': return detectOpencode(absPath, relPath, baseDir);
      case 'cursor': return detectCursor(absPath, relPath, baseDir);
      default: return [];
    }
  } catch {
    return [];
  }
}
