import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { LOG_DIR, LOG_PATH } from './paths.js';

const _loggers = new Map<string, pino.Logger>();

export function getLogger(name = 'ais'): pino.Logger {
  const existing = _loggers.get(name);
  if (existing) return existing;

  fs.mkdirSync(LOG_DIR, { recursive: true });

  const logger = pino(
    {
      name,
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    pino.destination({ dest: LOG_PATH, sync: true }),
  );

  _loggers.set(name, logger);
  return logger;
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
