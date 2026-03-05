import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { detectOS } from './detectOS.js';

export type SyncProvider = 'icloud' | 'dropbox' | 'googledrive' | 'onedrive' | 'custom';

export const PROVIDER_LABELS: Record<SyncProvider, string> = {
  icloud: 'iCloud Drive',
  dropbox: 'Dropbox',
  googledrive: 'Google Drive',
  onedrive: 'OneDrive',
  custom: 'Custom Folder',
};

const HOME = os.homedir();

function firstExisting(...candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function globFirstExisting(dir: string, prefix: string): string | null {
  try {
    if (!fs.existsSync(dir)) return null;
    const entries = fs.readdirSync(dir);
    const match = entries.find((e) => e.startsWith(prefix));
    if (match) return path.join(dir, match);
  } catch { /* ignore */ }
  return null;
}

export interface ProviderDetection {
  provider: SyncProvider;
  label: string;
  rootPath: string | null;
}

export function detectProviders(): ProviderDetection[] {
  const os = detectOS();
  const results: ProviderDetection[] = [];

  if (os === 'darwin') {
    // iCloud
    results.push({
      provider: 'icloud',
      label: PROVIDER_LABELS.icloud,
      rootPath: firstExisting(
        path.join(HOME, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'),
      ),
    });

    // Dropbox
    const cloudStorageDir = path.join(HOME, 'Library', 'CloudStorage');
    results.push({
      provider: 'dropbox',
      label: PROVIDER_LABELS.dropbox,
      rootPath: firstExisting(
        path.join(HOME, 'Dropbox'),
        globFirstExisting(cloudStorageDir, 'Dropbox') ?? '',
      ),
    });

    // Google Drive
    results.push({
      provider: 'googledrive',
      label: PROVIDER_LABELS.googledrive,
      rootPath: firstExisting(
        path.join(HOME, 'Google Drive'),
        globFirstExisting(cloudStorageDir, 'GoogleDrive-') ?? '',
      ),
    });

    // OneDrive
    results.push({
      provider: 'onedrive',
      label: PROVIDER_LABELS.onedrive,
      rootPath: firstExisting(
        path.join(HOME, 'OneDrive'),
        globFirstExisting(cloudStorageDir, 'OneDrive-') ?? '',
      ),
    });
  } else if (os === 'win32') {
    const userProfile = process.env['USERPROFILE'] ?? HOME;
    const appData = process.env['APPDATA'] ?? path.join(userProfile, 'AppData', 'Roaming');

    results.push({
      provider: 'onedrive',
      label: PROVIDER_LABELS.onedrive,
      rootPath: firstExisting(
        path.join(userProfile, 'OneDrive'),
        path.join(appData, 'Microsoft', 'OneDrive'),
      ),
    });

    results.push({
      provider: 'dropbox',
      label: PROVIDER_LABELS.dropbox,
      rootPath: firstExisting(path.join(userProfile, 'Dropbox')),
    });

    results.push({
      provider: 'googledrive',
      label: PROVIDER_LABELS.googledrive,
      rootPath: firstExisting(
        path.join(userProfile, 'Google Drive'),
        path.join(userProfile, 'My Drive'),
      ),
    });

    results.push({
      provider: 'icloud',
      label: PROVIDER_LABELS.icloud,
      rootPath: firstExisting(path.join(userProfile, 'iCloudDrive')),
    });
  } else {
    // Linux: only Dropbox is common as a native client
    results.push({
      provider: 'dropbox',
      label: PROVIDER_LABELS.dropbox,
      rootPath: firstExisting(path.join(HOME, 'Dropbox')),
    });

    // iCloud/Google Drive/OneDrive not natively supported; show as null
    results.push({ provider: 'googledrive', label: PROVIDER_LABELS.googledrive, rootPath: null });
    results.push({ provider: 'onedrive', label: PROVIDER_LABELS.onedrive, rootPath: null });
    results.push({ provider: 'icloud', label: PROVIDER_LABELS.icloud, rootPath: null });
  }

  results.push({ provider: 'custom', label: PROVIDER_LABELS.custom, rootPath: null });

  return results;
}

export function resolveSyncRoot(provider: SyncProvider, customPath?: string): string {
  if (provider === 'custom') {
    if (!customPath) throw new Error('Custom provider requires --path');
    return path.join(customPath, 'SessionSync');
  }
  const detections = detectProviders();
  const match = detections.find((d) => d.provider === provider);
  if (!match?.rootPath) {
    throw new Error(
      `Provider "${provider}" not detected on this system. Use --provider custom --path <folder>`,
    );
  }
  return path.join(match.rootPath, 'SessionSync');
}
