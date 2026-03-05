import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

type DiscoverResult = {
  path: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  fileCount: number;
};

const HOME = os.homedir();

const PRIMARY_CANDIDATES = [
  path.join(HOME, '.opencode'),
  path.join(HOME, '.config', 'opencode'),
  path.join(HOME, 'Library', 'Application Support', 'opencode'),
  path.join(HOME, 'Library', 'Application Support', 'OpenCode'),
];

function globOptional(pattern: string): string[] {
  // simple prefix glob for com.opencode* and opencode* log dirs
  const dir = path.dirname(pattern);
  const prefix = path.basename(pattern).replace('*', '');
  if (!fs.existsSync(dir)) return [];
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(prefix))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

const OPTIONAL_CANDIDATES: string[] = [
  ...globOptional(path.join(HOME, 'Library', 'Application Support', 'com.opencode*')),
  ...globOptional(path.join(HOME, 'Library', 'Logs', 'opencode*')),
];

const TARGET_EXTS = new Set(['.jsonl', '.json', '.log', '.sqlite', '.db']);

const HIGH_CONFIDENCE_KEYS = new Set([
  'messages', 'role', 'content', 'tool', 'model', 'timestamp',
]);

function scoreFile(absPath: string): 'high' | 'low' {
  const ext = path.extname(absPath).toLowerCase();
  if (!TARGET_EXTS.has(ext)) return 'low';

  if (ext === '.sqlite' || ext === '.db') return 'high';

  try {
    const sample = fs.readFileSync(absPath, 'utf8').slice(0, 4096);

    if (ext === '.jsonl' || ext === '.json') {
      const firstLine = sample.split('\n')[0];
      try {
        const obj = JSON.parse(firstLine) as Record<string, unknown>;
        const keys = Object.keys(obj);
        if (keys.some((k) => HIGH_CONFIDENCE_KEYS.has(k))) return 'high';
      } catch { /* try whole content */ }
      for (const key of HIGH_CONFIDENCE_KEYS) {
        if (sample.includes(`"${key}"`)) return 'high';
      }
    }

    if (ext === '.log') {
      const lower = sample.toLowerCase();
      if (lower.includes('opencode') && (lower.includes('session') || lower.includes('conversation'))) {
        return 'high';
      }
    }
  } catch { /* ignore */ }

  return 'low';
}

function scanDir(dir: string): { high: number; low: number } {
  let high = 0;
  let low = 0;
  if (!fs.existsSync(dir)) return { high, low };

  function walk(d: string, depth: number): void {
    if (depth > 5) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') && entry.name !== '.opencode') continue;
      const abs = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(abs, depth + 1);
      } else if (entry.isFile()) {
        const score = scoreFile(abs);
        if (score === 'high') high++;
        else low++;
      }
    }
  }

  walk(dir, 0);
  return { high, low };
}

export function discoverOpencode(): DiscoverResult[] {
  const results: DiscoverResult[] = [];
  const seen = new Set<string>();

  const allCandidates = [...PRIMARY_CANDIDATES, ...OPTIONAL_CANDIDATES];

  for (const candidate of allCandidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);

    if (!fs.existsSync(candidate)) continue;

    let stat: fs.Stats;
    try {
      stat = fs.statSync(candidate);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) continue;

    const { high, low } = scanDir(candidate);
    const fileCount = high + low;

    if (fileCount === 0) continue;

    let confidence: 'high' | 'medium' | 'low';
    let reason: string;

    if (high >= 2) {
      confidence = 'high';
      reason = `${high} high-confidence session files found`;
    } else if (high === 1) {
      confidence = 'medium';
      reason = `1 high-confidence file, ${low} low-confidence files`;
    } else {
      confidence = 'low';
      reason = `only low-confidence files (${low} total)`;
    }

    results.push({ path: candidate, confidence, reason, fileCount });
  }

  // sort: high > medium > low, then by fileCount desc
  const order = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => {
    const diff = order[a.confidence] - order[b.confidence];
    return diff !== 0 ? diff : b.fileCount - a.fileCount;
  });

  return results;
}

export function formatDiscoverResults(results: DiscoverResult[]): string {
  if (results.length === 0) {
    return 'No OpenCode data directories found. If you have OpenCode installed, try locating it manually and add to config.';
  }

  const lines: string[] = ['OpenCode discovered locations:\n'];

  for (const r of results) {
    lines.push(`  ${r.confidence.toUpperCase().padEnd(6)} ${r.path}`);
    lines.push(`         ${r.reason} (${r.fileCount} files)\n`);
  }

  const best = results[0];
  if (best && best.confidence !== 'low') {
    lines.push('\nSuggested config include entry:');
    lines.push(JSON.stringify({ name: 'opencode', path: r2relative(best.path) }, null, 2));
  }

  return lines.join('\n');
}

function r2relative(p: string): string {
  const home = os.homedir();
  if (p.startsWith(home)) return '~' + p.slice(home.length);
  return p;
}
