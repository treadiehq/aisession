import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { snapshotDir, SNAPSHOTS_DIR } from '../paths.js';
import { getLogger } from '../logger.js';
import { atomicCopy } from '../sync/copy.js';
import { isProcessRunning, isFileLocked } from '../platform/process.js';

export type SnapshotResult = {
  snapshotId: string;
  snapshotPath: string;
  source: string;
};

export async function snapshotCursorDb(
  absPath: string,
  source: string,
): Promise<SnapshotResult | null> {
  const log = getLogger();
  try {
    const hash = createHash('sha1').update(absPath).digest('hex').slice(0, 8);
    const snapshotId = `${hash}-${Date.now()}`;
    const dir = snapshotDir(source, snapshotId);
    fs.mkdirSync(dir, { recursive: true });

    const destPath = path.join(dir, path.basename(absPath));
    await atomicCopy(absPath, destPath);

    // Copy WAL and SHM sibling files to prevent SQLite corruption on restore
    for (const suffix of ['-wal', '-shm']) {
      const sibling = absPath + suffix;
      if (fs.existsSync(sibling)) {
        await atomicCopy(sibling, destPath + suffix);
      }
    }

    log.info({ source, absPath, snapshotId }, 'Created cursor snapshot');
    return { snapshotId, snapshotPath: destPath, source };
  } catch (err) {
    log.warn({ err, absPath }, 'Failed to create cursor snapshot');
    return null;
  }
}

export function listSnapshots(source: string): Array<{ snapshotId: string; files: string[] }> {
  const sourceDir = path.join(SNAPSHOTS_DIR, source);
  if (!fs.existsSync(sourceDir)) return [];
  const results: Array<{ snapshotId: string; files: string[] }> = [];
  try {
    for (const snapshotId of fs.readdirSync(sourceDir)) {
      const dir = path.join(sourceDir, snapshotId);
      try {
        const files = fs.readdirSync(dir);
        results.push({ snapshotId, files });
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  return results;
}

export async function restoreCursorSnapshot(
  snapshotId: string,
  toDir: string,
  source = 'cursor',
): Promise<void> {
  const log = getLogger();
  const sourceDir = path.join(SNAPSHOTS_DIR, source);
  const dir = path.resolve(snapshotDir(source, snapshotId));
  if (!dir.startsWith(path.resolve(sourceDir) + path.sep)) {
    throw new Error(`Invalid snapshot ID: ${snapshotId}`);
  }
  if (!fs.existsSync(dir)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  await assertCursorNotRunning();

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const srcPath = path.join(dir, file);
    const destPath = path.join(toDir, file);

    assertFileNotOpen(destPath);
    await atomicCopy(srcPath, destPath);
    log.info({ snapshotId, destPath }, 'Restored cursor snapshot file');
  }
}

async function assertCursorNotRunning(): Promise<void> {
  const running = await isProcessRunning(['Cursor', 'cursor']);
  if (running) {
    throw new Error(
      'Cursor appears to be running. Close Cursor before restoring a snapshot.',
    );
  }
}

function assertFileNotOpen(filePath: string): void {
  if (isFileLocked(filePath)) {
    throw new Error(`File is open by another process: ${filePath}`);
  }
}
