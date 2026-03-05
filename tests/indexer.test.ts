import { describe, it, expect } from 'vitest';
import { isRedacted, matchesExclude } from '../src/indexer.js';
import path from 'node:path';

describe('isRedacted', () => {
  const patterns = ['*token*', '*auth*', '*credential*', '*api_key*', '*.pem', '*.key'];

  it('flags files matching token pattern', () => {
    expect(isRedacted('my_token.json', patterns)).toBe(true);
    expect(isRedacted('access_token', patterns)).toBe(true);
  });

  it('flags files matching auth pattern', () => {
    expect(isRedacted('auth.json', patterns)).toBe(true);
    expect(isRedacted('oauth_credentials.json', patterns)).toBe(true);
  });

  it('flags .pem and .key files', () => {
    expect(isRedacted('server.pem', patterns)).toBe(true);
    expect(isRedacted('private.key', patterns)).toBe(true);
  });

  it('flags api_key files', () => {
    expect(isRedacted('openai_api_key.txt', patterns)).toBe(true);
  });

  it('does not flag normal session files', () => {
    expect(isRedacted('session.jsonl', patterns)).toBe(false);
    expect(isRedacted('chat.json', patterns)).toBe(false);
    expect(isRedacted('history.log', patterns)).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(isRedacted('My_TOKEN.json', patterns)).toBe(true);
    expect(isRedacted('AUTH.json', patterns)).toBe(true);
  });
});

describe('matchesExclude', () => {
  const patterns = ['**/Cache/**', '**/*.lock', '**/node_modules/**'];
  const baseDir = '/home/user/.claude';

  it('excludes cache paths', () => {
    expect(matchesExclude('/home/user/.claude/Cache/data', baseDir, patterns)).toBe(true);
  });

  it('excludes lock files', () => {
    expect(matchesExclude('/home/user/.claude/sessions/foo.lock', baseDir, patterns)).toBe(true);
  });

  it('excludes node_modules', () => {
    expect(matchesExclude('/home/user/.claude/node_modules/pkg/index.js', baseDir, patterns)).toBe(true);
  });

  it('does not exclude normal files', () => {
    expect(matchesExclude('/home/user/.claude/sessions/chat.jsonl', baseDir, patterns)).toBe(false);
    expect(matchesExclude('/home/user/.claude/config.json', baseDir, patterns)).toBe(false);
  });
});
