import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Config } from './config.js';
import { lockFilePath } from './paths.js';
import { getLogger } from './logger.js';
import { atomicCopy } from './sync/copy.js';

type LockFile = {
  machineId: string;
  hostname: string;
  pid: number;
  createdAtMs: number;
  expiresAtMs: number;
};

function readLock(lockPath: string): LockFile | null {
  try {
    return JSON.parse(fs.readFileSync(lockPath, 'utf8')) as LockFile;
  } catch {
    return null;
  }
}

function isExpired(lock: LockFile): boolean {
  return Date.now() > lock.expiresAtMs;
}

export async function acquireLock(
  cfg: Config,
  source: string,
  projectKey: string,
): Promise<boolean> {
  const log = getLogger();
  const lockPath = lockFilePath(cfg.syncRoot, source, projectKey);
  const existing = readLock(lockPath);

  if (existing && !isExpired(existing) && existing.machineId !== cfg.machineId) {
    log.warn({ source, projectKey, holder: existing.machineId }, 'Lock held by other machine');
    return false;
  }

  const lock: LockFile = {
    machineId: cfg.machineId,
    hostname: os.hostname(),
    pid: process.pid,
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + cfg.lockTtlMs,
  };

  const tmp = lockPath + '.tmp.' + Date.now();
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(lock, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, lockPath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    return false;
  }

  log.info({ source, projectKey }, 'Lock acquired');
  return true;
}

export async function releaseLock(
  cfg: Config,
  source: string,
  projectKey: string,
): Promise<void> {
  const log = getLogger();
  const lockPath = lockFilePath(cfg.syncRoot, source, projectKey);
  const existing = readLock(lockPath);

  if (!existing || existing.machineId !== cfg.machineId) {
    log.warn({ source, projectKey }, 'Cannot release lock not owned by this machine');
    return;
  }

  try {
    fs.unlinkSync(lockPath);
    log.info({ source, projectKey }, 'Lock released');
  } catch (err) {
    log.warn({ err, source, projectKey }, 'Failed to release lock');
  }
}

export async function renewLock(
  cfg: Config,
  source: string,
  projectKey: string,
): Promise<void> {
  const lockPath = lockFilePath(cfg.syncRoot, source, projectKey);
  const existing = readLock(lockPath);
  if (!existing || existing.machineId !== cfg.machineId) return;

  const updated: LockFile = {
    ...existing,
    expiresAtMs: Date.now() + cfg.lockTtlMs,
  };
  const tmp = lockPath + '.tmp.' + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(updated, null, 2), 'utf8');
  try {
    fs.renameSync(tmp, lockPath);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}

export async function checkLockBlocked(
  cfg: Config,
  source: string,
  projectKey: string,
): Promise<boolean> {
  if (!fs.existsSync(cfg.syncRoot)) return false;
  const lockPath = lockFilePath(cfg.syncRoot, source, projectKey);
  const existing = readLock(lockPath);
  if (!existing) return false;
  if (isExpired(existing)) return false;
  if (existing.machineId === cfg.machineId) return false;
  return true;
}

export function listActiveLocks(cfg: Config): Array<{ source: string; projectKey: string; lock: LockFile }> {
  const results: Array<{ source: string; projectKey: string; lock: LockFile }> = [];
  const locksDir = path.join(cfg.syncRoot, 'locks');
  if (!fs.existsSync(locksDir)) return results;

  try {
    for (const src of fs.readdirSync(locksDir)) {
      const srcDir = path.join(locksDir, src);
      try {
        for (const lockFile of fs.readdirSync(srcDir)) {
          if (!lockFile.endsWith('.lock.json')) continue;
          const projectKey = lockFile.replace(/\.lock\.json$/, '');
          const lock = readLock(path.join(srcDir, lockFile));
          if (lock && !isExpired(lock)) {
            results.push({ source: src, projectKey, lock });
          }
        }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return results;
}
