import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getLogger } from '../logger.js';

/**
 * Atomically copy src -> dest via a temp file + rename.
 */
export async function atomicCopy(src: string, dest: string): Promise<void> {
  const log = getLogger();
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });

  const tmp = dest + '.sstmp.' + Date.now();
  try {
    fs.copyFileSync(src, tmp);
    const srcStat = fs.statSync(src);
    fs.utimesSync(tmp, srcStat.atime, srcStat.mtime);
    fs.renameSync(tmp, dest);
    log.debug({ src, dest }, 'Copied file');
  } catch (err) {
    // cleanup temp if left behind
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function fileChanged(
  srcStat: fs.Stats,
  destStat: fs.Stats | null,
): boolean {
  if (!destStat) return true;
  if (srcStat.size !== destStat.size) return true;
  if (Math.abs(srcStat.mtimeMs - destStat.mtimeMs) > 1000) return true;
  return false;
}

export function hashFile(absPath: string): string | null {
  const MAX = 5 * 1024 * 1024;
  try {
    const stat = fs.statSync(absPath);
    if (stat.size > MAX) return null;
    return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
  } catch {
    return null;
  }
}

export function statOrNull(p: string): fs.Stats | null {
  try { return fs.statSync(p); } catch { return null; }
}
