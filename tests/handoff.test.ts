import { describe, it, expect } from 'vitest';
import {
  buildSummary,
  extractRecentFiles,
  inferNextTask,
  runGitInfo,
  formatHandoff,
  type HandoffData,
} from '../src/handoff/generateHandoff.js';
import type { TimelineEvent } from '../src/sessionModel/sessionStore.js';
import type { FileEvent } from '../src/sessionModel/sessionStore.js';

// ── buildSummary ──────────────────────────────────────────────────────────────

describe('buildSummary', () => {
  const timeline: TimelineEvent[] = [
    { timestamp: '2026-01-01T10:00:00Z', type: 'session_start', tool: 'codex' },
    { timestamp: '2026-01-01T10:01:00Z', type: 'prompt', tool: 'codex', summary: 'Refactor billing service' },
    { timestamp: '2026-01-01T10:02:00Z', type: 'response', tool: 'codex', summary: 'Done refactoring' },
    { timestamp: '2026-01-01T10:03:00Z', type: 'file_edit', tool: 'codex', file: 'billing.ts' },
    { timestamp: '2026-01-01T10:04:00Z', type: 'prompt', tool: 'codex', summary: 'Add retry logic' },
    { timestamp: '2026-01-01T10:05:00Z', type: 'file_create', tool: 'codex', file: 'retry.ts' },
  ];

  it('extracts prompt summaries and file events', () => {
    const summary = buildSummary(timeline, '', 6);
    expect(summary).toContain('Refactor billing service');
    expect(summary).toContain('Add retry logic');
  });

  it('includes file edit/create labels', () => {
    const summary = buildSummary(timeline, '', 6);
    const hasFileItem = summary.some((s) => s.includes('billing.ts') || s.includes('retry.ts'));
    expect(hasFileItem).toBe(true);
  });

  it('respects maxItems limit', () => {
    const summary = buildSummary(timeline, '', 3);
    expect(summary.length).toBeLessThanOrEqual(3);
  });

  it('falls back to lastPrompt when timeline is empty', () => {
    const summary = buildSummary([], 'Do something important', 6);
    expect(summary).toHaveLength(1);
    expect(summary[0]).toContain('Do something important');
  });

  it('returns empty array when no data', () => {
    const summary = buildSummary([], '', 6);
    expect(summary).toHaveLength(0);
  });

  it('deduplicates file edit entries', () => {
    const dupTimeline: TimelineEvent[] = [
      { timestamp: '2026-01-01T10:01:00Z', type: 'file_edit', tool: 'codex', file: 'billing.ts' },
      { timestamp: '2026-01-01T10:02:00Z', type: 'file_edit', tool: 'codex', file: 'billing.ts' },
    ];
    const summary = buildSummary(dupTimeline, '', 6);
    const billingEntries = summary.filter((s) => s.includes('billing.ts'));
    expect(billingEntries.length).toBe(1);
  });
});

// ── extractRecentFiles ────────────────────────────────────────────────────────

describe('extractRecentFiles', () => {
  const events: FileEvent[] = [
    { path: 'billing.ts', operation: 'edit', timestamp: '2026-01-01T10:00:00Z', tool: 'codex' },
    { path: 'payment.ts', operation: 'edit', timestamp: '2026-01-01T10:01:00Z', tool: 'codex' },
    { path: 'billing.ts', operation: 'edit', timestamp: '2026-01-01T10:02:00Z', tool: 'codex' },
    { path: 'retry.ts',   operation: 'create', timestamp: '2026-01-01T10:03:00Z', tool: 'codex' },
  ];

  it('returns unique files most-recently touched first', () => {
    const files = extractRecentFiles(events);
    expect(files[0]).toBe('retry.ts');
    expect(files).not.toContain(''); // no empty paths
    // billing.ts appears twice but should only be listed once
    expect(files.filter((f) => f === 'billing.ts').length).toBe(1);
  });

  it('caps at 10 files', () => {
    const manyEvents: FileEvent[] = Array.from({ length: 20 }, (_, i) => ({
      path: `file${i}.ts`,
      operation: 'edit' as const,
      timestamp: `2026-01-01T10:${String(i).padStart(2, '0')}:00Z`,
      tool: 'codex',
    }));
    const files = extractRecentFiles(manyEvents);
    expect(files.length).toBeLessThanOrEqual(10);
  });

  it('handles empty file events gracefully', () => {
    expect(extractRecentFiles([])).toEqual([]);
  });
});

// ── inferNextTask ─────────────────────────────────────────────────────────────

