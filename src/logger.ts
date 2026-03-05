import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { LOG_DIR, LOG_PATH } from './paths.js';

let _logger: pino.Logger | null = null;

export function getLogger(name = 'ais'): pino.Logger {
  if (_logger) return _logger;

  fs.mkdirSync(LOG_DIR, { recursive: true });

  _logger = pino(
    {
      name,
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    pino.destination({ dest: LOG_PATH, sync: false }),
  );

  return _logger;
}

export function consoleLog(msg: string): void {
  process.stdout.write(msg + '\n');
}

export function consoleError(msg: string): void {
  process.stderr.write(msg + '\n');
}

export function consoleWarn(msg: string): void {
  process.stderr.write('[WARN] ' + msg + '\n');
}
