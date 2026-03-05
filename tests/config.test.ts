import { describe, it, expect } from 'vitest';
import { ConfigSchema, buildDefaultConfig, isOpenAIPath } from '../src/config.js';

describe('ConfigSchema validation', () => {
  it('accepts a valid default config', () => {
    const cfg = buildDefaultConfig();
    const result = ConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const result = ConfigSchema.safeParse({ sync: { provider: 'icloud', syncRoot: '/tmp' } });
    expect(result.success).toBe(false);
  });

  it('rejects negative pollIntervalMs', () => {
    const cfg = { ...buildDefaultConfig(), pollIntervalMs: -1 };
    const result = ConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('rejects non-integer pollIntervalMs', () => {
    const cfg = { ...buildDefaultConfig(), pollIntervalMs: 1.5 };
    const result = ConfigSchema.safeParse(cfg);
    expect(result.success).toBe(false);
  });

  it('accepts custom include entries', () => {
    const cfg = {
      ...buildDefaultConfig(),
      include: [{ name: 'custom', path: '~/custom' }],
    };
    const result = ConfigSchema.safeParse(cfg);
    expect(result.success).toBe(true);
  });

  it('has nested sync config with provider', () => {
    const cfg = buildDefaultConfig();
    expect(cfg.sync).toBeDefined();
    expect(['icloud', 'dropbox', 'googledrive', 'onedrive', 'custom']).toContain(cfg.sync.provider);
    expect(cfg.sync.syncRoot).toBeTruthy();
  });

  it('rejects invalid provider value', () => {
    const cfg = buildDefaultConfig();
    const result = ConfigSchema.safeParse({
      ...cfg,
      sync: { provider: 'ftp', syncRoot: '/tmp' },
    });
    expect(result.success).toBe(false);
  });
});

describe('isOpenAIPath', () => {
  it('detects ~/.openai', () => {
    const home = process.env['HOME'] ?? '/Users/test';
    expect(isOpenAIPath(home + '/.openai')).toBe(true);
    expect(isOpenAIPath('~/.openai')).toBe(true);
  });

  it('detects subdirs of ~/.openai', () => {
    const home = process.env['HOME'] ?? '/Users/test';
    expect(isOpenAIPath(home + '/.openai/credentials')).toBe(true);
  });

  it('does not flag ~/.claude', () => {
    const home = process.env['HOME'] ?? '/Users/test';
    expect(isOpenAIPath(home + '/.claude')).toBe(false);
    expect(isOpenAIPath('~/.claude')).toBe(false);
  });

  it('does not flag ~/.codex', () => {
    expect(isOpenAIPath('~/.codex')).toBe(false);
  });
});
