import fs from 'node:fs';

/**
 * Cross-platform process detection using ps-list.
 * Checks if any process whose name matches one of the given patterns is running.
 */
export async function isProcessRunning(names: string[]): Promise<boolean> {
  try {
    const myPid = process.pid;
    const psList = await import('ps-list');
    const list = await psList.default();
    const lowerNames = names.map((n) => n.toLowerCase());
    return list.some((proc) => {
      if (proc.pid === myPid) return false;
      const procName = (proc.name ?? '').toLowerCase();
      const cmd = (proc.cmd ?? '').toLowerCase();
      return lowerNames.some((n) => procName.includes(n) || cmd.includes(n));
    });
  } catch {
    return false;
  }
}

/**
 * Best-effort check whether a file is locked / open by another process.
 * On all platforms: attempt to open the file with exclusive write access.
 * Returns true if the file appears to be locked.
 */
export function isFileLocked(filePath: string): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, 'r+');
    fs.closeSync(fd);
    return false;
  } catch {
    return true;
  }
}
