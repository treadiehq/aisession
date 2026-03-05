import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import os from 'node:os';
import { detectOS } from '../platform/detectOS.js';
import {
  detectProviders,
  resolveSyncRoot,
  PROVIDER_LABELS,
  type SyncProvider,
} from '../platform/providerPaths.js';
import { detectSourcePaths } from '../platform/sourcePaths.js';
import { loadConfig, saveConfig, buildDefaultConfig, type Config } from '../config.js';
import { CONFIG_PATH } from '../paths.js';
import { consoleLog, consoleWarn } from '../logger.js';

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export interface SetupOptions {
  nonInteractive?: boolean;
  provider?: SyncProvider;
  path?: string;
}

export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  const platform = detectOS();
  consoleLog('');
  consoleLog('=== SessionSync Setup ===');
  consoleLog(`OS: ${platform}`);
  consoleLog('');

  let provider: SyncProvider;
  let syncRoot: string;

  if (opts.nonInteractive) {
    if (!opts.provider) throw new Error('--provider is required in non-interactive mode');
    provider = opts.provider;
    try {
      syncRoot = resolveSyncRoot(provider, opts.path);
    } catch (err) {
      if (opts.path) {
        syncRoot = path.join(opts.path, 'SessionSync');
      } else {
        throw err;
      }
    }
  } else {
    const detections = detectProviders();

    consoleLog('Available sync providers:');
    for (let i = 0; i < detections.length; i++) {
      const d = detections[i]!;
      const status = d.rootPath ? `  ✓ ${d.rootPath}` : '  (not detected)';
      consoleLog(`  ${i + 1}. ${d.label}${status}`);
    }
    consoleLog('');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    let choice: number | null = null;
    while (choice === null) {
      const raw = await ask(rl, `Select provider [1-${detections.length}]: `);
      const n = parseInt(raw.trim(), 10);
      if (n >= 1 && n <= detections.length) {
        choice = n - 1;
      } else {
        consoleLog('Invalid choice, please try again.');
      }
    }

    const selected = detections[choice]!;
    provider = selected.provider;

    if (provider === 'custom' || !selected.rootPath) {
      const defaultPath = selected.rootPath ?? path.join(os.homedir(), 'SessionSync');
      const raw = await ask(rl, `Enter sync folder path [${defaultPath}]: `);
      const customPath = raw.trim() || defaultPath;
      syncRoot = path.join(customPath, 'SessionSync');
    } else {
      syncRoot = path.join(selected.rootPath, 'SessionSync');
    }

    rl.close();
  }

  consoleLog('');
  consoleLog(`Provider:  ${PROVIDER_LABELS[provider]}`);
  consoleLog(`Sync root: ${syncRoot}`);
  consoleLog('');

  // Load or create config
  let cfg: Config;
  if (fs.existsSync(CONFIG_PATH)) {
    cfg = loadConfig();
  } else {
    cfg = buildDefaultConfig();
  }

  cfg.sync = { provider, syncRoot, customRoot: opts.path };

  // Auto-fill include paths from platform detection
  const sources = detectSourcePaths();
  const updatedInclude = cfg.include.map((entry) => {
    const detected = sources.find((s) => s.name === entry.name);
    if (detected) {
      return { ...entry, path: detected.path };
    }
    return entry;
  });
  cfg.include = updatedInclude;

  saveConfig(cfg);
  consoleLog(`Config saved to ${CONFIG_PATH}`);
  consoleLog('');
  consoleLog('Next steps:');
  consoleLog('  ss init');
  consoleLog('  ss daemon:start');
  consoleLog('');
}
