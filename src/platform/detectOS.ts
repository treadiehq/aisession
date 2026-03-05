export type OSPlatform = 'darwin' | 'win32' | 'linux' | 'unknown';

export function detectOS(): OSPlatform {
  const p = process.platform;
  if (p === 'darwin' || p === 'win32' || p === 'linux') return p;
  return 'unknown';
}

export function isWindows(): boolean {
  return process.platform === 'win32';
}

export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function isLinux(): boolean {
  return process.platform === 'linux';
}
