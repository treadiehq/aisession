#!/usr/bin/env node
import { Command } from 'commander';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  saveConfig,
  buildDefaultConfig,
  resolvedIncludePath,
  isOpenAIPath,
  ConfigSchema,
} from './config.js';
import {
  SS_DIR,
  CONFIG_PATH,
  DB_PATH,
  LOG_DIR,
  CACHE_DIR,
  SNAPSHOTS_DIR,
  DAEMON_PID_FILE,
  expandHome,
} from './paths.js';
import { getDb, getAllSources, listSessions, getSession, getMeta } from './db.js';
import { indexAll, isRedacted, normalizeAll } from './indexer.js';
import { push } from './sync/push.js';
import { pull } from './sync/pull.js';
import { acquireLock, releaseLock } from './locks.js';
import { restoreCursorSnapshot } from './snapshots/cursor.js';
import { restoreOpencodeSnapshot } from './snapshots/opencode.js';
import { buildResumeBlock } from './resume.js';
import { daemonLoop, isDaemonRunning, readPid, stopDaemon } from './daemon.js';
import { discoverOpencode, formatDiscoverResults } from './discover/opencode.js';
import { consoleLog, consoleError, consoleWarn } from './logger.js';
import { buildGlobalTimeline, buildSessionTimeline, formatTimelineEntry } from './sessionModel/timeline.js';
import { listNormalizedSessions, getNormalizedSession } from './sessionModel/sessionStore.js';
import { replaySession } from './replay/replayEngine.js';
import { exportSession } from './export/exportSession.js';
import { shareSession } from './share/bundle.js';
import { startServer } from './server/api.js';
import { generateHandoff, formatHandoff, type HandoffOptions } from './handoff/generateHandoff.js';
import { runSetup } from './setup/interactive.js';
import { runDoctor } from './doctor.js';
import { detectSourcePaths } from './platform/sourcePaths.js';
import { detectProviders, resolveSyncRoot, type SyncProvider } from './platform/providerPaths.js';
import chokidar from 'chokidar';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const program = new Command();

program
  .name('ss')
  .description('AI Session Sync – multi-device continuity for Claude, Codex, Cursor, OpenCode')
  .version('0.1.0');

// ── setup ─────────────────────────────────────────────────────────────────────
program
  .command('setup')
  .description('Interactive setup: choose sync provider and auto-detect source paths')
  .option('--non-interactive', 'Non-interactive mode (requires --provider)')
  .option('--provider <name>', 'Provider: icloud | dropbox | googledrive | onedrive | custom')
  .option('--path <dir>', 'Custom folder path (required when provider=custom)')
  .action(async (opts) => {
    const provider = opts.provider as SyncProvider | undefined;
    await runSetup({
      nonInteractive: !!opts.nonInteractive,
      provider,
      path: opts.path,
    });
  });

// ── init ─────────────────────────────────────────────────────────────────────
program
  .command('init')
  .description('Initialize config, DB, and directories')
  .action(async () => {
    const dirs = [SS_DIR, LOG_DIR, CACHE_DIR, SNAPSHOTS_DIR];
    for (const d of dirs) fs.mkdirSync(d, { recursive: true });

    if (!fs.existsSync(CONFIG_PATH)) {
      const cfg = buildDefaultConfig();
      // Auto-fill include paths from platform detection
      const sources = detectSourcePaths();
      cfg.include = cfg.include.map((entry) => {
        const detected = sources.find((s) => s.name === entry.name);
        return detected ? { ...entry, path: detected.path } : entry;
      });
      saveConfig(cfg);
      consoleLog(`Created config at ${CONFIG_PATH}`);
      consoleLog(`Machine ID: ${cfg.machineId}`);
      consoleLog(`Sync provider: ${cfg.sync.provider} → ${cfg.sync.syncRoot}`);
    } else {
      consoleLog(`Config already exists at ${CONFIG_PATH}`);
    }

    // initialize DB
    const db = getDb();
    const cfg = loadConfig();
    for (const entry of cfg.include) {
      const { upsertSource } = await import('./db.js');
      upsertSource(db, entry.name, resolvedIncludePath(entry));
    }

    consoleLog(`DB initialized at ${DB_PATH}`);
    consoleLog('Done. Run `ss daemon:start` to begin syncing.');
  });

