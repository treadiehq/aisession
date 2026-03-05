/**
 * Session sharing: export + compress into a .ssbundle (tar.gz) archive.
 *
 * Usage: ais share <sessionId>
 * Output: ./session-<id>.ssbundle
 *
 * Fully offline – no network required.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { exportSession } from '../export/exportSession.js';
import { getNormalizedSession } from '../sessionModel/sessionStore.js';
import { consoleLog, consoleError } from '../logger.js';

export async function shareSession(rawSessionId: string, outFile?: string): Promise<string> {
  const meta = getNormalizedSession(rawSessionId);
  if (!meta) {
    consoleError(`Session not found: ${rawSessionId}. Run 'ais normalize' first.`);
    process.exit(1);
  }

  const shortId = meta.sessionId.slice(0, 12);
  // Use full session id as the directory name inside the archive so paths are unambiguous.
  // Only the bundle filename uses the short id for convenience.
  const dirName = `session-${meta.sessionId}`;
  const bundleFile = outFile ?? path.join(process.cwd(), `session-${shortId}.ssbundle`);

  // Export to a temp directory
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ais-share-'));
  const exportDir = path.join(tmpDir, dirName);

  try {
    await exportSession(meta.sessionId, exportDir);

    // Create tar.gz archive
    execSync(
      `tar -czf "${bundleFile}" -C "${tmpDir}" "${dirName}"`,
      { timeout: 30_000 },
    );

    consoleLog(`Bundle created: ${bundleFile}`);
    consoleLog(`Share this file with teammates. They can extract it with:`);
    consoleLog(`  tar -xzf ${path.basename(bundleFile)}`);
    consoleLog(`  cat ${dirName}/transcript.md`);

    return bundleFile;
  } finally {
    // cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
