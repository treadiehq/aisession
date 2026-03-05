import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { snapshotDir } from '../paths.js';
import { getLogger } from '../logger.js';
import { atomicCopy } from '../sync/copy.js';
import { isProcessRunning, isFileLocked } from '../platform/process.js';

export type SnapshotResult = {
  snapshotId: string;
  snapshotPath: string;
  source: string;
};

export async function snapshotOpencodeDb(
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
    log.info({ source, absPath, snapshotId }, 'Created opencode snapshot');
    return { snapshotId, snapshotPath: destPath, source };
  } catch (err) {
    log.warn({ err, absPath }, 'Failed to create opencode snapshot');
    return null;
  }
}

export async function restoreOpencodeSnapshot(
  snapshotId: string,
  toPath: string,
  source = 'opencode',
): Promise<void> {
  const log = getLogger();
  const dir = snapshotDir(source, snapshotId);
  if (!fs.existsSync(dir)) {
    throw new Error(`Snapshot not found: ${snapshotId}`);
  }

  await assertOpencodeNotRunning();

  const files = fs.readdirSync(dir);
  for (const file of files) {
    const srcPath = path.join(dir, file);
    const destPath = path.isAbsolute(toPath) ? toPath : path.join(toPath, file);

    assertFileNotOpen(destPath);
    await atomicCopy(srcPath, destPath);
    log.info({ snapshotId, destPath }, 'Restored opencode snapshot file');
  }
}

async function assertOpencodeNotRunning(): Promise<void> {
  const running = await isProcessRunning(['OpenCode', 'opencode']);
  if (running) {
    throw new Error(
      'OpenCode appears to be running. Close it before restoring a snapshot.',
    );
  }
}

function assertFileNotOpen(filePath: string): void {
  if (isFileLocked(filePath)) {
    throw new Error(`File is open by another process: ${filePath}`);
  }
}