// ── config ───────────────────────────────────────────────────────────────────
program
  .command('config')
  .description('Print resolved config')
  .action(() => {
    const cfg = loadConfig();
    consoleLog(JSON.stringify(cfg, null, 2));
  });

// ── set-sync ──────────────────────────────────────────────────────────────────
program
  .command('set-sync')
  .description('Update the sync provider and root folder (alias: ss config set-sync)')
  .requiredOption('--provider <name>', 'Provider: icloud | dropbox | googledrive | onedrive | custom')
  .option('--path <dir>', 'Custom folder path (required when provider=custom)')
  .action((opts) => {
    const provider = opts.provider as SyncProvider;
    let syncRoot: string;
    try {
      syncRoot = resolveSyncRoot(provider, opts.path);
    } catch {
      if (opts.path) {
        syncRoot = path.join(opts.path, 'SessionSync');
      } else {
        consoleError('Could not resolve sync root. Use --path to specify manually.');
        process.exit(1);
        return;
      }
    }
    const cfg = loadConfig();
    cfg.sync = { provider, syncRoot, customRoot: opts.path };
    saveConfig(cfg);
    consoleLog(`Sync updated: provider=${provider} syncRoot=${syncRoot}`);
  });

// ── status ───────────────────────────────────────────────────────────────────
program
  .command('status')
  .description('Show sync status')
  .action(() => {
    const cfg = loadConfig();
    const db = getDb();
    const sources = getAllSources(db);
    const sessions = listSessions(db, 9999);
    const files = db.prepare('SELECT COUNT(*) as count FROM files').get() as { count: number };
    const lastPush = getMeta(db, 'last_push_ms');
    const lastPull = getMeta(db, 'last_pull_ms');
    const daemonRunning = isDaemonRunning();

    consoleLog('');
    consoleLog('=== AI Session Sync Status ===');
    consoleLog(`Machine ID:    ${cfg.machineId}`);
    consoleLog(`Provider:      ${cfg.sync.provider}`);
    consoleLog(`Sync Root:     ${cfg.sync.syncRoot}`);
    consoleLog(`Daemon:        ${daemonRunning ? `running (pid ${readPid()})` : 'stopped'}`);
    consoleLog(`Last push:     ${lastPush ? new Date(Number(lastPush)).toLocaleString() : 'never'}`);
    consoleLog(`Last pull:     ${lastPull ? new Date(Number(lastPull)).toLocaleString() : 'never'}`);
    consoleLog(`Indexed files: ${files.count}`);
    consoleLog(`Sessions:      ${sessions.length}`);
    consoleLog('');
    consoleLog('Sources:');
    for (const src of sources) {
      consoleLog(`  ${src.enabled ? '✓' : '✗'} ${src.name.padEnd(12)} ${src.local_path}`);
    }
    consoleLog('');
  });

// ── push ─────────────────────────────────────────────────────────────────────
program
  .command('push')
  .description('Push local session files to iCloud sync root')
  .action(async () => {
    const cfg = loadConfig();
    checkOpenAIWarning(cfg);
    const db = getDb();
    await indexAll(cfg, db);
    const count = await push(cfg, db);
    consoleLog(`Pushed ${count} file(s).`);
  });

// ── pull ─────────────────────────────────────────────────────────────────────
program
  .command('pull')
  .description('Pull sessions from other machines via iCloud')
  .action(async () => {
    const cfg = loadConfig();
    const db = getDb();
    const count = await pull(cfg, db);
    consoleLog(`Pulled ${count} file(s).`);
  });

