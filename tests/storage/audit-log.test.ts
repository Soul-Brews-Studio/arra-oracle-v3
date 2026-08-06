import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { settings } from '../../src/db/schema.ts';
import { runWithDbRequestContext } from '../../src/middleware/db-context.ts';
import { auditLog, isAuditLogQuery, isWriteQuery, normalizeAuditQuery } from '../../src/storage/audit-log.ts';
import { createStorageBackend } from '../../src/storage/registry.ts';
import type { StorageBackend } from '../../src/storage/types.ts';

let tempDir = '';
let backend: StorageBackend | undefined;

afterEach(() => {
  backend?.close();
  backend = undefined;
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function createBackend(): StorageBackend {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-audit-log-'));
  backend = createStorageBackend({ dbPath: path.join(tempDir, 'oracle.db') });
  return backend;
}

test('audit log records Drizzle write operations with the active request ID', () => {
  const storage = createBackend();

  runWithDbRequestContext('audit-request-1', () => {
    storage.db.insert(settings).values({ key: 'audit-key', value: 'one', updatedAt: 1 }).run();
    storage.db.update(settings).set({ value: 'two', updatedAt: 2 }).where(eq(settings.key, 'audit-key')).run();
    storage.db.delete(settings).where(eq(settings.key, 'audit-key')).run();
  });

  const rows = storage.db.select().from(auditLog).orderBy(auditLog.id).all();
  expect(rows).toHaveLength(3);
  expect(rows.map((row) => row.who)).toEqual(['http', 'http', 'http']);
  expect(rows.map((row) => row.requestId)).toEqual(['audit-request-1', 'audit-request-1', 'audit-request-1']);
  expect(rows.map((row) => row.what.split(' ', 2).join(' '))).toEqual(['insert into', 'update "settings"', 'delete from']);
  expect(rows.every((row) => Number.isSafeInteger(row.when))).toBe(true);
});

test('audit log skips reads and its own table writes', () => {
  const storage = createBackend();

  storage.db.select().from(settings).all();
  storage.db.insert(auditLog).values({ who: 'test', what: 'manual', when: 123, requestId: null }).run();
  storage.db.insert(settings).values({ key: 'system-audit', value: 'ok', updatedAt: 1 }).run();

  const rows = storage.db.select().from(auditLog).orderBy(auditLog.id).all();
  expect(rows[0]).toEqual({ id: 1, who: 'test', what: 'manual', when: 123, requestId: null });
  expect(rows[1]).toMatchObject({ id: 2, who: 'system', requestId: null });
  expect(rows[1]?.what.startsWith('insert into')).toBe(true);
  expect(isWriteQuery('  replace into settings values (?)')).toBe(true);
  expect(isWriteQuery('select * from settings')).toBe(false);
  expect(isAuditLogQuery('delete from "audit_log" where "id" = ?')).toBe(true);
  expect(isAuditLogQuery('insert into audit_log values (?)')).toBe(true);
  expect(normalizeAuditQuery(' insert\ninto "settings" ')).toBe('insert into "settings"');
});
