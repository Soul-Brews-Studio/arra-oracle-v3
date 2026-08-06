import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, type DatabaseConnection } from '../../src/db/index.ts';
import { MemoryStore } from '../../src/routes/memory/store.ts';

let tempDir = '';
let connection: DatabaseConnection | undefined;

afterEach(() => {
  connection?.storage.close();
  connection = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function freshStore() {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-memory-valid-time-'));
  connection = createDatabase(path.join(tempDir, 'oracle.db'));
  return { store: new MemoryStore(connection.db), sqlite: connection.sqlite };
}

test('oracle_memories migration installs valid_from/valid_to and tenant valid-time index', () => {
  const { sqlite } = freshStore();
  const columns = sqlite.query<{ name: string }, []>('pragma table_info("oracle_memories")')
    .all()
    .map((row) => row.name);
  const index = sqlite.query<{ name: string }, []>(
    "select name from sqlite_master where type = 'index' and name = 'idx_memory_tenant_valid_time'",
  ).get();

  expect(columns).toContain('valid_from');
  expect(columns).toContain('valid_to');
  expect(index?.name).toBe('idx_memory_tenant_valid_time');
});

test('memory recall filters valid-time as-of separately from transaction time', () => {
  const { store } = freshStore();
  const oldMemory = store.save({
    content: 'pricing policy memory',
    validFrom: '2024-01-01T00:00:00.000Z',
    validTo: '2025-01-01T00:00:00.000Z',
  });
  const newMemory = store.save({
    content: 'pricing policy memory',
    validFrom: '2025-01-01T00:00:00.000Z',
  });

  const mid2024 = store.recall('pricing policy', 10, '2024-06-01T00:00:00.000Z').map((row) => row.id);
  const mid2025 = store.recall('pricing policy', 10, '2025-06-01T00:00:00.000Z').map((row) => row.id);

  expect(mid2024).toContain(oldMemory.id);
  expect(mid2024).not.toContain(newMemory.id);
  expect(mid2025).toContain(newMemory.id);
  expect(mid2025).not.toContain(oldMemory.id);
});

test('memory save rejects invalid valid-time intervals', () => {
  const { store } = freshStore();
  expect(() => store.save({
    content: 'bad interval',
    validFrom: '2025-01-01T00:00:00.000Z',
    validTo: '2024-01-01T00:00:00.000Z',
  })).toThrow('valid_to must be after valid_from');
});