// ── watch ─────────────────────────────────────────────────────────────────────
program
  .command('watch')
  .description('Watch for changes and push automatically')
  .action(async () => {
    const cfg = loadConfig();
    checkOpenAIWarning(cfg);
    const db = getDb();

    const watchPaths = cfg.include
      .filter((e) => !isOpenAIPath(e.path))
      .map(resolvedIncludePath)
      .filter(fs.existsSync);

    consoleLog(`Watching: ${watchPaths.join(', ')}`);

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const watcher = chokidar.watch(watchPaths, {
      persistent: true,
      ignoreInitial: true,
      usePolling: false,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      ignored: ['**/node_modules/**', '**/*.tmp', '**/*.sstmp.*'],
    });

    watcher.on('all', (_ev, p) => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(async () => {
        consoleLog(`Change detected, pushing...`);
        try {
          await indexAll(cfg, db);
          const count = await push(cfg, db);
          consoleLog(`Pushed ${count} file(s).`);
        } catch (err) {
          consoleError(`Push error: ${String(err)}`);
        }
      }, cfg.pollIntervalMs);
    });

    consoleLog('Press Ctrl+C to stop.');
    await new Promise<never>(() => { /* wait forever */ });
  });

// ── sessions ─────────────────────────────────────────────────────────────────
program
  .command('sessions')
  .description('List recent sessions')
  .option('--limit <n>', 'Max sessions to show', '20')
  .action((opts) => {
    const db = getDb();
    const limit = parseInt(opts.limit, 10) || 20;
    const sessions = listSessions(db, limit);

    if (sessions.length === 0) {
      consoleLog('No sessions indexed. Run `ss push` first.');
      return;
    }

    consoleLog('');
    consoleLog(
      'ID'.padEnd(22) +
      'SOURCE'.padEnd(12) +
      'KIND'.padEnd(18) +
      'PROJECT'.padEnd(25) +
      'UPDATED',
    );
    consoleLog('-'.repeat(100));

    for (const s of sessions) {
      const updated = new Date(s.updated_at_ms).toLocaleString();
      consoleLog(
        s.id.slice(0, 20).padEnd(22) +
        s.source.padEnd(12) +
        s.kind.padEnd(18) +
        (s.project_hint || '').slice(0, 23).padEnd(25) +
        updated,
      );
    }
    consoleLog('');
  });

// ── resume ────────────────────────────────────────────────────────────────────
program
  .command('resume <sessionId>')
  .description('Print a resume block to paste into an LLM')
  .option('--turns <n>', 'Number of turns to show', '10')
  .action((sessionId, opts) => {
    const db = getDb();
    const session = getSession(db, sessionId) ?? getSession(db, sessionId.padEnd(20, '0'));

    // partial match
    if (!session) {
      const all = listSessions(db, 9999);
      const match = all.find((s) => s.id.startsWith(sessionId));
      if (!match) {
        consoleError(`Session not found: ${sessionId}`);
        process.exit(1);
      }
      const n = parseInt(opts.turns, 10) || 10;
      consoleLog(buildResumeBlock(match, n));
      return;
    }

    const n = parseInt(opts.turns, 10) || 10;
    consoleLog(buildResumeBlock(session, n));
  });

// ── lock ─────────────────────────────────────────────────────────────────────
program
  .command('lock <projectKey>')
  .description('Acquire a lock for a project')
  .option('--source <name>', 'Source name', 'claude')
  .action(async (projectKey, opts) => {
    const cfg = loadConfig();
    const ok = await acquireLock(cfg, opts.source, projectKey);
    if (ok) {
      consoleLog(`Lock acquired: ${opts.source}/${projectKey}`);
    } else {
      consoleError(`Failed to acquire lock: ${opts.source}/${projectKey} (held by another machine)`);
      process.exit(1);
    }
  });

// ── unlock ────────────────────────────────────────────────────────────────────
program
  .command('unlock <projectKey>')
  .description('Release a lock for a project')
  .option('--source <name>', 'Source name', 'claude')
  .action(async (projectKey, opts) => {
    const cfg = loadConfig();
    await releaseLock(cfg, opts.source, projectKey);
    consoleLog(`Lock released: ${opts.source}/${projectKey}`);
  });

// ── cursor:restore ────────────────────────────────────────────────────────────
program
  .command('cursor:restore <snapshotId>')
  .description('Restore a Cursor workspace DB snapshot')
  .requiredOption('--to <workspaceHashDir>', 'Target workspace directory')
  .action(async (snapshotId, opts) => {
    const toDir = expandHome(opts.to);
    consoleLog(`Restoring snapshot ${snapshotId} to ${toDir} ...`);
    try {
      await restoreCursorSnapshot(snapshotId, toDir);
      consoleLog('Restore complete.');
    } catch (err) {
      consoleError(`Restore failed: ${String(err)}`);
      process.exit(1);
    }
  });

