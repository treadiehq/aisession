import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();

export function expandHome(p: string): string {
  if (p.startsWith('~/')) return path.join(HOME, p.slice(2));
  if (p === '~') return HOME;
  return p;
}

export const SS_DIR = path.join(HOME, '.sessionsync');
export const CONFIG_PATH = path.join(SS_DIR, 'config.json');
export const DB_PATH = path.join(SS_DIR, 'index.db');
export const LOG_DIR = path.join(SS_DIR, 'logs');
export const LOG_PATH = path.join(LOG_DIR, 'ss.log');
export const CACHE_DIR = path.join(SS_DIR, 'cache', 'machines');
export const SNAPSHOTS_DIR = path.join(SS_DIR, 'snapshots');
export const SESSIONS_DIR = path.join(SS_DIR, 'sessions');
export const DAEMON_PID_FILE = path.join(SS_DIR, 'daemon.pid');

export function normalizedSessionDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId);
}

export const ICLOUD_ROOT = path.join(
  HOME,
  'Library',
  'Mobile Documents',
  'com~apple~CloudDocs',
  'SessionSync',
);

export function syncMachineDir(syncRoot: string, machineId: string): string {
  return path.join(syncRoot, 'machines', machineId);
}

export function lockDir(syncRoot: string): string {
  return path.join(syncRoot, 'locks');
}

export function lockFilePath(syncRoot: string, source: string, projectKey: string): string {
  return path.join(lockDir(syncRoot), source, `${projectKey}.lock.json`);
}

export function snapshotDir(source: string, snapshotId: string): string {
  return path.join(SNAPSHOTS_DIR, source, snapshotId);
}

export function cacheDir(machineId: string, source: string): string {
  return path.join(CACHE_DIR, machineId, source);
}
