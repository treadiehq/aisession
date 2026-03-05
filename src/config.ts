import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { z } from 'zod';
import { CONFIG_PATH, SS_DIR, expandHome } from './paths.js';
import { type SyncProvider } from './platform/providerPaths.js';

const IncludeEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
});

const SyncConfigSchema = z.object({
  provider: z.enum(['icloud', 'dropbox', 'googledrive', 'onedrive', 'custom']),
  syncRoot: z.string(),
  customRoot: z.string().optional(),
});

export const ConfigSchema = z.object({
  machineId: z.string(),
  sync: SyncConfigSchema,
  include: z.array(IncludeEntrySchema),
  exclude: z.array(z.string()),
  redactFileNamePatterns: z.array(z.string()),
  pollIntervalMs: z.number().int().positive(),
  pullIntervalMs: z.number().int().positive(),
  lockTtlMs: z.number().int().positive(),
});

// Keep a flat accessor for code that reads cfg.syncRoot directly
export type Config = z.infer<typeof ConfigSchema> & { syncRoot: string };
export type IncludeEntry = z.infer<typeof IncludeEntrySchema>;
export type SyncConfig = z.infer<typeof SyncConfigSchema>;

const DEFAULT_INCLUDE: IncludeEntry[] = [
  { name: 'claude', path: '~/.claude' },
  { name: 'codex', path: '~/.codex' },
  { name: 'opencode', path: '~/.opencode' },
  { name: 'cursor', path: '~/Library/Application Support/Cursor/User/workspaceStorage' },
];

const DEFAULT_EXCLUDE = [
  '**/Cache/**',
  '**/*.lock',
  '**/*.tmp',
  '**/*.temp',
  '**/*.swp',
  '**/node_modules/**',
];

const DEFAULT_REDACT = [
  '*token*',
  '*auth*',
  '*credential*',
  '*api_key*',
  '*.pem',
  '*.key',
  '*.env',
];

function generateMachineId(): string {
  const hostname = os.hostname();
  let serial = '';
  if (process.platform === 'darwin') {
    try {
      serial = execSync(
        "system_profiler SPHardwareDataType 2>/dev/null | awk '/Serial Number/{print $NF}'",
        { timeout: 3000 },
      )
        .toString()
        .trim();
    } catch { /* ignore */ }
  }
  if (serial) {
    return createHash('sha256').update(hostname + serial).digest('hex').slice(0, 16);
  }
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function defaultSyncRoot(): string {
  if (process.platform === 'darwin') {
    return path.join(
      os.homedir(),
      'Library',
      'Mobile Documents',
      'com~apple~CloudDocs',
      'SessionSync',
    );
  }
  // Generic fallback — user should run ais setup to pick a real provider
  return path.join(os.homedir(), 'SessionSync');
}

/** Attach a flat syncRoot getter so existing call-sites don't need changes. */
function attachSyncRoot(cfg: z.infer<typeof ConfigSchema>): Config {
  const obj = cfg as Config;
  Object.defineProperty(obj, 'syncRoot', {
    get() { return (this as Config).sync.syncRoot; },
    enumerable: false,
    configurable: true,
  });
  return obj;
}

/** Migrate a legacy flat config (had top-level syncRoot) to the new nested format. */
function migrateIfNeeded(raw: Record<string, unknown>): Record<string, unknown> {
  if (!raw['sync'] && typeof raw['syncRoot'] === 'string') {
    const legacySyncRoot = raw['syncRoot'] as string;
    raw['sync'] = {
      provider: 'icloud' as SyncProvider,
      syncRoot: legacySyncRoot,
    };
    delete raw['syncRoot'];
  }
  return raw;
}

export function buildDefaultConfig(): Config {
  const syncRoot = defaultSyncRoot();
  return attachSyncRoot({
    machineId: generateMachineId(),
    sync: {
      provider: process.platform === 'darwin' ? 'icloud' : ('custom' as SyncProvider),
      syncRoot,
    },
    include: DEFAULT_INCLUDE,
    exclude: DEFAULT_EXCLUDE,
    redactFileNamePatterns: DEFAULT_REDACT,
    pollIntervalMs: 1500,
    pullIntervalMs: 30000,
    lockTtlMs: 600000,
  });
}

export function loadConfig(): Config {
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(`Config not found. Run 'ais init' first.`);
  }
  let raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) as Record<string, unknown>;
  raw = migrateIfNeeded(raw);

  // Write back migrated config transparently
  const parsed = ConfigSchema.parse(raw);
  const wasLegacy = !fs.readFileSync(CONFIG_PATH, 'utf8').includes('"sync"');
  if (wasLegacy) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(parsed, null, 2), { encoding: 'utf8', mode: 0o600 });
  }

  return attachSyncRoot(parsed);
}

export function saveConfig(cfg: Config): void {
  fs.mkdirSync(SS_DIR, { recursive: true });
  // Strip the virtual syncRoot getter before serialising
  const { ...plain } = cfg;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(plain, null, 2), { encoding: 'utf8', mode: 0o600 });
}

export function resolvedIncludePath(entry: IncludeEntry): string {
  return expandHome(entry.path);
}

const OPENAI_PATH_VARIANTS = [
  path.join(os.homedir(), '.openai'),
  expandHome('~/.openai'),
];

export function isOpenAIPath(p: string): boolean {
  const normalized = expandHome(p);
  return OPENAI_PATH_VARIANTS.some(
    (variant) => normalized === variant || normalized.startsWith(variant + path.sep),
  );
}
