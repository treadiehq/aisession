/**
 * Session replay engine.
 *
 * Reads turns.jsonl from the normalized session store and replays them
 * step-by-step to stdout. Does not require original tools.
 */

import { readTurns, readMetadata, getNormalizedSession } from '../sessionModel/sessionStore.js';
import { SESSIONS_DIR } from '../paths.js';
import { consoleLog, consoleError } from '../logger.js';
import fs from 'node:fs';
import path from 'node:path';

export type ReplayOptions = {
  speed: 'normal' | 'fast';
  step: boolean;
};

const STEP_DELAY_MS: Record<ReplayOptions['speed'], number> = {
  normal: 600,
  fast: 0,
};

export async function replaySession(rawSessionId: string, opts: ReplayOptions): Promise<void> {
  const meta = getNormalizedSession(rawSessionId);
  if (!meta) {
    consoleError(`Session not found in normalized store: ${rawSessionId}`);
    consoleError(`Run 'ais normalize' or 'ais push' to index sessions first.`);
    process.exit(1);
  }

  const turns = await readTurns(meta.sessionId);
  if (turns.length === 0) {
    consoleError(`No turns found for session ${meta.sessionId}.`);
    process.exit(1);
  }

  // Header
  consoleLog('');
  consoleLog('═'.repeat(60));
  consoleLog(`  SESSION REPLAY`);
  consoleLog(`  Source:  ${meta.source}`);
  consoleLog(`  Project: ${meta.projectHint || 'unknown'}`);
  consoleLog(`  Updated: ${new Date(meta.updatedAt).toLocaleString()}`);
  consoleLog(`  Turns:   ${turns.length}`);
  consoleLog('═'.repeat(60));
  consoleLog('');

  let stepNum = 0;
  for (const turn of turns) {
    if (turn.role === 'system') continue;
    stepNum++;

    consoleLog(`Step ${stepNum}`);
    consoleLog('─'.repeat(40));

    const label = turn.role === 'user' ? 'USER PROMPT' : 'ASSISTANT RESPONSE';
    consoleLog(label);
    consoleLog('');
    consoleLog(turn.content.trim());
    consoleLog('');

    if (opts.step) {
      await waitForEnter();
    } else if (STEP_DELAY_MS[opts.speed] > 0) {
      await sleep(STEP_DELAY_MS[opts.speed]);
    }
  }

  consoleLog('─'.repeat(40));
  consoleLog(`Replay complete. (${stepNum} steps)`);
  consoleLog('');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForEnter(): Promise<void> {
  process.stdout.write('  [Press ENTER for next step] ');
  return new Promise((resolve) => {
    const handler = (): void => {
      process.stdin.removeListener('data', handler);
      process.stdin.pause();
      resolve();
    };
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    process.stdin.once('data', handler);
  });
}