describe('inferNextTask', () => {
  it('picks up action verbs and returns continuation prefix', () => {
    const task = inferNextTask('Add retry backoff logic', '');
    expect(task).toMatch(/Continue implementing/);
    expect(task).toContain('Add retry backoff logic');
  });

  it('recognises various verbs', () => {
    for (const verb of ['fix', 'implement', 'refactor', 'update', 'build', 'create']) {
      const task = inferNextTask(`${verb} the payment service`, '');
      expect(task).toMatch(/Continue implementing/i);
    }
  });

  it('falls back gracefully when no action verb found', () => {
    const task = inferNextTask('What is the capital of France?', '');
    expect(task).toContain('Continue development based on the latest assistant response.');
  });

  it('handles empty lastPrompt', () => {
    const task = inferNextTask('', '');
    expect(task).toBeTruthy();
    expect(task).toContain('Continue development');
  });
});

// ── runGitInfo ────────────────────────────────────────────────────────────────

describe('runGitInfo', () => {
  it('returns empty strings when project path does not exist', () => {
    const { gitStatus, gitDiffStat } = runGitInfo(
      '/nonexistent/path/that/does/not/exist',
      '/nonexistent/file.jsonl',
    );
    expect(gitStatus).toBe('');
    expect(gitDiffStat).toBe('');
  });

  it('returns empty strings gracefully when not a git repo', () => {
    const { gitStatus, gitDiffStat } = runGitInfo('/tmp', '/tmp/fake.jsonl');
    // /tmp may or may not be a git repo — either way it should not throw
    expect(typeof gitStatus).toBe('string');
    expect(typeof gitDiffStat).toBe('string');
  });
});

// ── formatHandoff ─────────────────────────────────────────────────────────────

const sampleData: HandoffData = {
  project: 'billing-api',
  summary: ['Refactored billing service', 'Added retry logic'],
  lastPrompt: 'Add retry backoff logic',
  lastResponse: 'Here is an exponential backoff implementation.',
  filesChanged: ['billing.ts', 'payment.ts'],
  gitStatus: 'M billing.ts\nM payment.ts',
  gitDiffStat: ' billing.ts | 12 +++\n payment.ts | 4 ++',
  suggestedNextTask: 'Continue implementing: "Add retry backoff logic"',
  sessionId: 'abc123',
  source: 'codex',
  updatedAt: '2026-01-01T10:05:00.000Z',
};

describe('formatHandoff – markdown', () => {
  const output = formatHandoff(sampleData, 'markdown');

  it('contains project name', () => expect(output).toContain('billing-api'));
  it('contains work completed section', () => expect(output).toContain('WORK COMPLETED'));
  it('contains last prompt', () => expect(output).toContain('Add retry backoff logic'));
  it('contains last response', () => expect(output).toContain('exponential backoff'));
  it('contains files modified', () => expect(output).toContain('billing.ts'));
  it('contains git status', () => expect(output).toContain('M billing.ts'));
  it('contains suggested task', () => expect(output).toContain('Continue implementing'));
  it('ends with paste instruction', () => expect(output).toContain('Paste this block'));
});

describe('formatHandoff – text', () => {
  const output = formatHandoff(sampleData, 'text');

  it('contains SESSION HANDOFF header', () => expect(output).toContain('SESSION HANDOFF'));
  it('contains project', () => expect(output).toContain('billing-api'));
  it('uses bullet points', () => expect(output).toContain('•'));
  it('does not contain markdown headers', () => expect(output).not.toMatch(/^##/m));
});

describe('formatHandoff – json', () => {
  it('is valid JSON containing expected fields', () => {
    const output = formatHandoff(sampleData, 'json');
    const parsed = JSON.parse(output) as HandoffData;
    expect(parsed.project).toBe('billing-api');
    expect(parsed.summary).toHaveLength(2);
    expect(parsed.filesChanged).toContain('billing.ts');
    expect(parsed.suggestedNextTask).toContain('Continue implementing');
  });
});

describe('formatHandoff – empty session gracefully', () => {
  const emptyData: HandoffData = {
    ...sampleData,
    summary: [],
    lastPrompt: '',
    lastResponse: '',
    filesChanged: [],
    gitStatus: '',
    gitDiffStat: '',
  };

  it('markdown renders without empty sections crashing', () => {
    const output = formatHandoff(emptyData, 'markdown');
    expect(output).toContain('billing-api');
    expect(output).toContain('NEXT SUGGESTED TASK');
    expect(output).not.toContain('WORK COMPLETED'); // skipped when empty
    expect(output).not.toContain('LAST USER PROMPT'); // skipped when empty
  });

  it('text renders without crashing on empty data', () => {
    const output = formatHandoff(emptyData, 'text');
    expect(output).toContain('SESSION HANDOFF');
  });

  it('json is parseable with empty arrays', () => {
    const output = formatHandoff(emptyData, 'json');
    const parsed = JSON.parse(output) as HandoffData;
    expect(parsed.summary).toEqual([]);
    expect(parsed.filesChanged).toEqual([]);
  });
});
