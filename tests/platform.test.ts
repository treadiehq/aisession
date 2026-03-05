import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// ── detectOS ──────────────────────────────────────────────────────────────────
describe('detectOS', () => {
  it('returns darwin on macOS', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
    const { detectOS } = await import('../src/platform/detectOS.js');
    expect(detectOS()).toBe('darwin');
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('returns win32 on Windows', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const { detectOS } = await import('../src/platform/detectOS.js');
    expect(detectOS()).toBe('win32');
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  });

  it('returns linux on Linux', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const { detectOS } = await import('../src/platform/detectOS.js');
    expect(detectOS()).toBe('linux');
    Object.defineProperty(process, 'platform', { value: process.platform, configurable: true });
  });
});

// ── providerPaths ─────────────────────────────────────────────────────────────
describe('detectProviders', () => {
  it('always includes a custom entry', async () => {
    const { detectProviders } = await import('../src/platform/providerPaths.js');
    const providers = detectProviders();
    const custom = providers.find((p) => p.provider === 'custom');
    expect(custom).toBeDefined();
  });

  it('always returns at least 2 providers', async () => {
    const { detectProviders } = await import('../src/platform/providerPaths.js');
    const providers = detectProviders();
    expect(providers.length).toBeGreaterThanOrEqual(2);
  });

  it('each provider has required fields', async () => {
    const { detectProviders } = await import('../src/platform/providerPaths.js');
    const providers = detectProviders();
    for (const p of providers) {
      expect(typeof p.provider).toBe('string');
      expect(typeof p.label).toBe('string');
      // rootPath is string or null
      expect(p.rootPath === null || typeof p.rootPath === 'string').toBe(true);
    }
  });
});

describe('resolveSyncRoot', () => {
  it('resolves custom provider when path is given', async () => {
    const { resolveSyncRoot } = await import('../src/platform/providerPaths.js');
    const result = resolveSyncRoot('custom', '/tmp/mysync');
    expect(result).toBe(path.join('/tmp/mysync', 'SessionSync'));
  });

  it('throws for custom provider without path', async () => {
    const { resolveSyncRoot } = await import('../src/platform/providerPaths.js');
    expect(() => resolveSyncRoot('custom', undefined)).toThrow();
  });
});

// ── sourcePaths ───────────────────────────────────────────────────────────────
describe('detectSourcePaths', () => {
  it('returns all four source names', async () => {
    const { detectSourcePaths } = await import('../src/platform/sourcePaths.js');
    const sources = detectSourcePaths();
    const names = sources.map((s) => s.name);
    expect(names).toContain('claude');
    expect(names).toContain('codex');
    expect(names).toContain('opencode');
    expect(names).toContain('cursor');
  });

  it('each source has a non-empty path', async () => {
    const { detectSourcePaths } = await import('../src/platform/sourcePaths.js');
    const sources = detectSourcePaths();
    for (const s of sources) {
      expect(s.path).toBeTruthy();
    }
  });

  it('detected field is boolean', async () => {
    const { detectSourcePaths } = await import('../src/platform/sourcePaths.js');
    const sources = detectSourcePaths();
    for (const s of sources) {
      expect(typeof s.detected).toBe('boolean');
    }
  });
});

// ── config migration ──────────────────────────────────────────────────────────
describe('config schema migration', () => {
  it('new config has sync.provider and sync.syncRoot', async () => {
    const { buildDefaultConfig } = await import('../src/config.js');
    const cfg = buildDefaultConfig();
    expect(cfg.sync).toBeDefined();
    expect(typeof cfg.sync.provider).toBe('string');
    expect(typeof cfg.sync.syncRoot).toBe('string');
    expect(cfg.sync.syncRoot).toBeTruthy();
  });

  it('syncRoot getter on config returns sync.syncRoot', async () => {
    const { buildDefaultConfig } = await import('../src/config.js');
    const cfg = buildDefaultConfig();
    expect(cfg.syncRoot).toBe(cfg.sync.syncRoot);
  });
});
