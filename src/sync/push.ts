import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Config, resolvedIncludePath, isOpenAIPath } from '../config.js';
import { getLogger } from '../logger.js';
import { walkDir, isRedacted, matchesExclude, hashFile } from '../indexer.js';
import { atomicCopy, fileChanged, statOrNull } from './copy.js';
import { getSource, upsertFile, getFile, setMeta } from '../db.js';
import { syncMachineDir } from '../paths.js';
import { checkLockBlocked } from '../locks.js';
import { snapshotCursorDb } from '../snapshots/cursor.js';
import { snapshotOpencodeDb } from '../snapshots/opencode.js';
import { upsertSession } from '../db.js';
import { detectCursor } from '../detectors/cursor.js';
import { detectOpencode } from '../detectors/opencode.js';

const CURSOR_DB_EXTS = new Set(['.vscdb', '.sqlite', '.db']);
const CURSOR_DB_NAMES = new Set(['state.vscdb']);

function isCursorDbFile(absPath: string): boolean {
  const base = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();
  return CURSOR_DB_NAMES.has(base) || CURSOR_DB_EXTS.has(ext);
}

function isOpencodeDbFile(absPath: string, sourceName: string): boolean {
  if (sourceName !== 'opencode') return false;
  const ext = path.extname(absPath).toLowerCase();
  return ext === '.sqlite' || ext === '.db';
}

export async function push(cfg: Config, db: Database.Database): Promise<number> {
  const log = getLogger();
  let count = 0;

  for (const entry of cfg.include) {
    if (isOpenAIPath(entry.path)) {
      log.warn({ source: entry.name }, 'Skipping ~/.openai source (excluded by default)');
      continue;
    }

    const localPath = resolvedIncludePath(entry);
    if (!fs.existsSync(localPath)) {
      log.warn({ source: entry.name, localPath }, 'Source path missing, skipping push');
      continue;
    }

    const src = getSource(db, entry.name);
    if (!src) continue;

    const files = walkDir(localPath, cfg.exclude, cfg.redactFileNamePatterns, localPath);
    const destBase = path.join(syncMachineDir(cfg.syncRoot, cfg.machineId), entry.name);

    for (const absPath of files) {
      try {
        const relPath = path.relative(localPath, absPath);
        const stat = fs.statSync(absPath);

        // check DB index for quick change detection
        const existing = getFile(db, src.id, relPath);
        const quickUnchanged =
          existing &&
          existing.size === stat.size &&
          Math.abs(existing.mtime_ms - stat.mtimeMs) < 1000;

        if (quickUnchanged) {
          // verify with hash for files < 5MB — skip if hash matches; for DB files skip
          // regardless of destPath existence since they are pushed to .snapshots/ only
          const newHash = hashFile(absPath);
          if (newHash && existing.hash === newHash) {
            const isDb =
              (entry.name === 'cursor' && isCursorDbFile(absPath)) ||
              isOpencodeDbFile(absPath, entry.name);
            const destPath = path.join(destBase, relPath);
            if (isDb || fs.existsSync(destPath)) continue;
          }
        }

        // check lock: skip if another machine holds lock for this project
        const projectKey = normalizeProjectKey(relPath);
        const blocked = await checkLockBlocked(cfg, entry.name, projectKey);
        if (blocked) {
          log.info({ source: entry.name, relPath, projectKey }, 'Lock held by other machine, skipping push');
          continue;
        }

        // Handle DB files with snapshots
        if (entry.name === 'cursor' && isCursorDbFile(absPath)) {
          const snap = await snapshotCursorDb(absPath, entry.name);
          if (snap) {
            // push snapshot to iCloud under .snapshots/
            const snapDest = path.join(
              destBase,
              '.snapshots',
              snap.snapshotId,
              path.basename(absPath),
            );
            await atomicCopy(snap.snapshotPath, snapDest);

            // record session with snapshot
            const sessions = detectCursor(absPath, relPath, localPath);
            for (const sess of sessions) {
              upsertSession(db, { ...sess, kind: 'cursor_snapshot', snapshot_id: snap.snapshotId });
            }
          }
          // index original file
          const hash = hashFile(absPath);
          upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, hash);
          count++;
          continue;
        }

        if (isOpencodeDbFile(absPath, entry.name)) {
          const snap = await snapshotOpencodeDb(absPath, entry.name);
          if (snap) {
            const snapDest = path.join(
              destBase,
              '.snapshots',
              snap.snapshotId,
              path.basename(absPath),
            );
            await atomicCopy(snap.snapshotPath, snapDest);

            const sessions = detectOpencode(absPath, relPath, localPath);
            for (const sess of sessions) {
              upsertSession(db, { ...sess, kind: 'opencode_snapshot', snapshot_id: snap.snapshotId });
            }
          }
          const hash = hashFile(absPath);
          upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, hash);
          count++;
          continue;
        }

        // Normal file: push to iCloud
        const destPath = path.join(destBase, relPath);
        const destStat = statOrNull(destPath);

        if (!fileChanged(stat, destStat)) continue;

        // double-check hash if both exist and quick check passes
        if (destStat) {
          const srcHash = hashFile(absPath);
          const dstHash = hashFile(destPath);
          if (srcHash && dstHash && srcHash === dstHash) {
            upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, srcHash);
            continue;
          }
        }

        await atomicCopy(absPath, destPath);
        const hash = hashFile(absPath);
        upsertFile(db, src.id, relPath, absPath, stat.mtimeMs, stat.size, hash);
        count++;
        log.debug({ source: entry.name, relPath }, 'Pushed file');
      } catch (err) {
        log.warn({ err, absPath }, 'Failed to push file');
      }
    }
  }

  setMeta(db, 'last_push_ms', String(Date.now()));
  log.info({ count }, 'Push complete');
  return count;
}

function normalizeProjectKey(relPath: string): string {
  const parts = relPath.split(path.sep).filter(Boolean);
  const hint = parts.length >= 2 ? parts[0] : path.basename(relPath, path.extname(relPath));
  return hint.toLowerCase().replace(/[^a-z0-9]+/g, '-');
}
