import fs from 'node:fs';
import path from 'node:path';
import { execSync, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import chokidar from 'chokidar';
import { Config, resolvedIncludePath, isOpenAIPath } from './config.js';
import { DAEMON_PID_FILE } from './paths.js';
import { getDb } from './db.js';
import { getLogger, consoleLog, consoleError } from './logger.js';
import { push } from './sync/push.js';
import { pull } from './sync/pull.js';
import { indexAll } from './indexer.js';
import { renewLock, listActiveLocks } from './locks.js';

const DEBOUNCE_MS = 1500;

export function writePid(pid: number): void {
  fs.mkdirSync(path.dirname(DAEMON_PID_FILE), { recursive: true });
  fs.writeFileSync(DAEMON_PID_FILE, String(pid), 'utf8');
}

export function readPid(): number | null {
  try {
    const raw = fs.readFileSync(DAEMON_PID_FILE, 'utf8').trim();
    const n = parseInt(raw, 10);
    return isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

export function removePid(): void {
  try { fs.unlinkSync(DAEMON_PID_FILE); } catch { /* ignore */ }
}

export function isDaemonRunning(): boolean {
  const pid = readPid();
  if (!pid) return false;
  try {
    process.kill(pid, 0); // signal 0 = just check existence
    return true;
  } catch {
    return false;
  }
}

export async function daemonLoop(cfg: Config): Promise<never> {
  const log = getLogger();
  const db = getDb();
  writePid(process.pid);

  log.info({ pid: process.pid }, 'Daemon started');

  // initial index + push
  try {
    await indexAll(cfg, db);
    await push(cfg, db);
    await pull(cfg, db);
  } catch (err) {
    log.warn({ err }, 'Initial sync error (non-fatal)');
  }

  // watch for changes
  const watchPaths = cfg.include
    .filter((e) => !isOpenAIPath(e.path))
    .map(resolvedIncludePath)
    .filter(fs.existsSync);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const watcher = chokidar.watch(watchPaths, {
    persistent: true,
    ignoreInitial: true,
    usePolling: false,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    ignored: [
      '**/node_modules/**',
      '**/*.tmp',
      '**/*.temp',
      '**/*.swp',
      '**/*.lock',
      '**/*.sstmp.*',
    ],
  });

  watcher.on('all', (_event, changedPath) => {
    log.debug({ changedPath }, 'File change detected');
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      indexAll(cfg, db)
        .then(() => push(cfg, db))
        .catch((err) => log.warn({ err }, 'Watch push error'));
    }, DEBOUNCE_MS);
  });

  // periodic pull
  const pullTimer = setInterval(async () => {
    try {
      await pull(cfg, db);
    } catch (err) {
      log.warn({ err }, 'Periodic pull error');
    }
  }, cfg.pullIntervalMs);

  // lock renewal every 60s
  const lockTimer = setInterval(async () => {
    try {
      const locks = listActiveLocks(cfg);
      for (const { source, projectKey, lock } of locks) {
        if (lock.machineId === cfg.machineId) {
          await renewLock(cfg, source, projectKey);
        }
      }
    } catch (err) {
      log.warn({ err }, 'Lock renewal error');
    }
  }, 60_000);

  // signal handlers
  const cleanup = (): void => {
    log.info('Daemon shutting down');
    clearInterval(pullTimer);
    clearInterval(lockTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    watcher.close().finally(() => {
      removePid();
      process.exit(0);
    });
  };

  process.on('SIGTERM', cleanup);
  process.on('SIGINT', cleanup);

  // keep alive
  return new Promise<never>(() => { /* forever */ });
}

export function stopDaemon(): void {
  const pid = readPid();
  if (!pid) {
    consoleError('Daemon is not running (no PID file).');
    process.exit(1);
  }
  try {
    process.kill(pid, 'SIGTERM');
    consoleLog(`Sent SIGTERM to daemon (pid ${pid})`);
    removePid();
  } catch {
    consoleError(`Could not stop daemon with pid ${pid} (already stopped?)`);
    removePid();
  }
}