// ── opencode:restore ──────────────────────────────────────────────────────────
program
  .command('opencode:restore <snapshotId>')
  .description('Restore an OpenCode DB snapshot')
  .requiredOption('--to <path>', 'Target path or directory')
  .action(async (snapshotId, opts) => {
    const toPath = expandHome(opts.to);
    consoleLog(`Restoring snapshot ${snapshotId} to ${toPath} ...`);
    try {
      await restoreOpencodeSnapshot(snapshotId, toPath);
      consoleLog('Restore complete.');
    } catch (err) {
      consoleError(`Restore failed: ${String(err)}`);
      process.exit(1);
    }
  });

// ── daemon:start ──────────────────────────────────────────────────────────────
program
  .command('daemon:start')
  .description('Start the sync daemon in the background')
  .option('--foreground', 'Run in foreground (for debugging)')
  .action(async (opts) => {
    if (isDaemonRunning()) {
      consoleLog(`Daemon already running (pid ${readPid()})`);
      return;
    }

    const cfg = loadConfig();
    checkOpenAIWarning(cfg);

    if (opts.foreground) {
      consoleLog('Starting daemon in foreground...');
      await daemonLoop(cfg);
    } else {
      // Fork a detached child
      const child = (await import('node:child_process')).spawn(
        process.execPath,
        [__filename, 'daemon:start', '--foreground'],
        {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        },
      );
      child.unref();
      consoleLog(`Daemon started (pid ${child.pid})`);
    }
  });

// ── daemon:stop ───────────────────────────────────────────────────────────────
program
  .command('daemon:stop')
  .description('Stop the sync daemon')
  .action(() => {
    stopDaemon();
  });

// ── daemon:status ─────────────────────────────────────────────────────────────
program
  .command('daemon:status')
  .description('Show daemon status')
  .action(() => {
    if (isDaemonRunning()) {
      consoleLog(`Daemon is running (pid ${readPid()})`);
    } else {
      consoleLog('Daemon is not running.');
    }
  });

// ── discover ──────────────────────────────────────────────────────────────────
program
  .command('discover <target>')
  .description('Discover session data directories. Use "opencode" or "all"')
  .action((target) => {
    if (target === 'all') {
      // Show all platform source paths
      const sources = detectSourcePaths();
      consoleLog('');
      consoleLog('=== Detected Source Paths ===');
      for (const s of sources) {
        const status = s.detected ? '✓' : '✗ (not found)';
        consoleLog(`  ${status}  ${s.name.padEnd(12)} ${s.path}`);
      }
      consoleLog('');

      // Also detect sync providers
      const providers = detectProviders();
      consoleLog('=== Detected Sync Providers ===');
      for (const p of providers) {
        const status = p.rootPath ? `✓  ${p.rootPath}` : '✗  (not detected)';
        consoleLog(`  ${status}  [${p.provider}]`);
      }
      consoleLog('');
      return;
    }

    if (target === 'opencode') {
      const results = discoverOpencode();
      consoleLog(formatDiscoverResults(results));
      return;
    }

    consoleError(`Unknown discover target: ${target}. Supported: opencode, all`);
    process.exit(1);
  });

// ── normalize ─────────────────────────────────────────────────────────────────
program
  .command('normalize')
  .description('Normalize all indexed sessions into the unified session model')
  .action(async () => {
    const cfg = loadConfig();
    const db = getDb();
    consoleLog('Normalizing sessions...');
    const count = await normalizeAll(db, cfg.machineId);
    consoleLog(`Normalized ${count} session(s) into ~/.sessionsync/sessions/`);
  });

