import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { expandHome } from '../src/paths.js';

const HOME = os.homedir();

describe('expandHome', () => {
  it('expands ~ to home dir', () => {
    expect(expandHome('~')).toBe(HOME);
  });

  it('expands ~/foo to home + /foo', () => {
    expect(expandHome('~/foo')).toBe(HOME + '/foo');
  });

  it('expands ~/.claude correctly', () => {
    expect(expandHome('~/.claude')).toBe(HOME + '/.claude');
  });

  it('leaves absolute paths unchanged', () => {
    expect(expandHome('/usr/local/bin')).toBe('/usr/local/bin');
  });

  it('leaves relative paths unchanged', () => {
    expect(expandHome('relative/path')).toBe('relative/path');
  });

  it('handles nested ~/a/b/c', () => {
    expect(expandHome('~/a/b/c')).toBe(HOME + '/a/b/c');
  });
});
