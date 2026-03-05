import fs from 'node:fs';
import Database from 'better-sqlite3';
import { DB_PATH, SS_DIR } from './paths.js';

export type FileRow = {
  id: number;
  source_id: number;
  rel_path: string;
  abs_path: string;
  mtime_ms: number;
  size: number;
  hash: string | null;
  last_seen_ms: number;
};

export type SessionRow = {
  id: string;
  source: string;
  kind: string;
  project_hint: string;
  updated_at_ms: number;
  file_rel_path: string;
  file_abs_path: string;
  snapshot_id: string | null;
};

export type SourceRow = {
  id: number;
  name: string;
  local_path: string;
  enabled: number;
};

export type MetaRow = {
  key: string;
  value: string;
};

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  fs.mkdirSync(SS_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  // Restrict DB file to owner-only after creation
  try { fs.chmodSync(DB_PATH, 0o600); } catch { /* ignore on platforms that don't support chmod */ }
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  migrate(_db);
  return _db;
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sources (
      id INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      local_path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY,
      source_id INTEGER NOT NULL,
      rel_path TEXT NOT NULL,
      abs_path TEXT NOT NULL,
      mtime_ms INTEGER NOT NULL,
      size INTEGER NOT NULL,
      hash TEXT,
      last_seen_ms INTEGER NOT NULL,
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
      snapshot_id TEXT
    );

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_files_source ON files(source_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at_ms DESC);
  `);
}

export function upsertSource(
  db: Database.Database,
  name: string,
  localPath: string,
  enabled = 1,
): void {
  db.prepare(
    `INSERT INTO sources (name, local_path, enabled) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET local_path=excluded.local_path, enabled=excluded.enabled`,
  ).run(name, localPath, enabled);
}

export function getSource(db: Database.Database, name: string): SourceRow | undefined {
  return db.prepare('SELECT * FROM sources WHERE name=?').get(name) as SourceRow | undefined;
}

export function getAllSources(db: Database.Database): SourceRow[] {
  return db.prepare('SELECT * FROM sources ORDER BY id').all() as SourceRow[];
}

export function upsertFile(
  db: Database.Database,
  sourceId: number,
  relPath: string,
  absPath: string,
  mtimeMs: number,
  size: number,
  hash: string | null,
): void {
  db.prepare(
    `INSERT INTO files (source_id, rel_path, abs_path, mtime_ms, size, hash, last_seen_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, rel_path) DO UPDATE SET
       mtime_ms=excluded.mtime_ms,
       size=excluded.size,
       hash=excluded.hash,
       last_seen_ms=excluded.last_seen_ms`,
  ).run(sourceId, relPath, absPath, mtimeMs, size, hash, Date.now());
}

export function getFile(
  db: Database.Database,
  sourceId: number,
  relPath: string,
): FileRow | undefined {
  return db
    .prepare('SELECT * FROM files WHERE source_id=? AND rel_path=?')
    .get(sourceId, relPath) as FileRow | undefined;
}

export function upsertSession(db: Database.Database, s: Omit<SessionRow, 'id'> & { id: string }): void {
  db.prepare(
    `INSERT INTO sessions (id, source, kind, project_hint, updated_at_ms, file_rel_path, file_abs_path, snapshot_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind=excluded.kind,
       project_hint=excluded.project_hint,
       updated_at_ms=excluded.updated_at_ms,
       file_rel_path=excluded.file_rel_path,
       file_abs_path=excluded.file_abs_path,
       snapshot_id=excluded.snapshot_id`,
  ).run(
    s.id, s.source, s.kind, s.project_hint, s.updated_at_ms,
    s.file_rel_path, s.file_abs_path, s.snapshot_id ?? null,
  );
}

export function listSessions(db: Database.Database, limit = 50): SessionRow[] {
  return db
    .prepare('SELECT * FROM sessions ORDER BY updated_at_ms DESC LIMIT ?')
    .all(limit) as SessionRow[];
}

export function getSession(db: Database.Database, id: string): SessionRow | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id=?').get(id) as SessionRow | undefined;
}

export function getMeta(db: Database.Database, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get(key) as MetaRow | undefined;
  return row?.value;
}

export function setMeta(db: Database.Database, key: string, value: string): void {
  db.prepare(
    `INSERT INTO meta (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(key, value);
}
