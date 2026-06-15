import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../db/schema.ts';
import { loadStorageConfig } from '../config.ts';
import {
  createStorageBackend,
  registerStorageBackend,
  resetStorageBackendsForTests,
} from '../registry.ts';
import type { StorageBackend } from '../types.ts';

const tempDirs: string[] = [];
const originalStorageBackend = process.env.ORACLE_STORAGE_BACKEND;
const originalDbBackend = process.env.ORACLE_DB_BACKEND;

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-'));
  tempDirs.push(dir);
  return dir;
}

function clearBackendEnv(): void {
  delete process.env.ORACLE_STORAGE_BACKEND;
  delete process.env.ORACLE_DB_BACKEND;
}

function restoreBackendEnv(): void {
  if (originalStorageBackend === undefined) delete process.env.ORACLE_STORAGE_BACKEND;
  else process.env.ORACLE_STORAGE_BACKEND = originalStorageBackend;
  if (originalDbBackend === undefined) delete process.env.ORACLE_DB_BACKEND;
  else process.env.ORACLE_DB_BACKEND = originalDbBackend;
}

afterEach(() => {
  resetStorageBackendsForTests();
  restoreBackendEnv();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    if (dir.startsWith(os.tmpdir()) && fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true });
    }
  }
});

describe('storage backends', () => {
  it('defaults to drizzle-sqlite and initializes sqlite schema', () => {
    clearBackendEnv();
    const repoRoot = makeTempDir();
    const dataDir = makeTempDir();
    const dbPath = path.join(dataDir, 'oracle.db');
    const config = loadStorageConfig({ repoRoot, dataDir });

    expect(config.backend).toBe('drizzle-sqlite');
    const backend = createStorageBackend({ dbPath, backend: config.backend });
    backend.db.insert(settings).values({
      key: 'storage_backend_test',
      value: 'ok',
      updatedAt: Date.now(),
    }).run();

    const row = backend.sqlite
      .prepare('SELECT value FROM settings WHERE key = ?')
      .get('storage_backend_test') as { value: string } | undefined;
    expect(row?.value).toBe('ok');
    backend.close();
  });

  it('selects a registered stub backend from config', () => {
    clearBackendEnv();
    const repoRoot = makeTempDir();
    const dataDir = makeTempDir();
    const calls: string[] = [];
    fs.writeFileSync(
      path.join(repoRoot, 'arra.config.json'),
      JSON.stringify({ storage: { backend: 'stub' } }),
    );

    registerStorageBackend('stub', (options): StorageBackend => {
      calls.push(options.dbPath ?? 'missing');
      return {
        name: 'stub',
        db: {} as StorageBackend['db'],
        sqlite: {} as StorageBackend['sqlite'],
        close: () => calls.push('closed'),
      };
    });

    const backend = createStorageBackend({
      repoRoot,
      dataDir,
      dbPath: path.join(dataDir, 'ignored.db'),
    });

    expect(backend.name).toBe('stub');
    expect(calls[0].endsWith('ignored.db')).toBe(true);
    backend.close();
    expect(calls).toContain('closed');
  });
});
