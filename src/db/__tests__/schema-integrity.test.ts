import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { eq } from 'drizzle-orm';
import { createDatabase, type DatabaseConnection } from '../index.ts';
import { oracleDocuments, tenants } from '../schema.ts';

let open: DatabaseConnection[] = [];

afterEach(() => {
  for (const conn of open) conn.storage.close();
  open = [];
});

function freshDb() {
  const dir = mkdtempSync(join(tmpdir(), 'arra-schema-'));
  const conn = createDatabase(join(dir, 'oracle.db'));
  open.push(conn);
  return conn;
}

function addTenant(conn: DatabaseConnection, id: string) {
  const now = Date.now();
  conn.db.insert(tenants).values({ id, name: id, status: 'active', createdAt: now, updatedAt: now }).run();
}

function addDoc(conn: DatabaseConnection, id: string, tenantId: string, supersededBy?: string) {
  const now = Date.now();
  conn.db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/${tenantId}/${id}.md`,
    concepts: JSON.stringify([id]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    supersededBy,
  }).run();
}

function expectSqliteAbort(fn: () => void, message: string) {
  expect(fn).toThrow(new RegExp(message));
}

test('oracle_documents auto-registers tenant rows for scoped data', () => {
  const conn = freshDb();
  addDoc(conn, 'missing-tenant-doc', 'missing-tenant');
  const row = conn.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, 'missing-tenant')).get();
  expect(row).toEqual({ id: 'missing-tenant' });
});

test('supersede chains stay inside the same tenant and cannot cycle', () => {
  const conn = freshDb();
  addTenant(conn, 'tenant-a');
  addTenant(conn, 'tenant-b');
  addDoc(conn, 'new-a', 'tenant-a');
  addDoc(conn, 'new-b', 'tenant-b');

  expectSqliteAbort(() => addDoc(conn, 'old-a', 'tenant-a', 'new-b'), 'invalid oracle_documents supersede chain');
  addDoc(conn, 'old-a', 'tenant-a', 'new-a');
  expectSqliteAbort(
    () => conn.db.update(oracleDocuments).set({ supersededBy: 'old-a' }).where(eq(oracleDocuments.id, 'new-a')).run(),
    'invalid oracle_documents supersede chain',
  );
});

test('document updates keep FTS concepts synchronized and deletes remove FTS rows', () => {
  const conn = freshDb();
  addTenant(conn, 'tenant-a');
  addDoc(conn, 'fts-doc', 'tenant-a');
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run('fts-doc', 'hello tenant fts', '["old"]');

  conn.db.update(oracleDocuments).set({ concepts: '["new"]' }).where(eq(oracleDocuments.id, 'fts-doc')).run();
  expect((conn.sqlite.query('SELECT concepts FROM oracle_fts WHERE id = ?').get('fts-doc') as { concepts: string }).concepts)
    .toBe('["new"]');

  conn.db.delete(oracleDocuments).where(eq(oracleDocuments.id, 'fts-doc')).run();
  expect(conn.sqlite.query('SELECT id FROM oracle_fts WHERE id = ?').get('fts-doc')).toBeNull();
});