// ── timeline ──────────────────────────────────────────────────────────────────
program
  .command('timeline')
  .description('Show unified activity timeline across all sessions')
  .option('--session <id>', 'Show timeline for a specific session')
  .option('--limit <n>', 'Max events to show', '100')
  .action((opts) => {
    const limit = parseInt(opts.limit, 10) || 100;

    if (opts.session) {
      const entries = buildSessionTimeline(opts.session);
      if (entries.length === 0) {
        consoleLog(`No timeline data for session ${opts.session}. Run 'ss normalize' first.`);
        return;
      }
      consoleLog('');
      for (const entry of entries) consoleLog(formatTimelineEntry(entry));
      consoleLog('');
      return;
    }

    const entries = buildGlobalTimeline(limit);
    if (entries.length === 0) {
      consoleLog('No timeline data. Run `ss normalize` to build session model.');
      return;
    }
    consoleLog('');
    for (const entry of entries) consoleLog(formatTimelineEntry(entry));
    consoleLog('');
  });

// ── replay ────────────────────────────────────────────────────────────────────
program
  .command('replay <sessionId>')
  .description('Replay a session step-by-step')
  .option('--speed <speed>', 'Replay speed: normal|fast', 'normal')
  .option('--step', 'Pause after each step (press ENTER to continue)')
  .action(async (sessionId, opts) => {
    const speed = opts.speed === 'fast' ? 'fast' : 'normal';
    await replaySession(sessionId, { speed, step: !!opts.step });
  });

// ── export ────────────────────────────────────────────────────────────────────
program
  .command('export <sessionId>')
  .description('Export a session to a portable directory')
  .option('--out <dir>', 'Output directory (default: ./session-export-<id>)')
  .action(async (sessionId, opts) => {
    await exportSession(sessionId, opts.out ? path.resolve(opts.out) : undefined);
  });

// ── share ─────────────────────────────────────────────────────────────────────
program
  .command('share <sessionId>')
  .description('Export and bundle a session into a .ssbundle file')
  .option('--out <file>', 'Output file path (default: ./session-<id>.ssbundle)')
  .action(async (sessionId, opts) => {
    await shareSession(sessionId, opts.out ? path.resolve(opts.out) : undefined);
  });

// ── server ────────────────────────────────────────────────────────────────────
program
  .command('server')
  .description('Start local session viewer API on http://localhost:3900')
  .action(async () => {
    await startServer();
  });

// ── handoff ───────────────────────────────────────────────────────────────────
program
  .command('handoff <sessionId>')
  .description('Generate a continuation prompt to paste into an LLM')
  .option('--format <fmt>', 'Output format: text | markdown | json', 'markdown')
  .option('--turns <n>', 'Number of recent turns to inspect', '6')
  .option('--include-git <bool>', 'Include git status (true/false)', 'true')
  .action(async (sessionId, opts) => {
    const format = (opts.format === 'text' || opts.format === 'json' ? opts.format : 'markdown') as HandoffOptions['format'];
    const turns = Math.max(1, parseInt(opts.turns, 10) || 6);
    const includeGit = opts.includeGit !== 'false';

    try {
      const data = await generateHandoff(sessionId, { format, turns, includeGit });
      consoleLog(formatHandoff(data, format));
    } catch (err) {
      consoleError(`Handoff failed: ${String(err)}`);
      process.exit(1);
    }
  });

// ── doctor ────────────────────────────────────────────────────────────────────
program
  .command('doctor')
  .description('Validate environment, config, and sync health')
  .action(async () => {
    const ok = await runDoctor();
    if (!ok) process.exit(1);
  });

// ── helpers ───────────────────────────────────────────────────────────────────
function checkOpenAIWarning(cfg: ReturnType<typeof loadConfig>): void {
  const hasOpenAI = cfg.include.some((e) => isOpenAIPath(e.path));
  if (hasOpenAI) {
    consoleWarn('');
    consoleWarn('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    consoleWarn('!! WARNING: ~/.openai is included in your sync config.      !!');
    consoleWarn('!! This directory may contain API keys and credentials.     !!');
    consoleWarn('!! Add --i-know-what-im-doing to suppress this warning.     !!');
    consoleWarn('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    consoleWarn('');
    // In a non-interactive path we exit unless the flag is present
    const args = process.argv;
    if (!args.includes('--i-know-what-im-doing')) {
      consoleError('Aborting. Pass --i-know-what-im-doing to proceed with ~/.openai in sync config.');
      process.exit(1);
    }
  }
}

program.parseAsync(process.argv).catch((err) => {
  consoleError(String(err));
  process.exit(1);
});
