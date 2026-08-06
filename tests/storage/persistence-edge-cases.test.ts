import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../src/db/schema.ts';
import { createStorageBackend, resetStorageBackendsForTests } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

let tempDir = '';
const open: StorageBackend[] = [];

afterEach(() => {
  for (const backend of open.splice(0)) backend.close();
  resetStorageBackendsForTests();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function root(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-storage-persist-'));
  return tempDir;
}

function backend(dbPath: string, readonly = false): StorageBackend {
  const storage = createStorageBackend({ dbPath, readonly });
  open.push(storage);
  return storage;
}

describe('sqlite storage persistence edge cases', () => {
  test('persists reads, writes, and missing settings across handles', () => {
    const dbPath = path.join(root(), 'oracle.db');
    backend(dbPath).db.insert(settings)
      .values({ key: 'persist-key', value: 'one', updatedAt: 1 }).run();
    open.pop()?.close();

    const reopened = backend(dbPath);
    const hit = reopened.db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, 'persist-key')).get();
    const miss = reopened.db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, 'missing-key')).get();

    expect(hit?.value).toBe('one');
    expect(miss).toBeUndefined();
  });

  test('fails fast for readonly missing databases and rejects readonly writes', () => {
    const dbPath = path.join(root(), 'oracle.db');

    expect(() => createStorageBackend({ dbPath, readonly: true }))
      .toThrow('Readonly sqlite database does not exist');

    backend(dbPath).close();
    open.pop();
    const readonly = backend(dbPath, true);

    expect(() => readonly.db.insert(settings)
      .values({ key: 'readonly-write', value: 'nope', updatedAt: 1 }).run())
      .toThrow(/readonly|attempt to write/i);
  });

  test('allows concurrent handles to read writes without lock errors', () => {
    const dbPath = path.join(root(), 'oracle.db');
    const first = backend(dbPath);
    const second = backend(dbPath);

    first.db.insert(settings).values({ key: 'from-first', value: '1', updatedAt: 1 }).run();
    second.db.insert(settings).values({ key: 'from-second', value: '2', updatedAt: 2 }).run();

    const firstView = first.db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, 'from-second')).get();
    const secondView = second.db.select({ value: settings.value }).from(settings)
      .where(eq(settings.key, 'from-first')).get();
    const busyTimeout = first.sqlite.query<{ busy_timeout: number }, []>('PRAGMA busy_timeout').get();

    expect(firstView?.value).toBe('2');
    expect(secondView?.value).toBe('1');
    expect(Number(Object.values(busyTimeout ?? {})[0])).toBeGreaterThanOrEqual(5000);
  });
});
