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

export function detectCodex(
  absPath: string,
  relPath: string,
  _baseDir: string,
): SessionCandidate[] {
  const ext = path.extname(absPath).toLowerCase();
  if (ext !== '.jsonl' && ext !== '.json') return [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return [];
  }

  const kind = ext === '.jsonl' ? 'codex_jsonl' : 'codex_json';
  const id = createHash('sha256').update('codex:' + relPath).digest('hex').slice(0, 20);
  const project_hint = extractProjectHint(relPath);

  return [
    {
      id,
      source: 'codex',
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
  // codex sessions are often in sessions/<sessionId>.jsonl
  if (parts.length >= 2) {
    return parts[parts.length - 2];
  }
  return path.basename(relPath, path.extname(relPath));
}
