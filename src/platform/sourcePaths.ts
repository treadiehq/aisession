import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectOS } from './detectOS.js';

const HOME = os.homedir();

function firstExisting(...candidates: string[]): string | null {
  for (const c of candidates.filter(Boolean)) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export interface SourceCandidate {
  name: 'claude' | 'codex' | 'opencode' | 'cursor';
  path: string;
  detected: boolean;
}

export function detectSourcePaths(): SourceCandidate[] {
  const platform = detectOS();

  if (platform === 'darwin') {
    return detectMacSources();
  } else if (platform === 'win32') {
    return detectWindowsSources();
  } else {
    return detectLinuxSources();
  }
}

function detectMacSources(): SourceCandidate[] {
  const appSupport = path.join(HOME, 'Library', 'Application Support');
  return [
    {
      name: 'claude',
      path: firstExisting(path.join(HOME, '.claude')) ?? path.join(HOME, '.claude'),
      detected: fs.existsSync(path.join(HOME, '.claude')),
    },
    {
      name: 'codex',
      path: firstExisting(path.join(HOME, '.codex')) ?? path.join(HOME, '.codex'),
      detected: fs.existsSync(path.join(HOME, '.codex')),
    },
    {
      name: 'opencode',
      path:
        firstExisting(
          path.join(HOME, '.opencode'),
          path.join(HOME, '.config', 'opencode'),
          path.join(appSupport, 'opencode'),
        ) ?? path.join(HOME, '.opencode'),
      detected: Boolean(
        firstExisting(
          path.join(HOME, '.opencode'),
          path.join(HOME, '.config', 'opencode'),
          path.join(appSupport, 'opencode'),
        ),
      ),
    },
    {
      name: 'cursor',
      path:
        firstExisting(path.join(appSupport, 'Cursor', 'User', 'workspaceStorage')) ??
        path.join(appSupport, 'Cursor', 'User', 'workspaceStorage'),
      detected: fs.existsSync(path.join(appSupport, 'Cursor', 'User', 'workspaceStorage')),
    },
  ];
}

function detectWindowsSources(): SourceCandidate[] {
  const userProfile = process.env['USERPROFILE'] ?? HOME;
  const appData = process.env['APPDATA'] ?? path.join(userProfile, 'AppData', 'Roaming');

  return [
    {
      name: 'claude',
      path:
        firstExisting(path.join(userProfile, '.claude')) ?? path.join(userProfile, '.claude'),
      detected: fs.existsSync(path.join(userProfile, '.claude')),
    },
    {
      name: 'codex',
      path:
        firstExisting(path.join(userProfile, '.codex')) ?? path.join(userProfile, '.codex'),
      detected: fs.existsSync(path.join(userProfile, '.codex')),
    },
    {
      name: 'opencode',
      path:
        firstExisting(
          path.join(userProfile, '.opencode'),
          path.join(userProfile, '.config', 'opencode'),
          path.join(appData, 'opencode'),
        ) ?? path.join(userProfile, '.opencode'),
      detected: Boolean(
        firstExisting(
          path.join(userProfile, '.opencode'),
          path.join(userProfile, '.config', 'opencode'),
          path.join(appData, 'opencode'),
        ),
      ),
    },
    {
      name: 'cursor',
      path:
        firstExisting(path.join(appData, 'Cursor', 'User', 'workspaceStorage')) ??
        path.join(appData, 'Cursor', 'User', 'workspaceStorage'),
      detected: fs.existsSync(path.join(appData, 'Cursor', 'User', 'workspaceStorage')),
    },
  ];
}

function detectLinuxSources(): SourceCandidate[] {
  const configDir = path.join(HOME, '.config');

  return [
    {
      name: 'claude',
      path: firstExisting(path.join(HOME, '.claude')) ?? path.join(HOME, '.claude'),
      detected: fs.existsSync(path.join(HOME, '.claude')),
    },
    {
      name: 'codex',
      path: firstExisting(path.join(HOME, '.codex')) ?? path.join(HOME, '.codex'),
      detected: fs.existsSync(path.join(HOME, '.codex')),
    },
    {
      name: 'opencode',
      path:
        firstExisting(
          path.join(HOME, '.opencode'),
          path.join(configDir, 'opencode'),
        ) ?? path.join(HOME, '.opencode'),
      detected: Boolean(
        firstExisting(path.join(HOME, '.opencode'), path.join(configDir, 'opencode')),
      ),
    },
    {
      name: 'cursor',
      path:
        firstExisting(
          path.join(configDir, 'Cursor', 'User', 'workspaceStorage'),
          path.join(configDir, 'cursor', 'User', 'workspaceStorage'),
        ) ?? path.join(configDir, 'Cursor', 'User', 'workspaceStorage'),
      detected: Boolean(
        firstExisting(
          path.join(configDir, 'Cursor', 'User', 'workspaceStorage'),
          path.join(configDir, 'cursor', 'User', 'workspaceStorage'),
        ),
      ),
    },
  ];
}
