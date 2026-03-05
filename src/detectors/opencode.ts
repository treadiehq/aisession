import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

const DB_EXTS = new Set(['.sqlite', '.db']);
const TEXT_EXTS = new Set(['.jsonl', '.json', '.log']);

export function detectOpencode(
  absPath: string,
  relPath: string,
  _baseDir: string,
): SessionCandidate[] {
  const ext = path.extname(absPath).toLowerCase();
  if (!DB_EXTS.has(ext) && !TEXT_EXTS.has(ext)) return [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return [];
  }

  let kind: string;
  if (ext === '.jsonl') kind = 'opencode_jsonl';
  else if (ext === '.json') kind = 'opencode_json';
  else if (ext === '.log') kind = 'opencode_log';
  else kind = 'opencode_db'; // .sqlite/.db

  const id = createHash('sha256').update('opencode:' + absPath).digest('hex').slice(0, 20);
  const project_hint = extractProjectHint(relPath);

  return [
    {
      id,
      source: 'opencode',
      kind,
      project_hint,
      updated_at_ms: stat.mtimeMs,
      file_rel_path: relPath,
      file_abs_path: absPath,
      snapshot_id: null,
    },
  ];
}

function extractProjectHint(relPath: string): string {
  const parts = relPath.split(path.sep).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return path.basename(relPath, path.extname(relPath));
}
