import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig, isOpenAIPath, resolvedIncludePath } from './config.js';
import { CONFIG_PATH, SS_DIR, SNAPSHOTS_DIR } from './paths.js';
import { consoleLog, consoleWarn } from './logger.js';
import { detectOS } from './platform/detectOS.js';

interface DoctorResult {
  ok: boolean;
  items: Array<{ label: string; status: 'ok' | 'warn' | 'error'; detail?: string }>;
}

function check(
  result: DoctorResult,
  label: string,
  value: boolean,
  detail?: string,
  severity: 'ok' | 'warn' | 'error' = 'error',
): void {
  if (value) {
    result.items.push({ label, status: 'ok', detail });
  } else {
    result.items.push({ label, status: severity, detail });
    if (severity === 'error') result.ok = false;
  }
}

function canWrite(dirPath: string): boolean {
  try {
    fs.mkdirSync(dirPath, { recursive: true });
    const tmp = path.join(dirPath, `.ss-doctor-${Date.now()}`);
    fs.writeFileSync(tmp, '');
    fs.unlinkSync(tmp);
    return true;
  } catch {
    return false;
  }
}

export async function runDoctor(): Promise<boolean> {
  const result: DoctorResult = { ok: true, items: [] };

  // OS and Node version
  const platform = detectOS();
  const nodeVersion = process.version;
  result.items.push({ label: 'OS', status: 'ok', detail: `${platform} (${os.release()})` });
  result.items.push({ label: 'Node.js', status: 'ok', detail: nodeVersion });

  // Config
  const configExists = fs.existsSync(CONFIG_PATH);
  check(result, 'Config file exists', configExists, CONFIG_PATH);

  let cfg;
  if (configExists) {
    try {
      cfg = loadConfig();
      result.items.push({ label: 'Config valid', status: 'ok' });
    } catch (err) {
      result.items.push({
        label: 'Config valid',
        status: 'error',
        detail: `Parse error: ${String(err)}`,
      });
      result.ok = false;
    }
  }

  if (cfg) {
    // Sync provider + syncRoot
    result.items.push({
      label: 'Sync provider',
      status: 'ok',
      detail: cfg.sync.provider,
    });

    const syncRootExists = fs.existsSync(cfg.sync.syncRoot);
    check(
      result,
      'Sync root exists',
      syncRootExists,
      cfg.sync.syncRoot,
      'warn',
    );

    if (syncRootExists) {
      check(
        result,
        'Sync root writable',
        canWrite(cfg.sync.syncRoot),
        cfg.sync.syncRoot,
      );
    }

    // Locks folder
    const locksDir = path.join(cfg.sync.syncRoot, 'locks');
    if (syncRootExists) {
      check(result, 'Lock folder writable', canWrite(locksDir), locksDir, 'warn');
    }

    // Sources
    for (const entry of cfg.include) {
      const resolved = resolvedIncludePath(entry);
      const exists = fs.existsSync(resolved);
      check(
        result,
        `Source: ${entry.name}`,
        exists,
        resolved,
        'warn',
      );

      if (isOpenAIPath(entry.path)) {
        result.items.push({
          label: `Source: ${entry.name}`,
          status: 'warn',
          detail: `~/.openai is included — this may contain credentials!`,
        });
      }
    }

    // Exclude / redact active
    check(
      result,
      'Exclude patterns configured',
      cfg.exclude.length > 0,
      `${cfg.exclude.length} pattern(s)`,
    );
    check(
      result,
      'Redact patterns configured',
      cfg.redactFileNamePatterns.length > 0,
      `${cfg.redactFileNamePatterns.length} pattern(s)`,
    );
  }

  // Snapshots dir
  check(result, 'Snapshots folder writable', canWrite(SNAPSHOTS_DIR), SNAPSHOTS_DIR, 'warn');

  // SessionSync base dir
  check(result, 'SessionSync dir writable', canWrite(SS_DIR), SS_DIR);

  // Large binary file warning (scan cursor workspace storage)
  if (cfg) {
    let largeDbCount = 0;
    for (const entry of cfg.include) {
      if (entry.name !== 'cursor') continue;
      const p = resolvedIncludePath(entry);
      if (!fs.existsSync(p)) continue;
      try {
        for (const sub of fs.readdirSync(p)) {
          const subDir = path.join(p, sub);
          try {
            for (const f of fs.readdirSync(subDir)) {
              if (f.endsWith('.vscdb') || f.endsWith('.sqlite') || f.endsWith('.db')) {
                const stat = fs.statSync(path.join(subDir, f));
                if (stat.size > 50 * 1024 * 1024) largeDbCount++;
              }
            }
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    }
    if (largeDbCount > 0) {
      result.items.push({
        label: 'Large DB files',
        status: 'warn',
        detail: `${largeDbCount} DB file(s) > 50MB detected — snapshots may be slow`,
      });
    }
  }

  // Print results
  consoleLog('');
  consoleLog('=== ss doctor ===');
  consoleLog('');

  const icons: Record<string, string> = { ok: '✓', warn: '⚠', error: '✗' };
  for (const item of result.items) {
    const icon = icons[item.status] ?? '?';
    const detail = item.detail ? `  (${item.detail})` : '';
    consoleLog(`  ${icon}  ${item.label}${detail}`);
  }

  consoleLog('');
  if (result.ok) {
    consoleLog('All critical checks passed.');
  } else {
    consoleLog('One or more critical checks FAILED. Please fix the issues above.');
  }
  consoleLog('');

  return result.ok;
}
