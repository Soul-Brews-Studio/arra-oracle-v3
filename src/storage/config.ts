/** Storage backend config resolution. */

import fs from 'fs';
import path from 'path';
import { ORACLE_DATA_DIR } from '../config.ts';

export const DEFAULT_STORAGE_BACKEND = 'drizzle-sqlite';

export interface StorageConfig {
  backend: string;
}

interface ConfigShape {
  storage?: { backend?: unknown };
  database?: { backend?: unknown };
  storageBackend?: unknown;
  databaseBackend?: unknown;
}

interface LoadStorageConfigOptions {
  repoRoot?: string;
  dataDir?: string;
}

function readJson(filePath: string): ConfigShape | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as ConfigShape;
  } catch {
    return null;
  }
}

function backendFrom(raw: ConfigShape | null): string | null {
  const value = raw?.storage?.backend
    ?? raw?.database?.backend
    ?? raw?.storageBackend
    ?? raw?.databaseBackend;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function loadStorageConfig(
  options: LoadStorageConfigOptions = {},
): StorageConfig {
  const envBackend = process.env.ORACLE_STORAGE_BACKEND
    || process.env.ORACLE_DB_BACKEND;
  if (envBackend?.trim()) return { backend: envBackend.trim() };

  const repoRoot = options.repoRoot || process.env.ORACLE_REPO_ROOT || process.cwd();
  const dataDir = options.dataDir || ORACLE_DATA_DIR;
  const candidates = [
    path.join(repoRoot, 'arra.config.json'),
    path.join(dataDir, 'config.json'),
  ];

  for (const filePath of candidates) {
    const backend = backendFrom(readJson(filePath));
    if (backend) return { backend };
  }

  return { backend: DEFAULT_STORAGE_BACKEND };
}
