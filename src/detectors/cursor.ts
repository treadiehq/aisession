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

const CURSOR_DB_NAMES = new Set(['state.vscdb']);
const CURSOR_DB_EXTS = new Set(['.vscdb', '.sqlite', '.db']);

export function detectCursor(
  absPath: string,
  relPath: string,
  _baseDir: string,
): SessionCandidate[] {
  const base = path.basename(absPath);
  const ext = path.extname(absPath).toLowerCase();

  const isCursorDb = CURSOR_DB_NAMES.has(base) || CURSOR_DB_EXTS.has(ext);
  if (!isCursorDb) return [];

  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return [];
  }

  const id = createHash('sha256').update('cursor:' + absPath).digest('hex').slice(0, 20);
  const project_hint = extractProjectHint(relPath, absPath);

  return [
    {
      id,
      source: 'cursor',
      kind: 'cursor_db',
      project_hint,
      updated_at_ms: stat.mtimeMs,
      file_rel_path: relPath,
      file_abs_path: absPath,
      snapshot_id: null,
    },
  ];
}

function extractProjectHint(relPath: string, absPath: string): string {
  // workspaceStorage/<hash>/state.vscdb -> use the hash dir as hint
  const parts = relPath.split(path.sep).filter(Boolean);
  if (parts.length >= 2) {
    // The workspace hash dir often contains a workspace.json we can try to read
    const wsDir = path.join(path.dirname(absPath), '..');
    const workspaceJson = path.resolve(wsDir, 'workspace.json');
    try {
      const content = JSON.parse(fs.readFileSync(workspaceJson, 'utf8')) as Record<string, unknown>;
      const folder = (content['folder'] as string) ?? '';
      if (folder) {
        // folder is a URI like file:///Users/...
        const decoded = decodeURIComponent(folder.replace(/^file:\/\//, ''));
        return path.basename(decoded);
      }
    } catch {
      // ignore
    }
    return parts[parts.length - 2];
  }
  return path.basename(path.dirname(absPath));
}
