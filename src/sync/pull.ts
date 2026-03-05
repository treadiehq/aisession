import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { Config } from '../config.js';
import { getLogger } from '../logger.js';
import { matchesExclude, isRedacted, hashFile } from '../indexer.js';
import { atomicCopy, fileChanged, statOrNull } from './copy.js';
import { setMeta } from '../db.js';
import { syncMachineDir, cacheDir } from '../paths.js';

export async function pull(cfg: Config, db: Database.Database): Promise<number> {
  const log = getLogger();
  let count = 0;

  const machinesDir = path.join(cfg.syncRoot, 'machines');
  if (!fs.existsSync(machinesDir)) {
    log.info('No machines dir in syncRoot yet');
    setMeta(db, 'last_pull_ms', String(Date.now()));
    return 0;
  }

  let machineDirs: string[];
  try {
    machineDirs = fs.readdirSync(machinesDir);
  } catch {
    return 0;
  }

  for (const otherId of machineDirs) {
    if (otherId === cfg.machineId) continue;
    const otherMachineDir = path.join(machinesDir, otherId);

    let sourceDirs: string[];
    try {
      sourceDirs = fs.readdirSync(otherMachineDir);
    } catch {
      continue;
    }

    for (const sourceName of sourceDirs) {
      const sourceDir = path.join(otherMachineDir, sourceName);
      try {
        const stat = fs.statSync(sourceDir);
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }

      const files = walkRemote(sourceDir, cfg.exclude, cfg.redactFileNamePatterns, sourceDir);
      const localCache = cacheDir(otherId, sourceName);

      for (const remoteAbs of files) {
        try {
          const relPath = path.relative(sourceDir, remoteAbs);
          const destPath = path.join(localCache, relPath);

          // Guard against path traversal from a malicious sync folder
          if (!path.resolve(destPath).startsWith(path.resolve(localCache) + path.sep)) {
            log.warn({ relPath, localCache }, 'Path traversal attempt blocked, skipping file');
            continue;
          }

          const remoteStat = fs.statSync(remoteAbs);
          const localStat = statOrNull(destPath);

          if (localStat && !fileChanged(remoteStat, localStat)) continue;

          if (localStat) {
            const rh = hashFile(remoteAbs);
            const lh = hashFile(destPath);
            if (rh && lh && rh === lh) continue;
          }

          await atomicCopy(remoteAbs, destPath);
          count++;
          log.debug({ otherId, sourceName, relPath }, 'Pulled file');
        } catch (err) {
          log.warn({ err, remoteAbs }, 'Failed to pull file');
        }
      }
    }
  }

  setMeta(db, 'last_pull_ms', String(Date.now()));
  log.info({ count }, 'Pull complete');
  return count;
}

function walkRemote(
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
      results.push(...walkRemote(absPath, excludePatterns, redactPatterns, baseDir));
    } else if (entry.isFile()) {
      results.push(absPath);
    }
  }
  return results;
}
