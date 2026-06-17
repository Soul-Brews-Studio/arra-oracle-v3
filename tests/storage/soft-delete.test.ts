import { afterEach, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { menuItems } from '../../src/db/schema.ts';
import {
  notDeleted,
  restoreById,
  softDeleteById,
  softDeleteMenuItemById,
  softDeleteMenuItems,
} from '../../src/storage/soft-delete.ts';
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
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-soft-delete-'));
  backend = createStorageBackend({ dbPath: path.join(tempDir, 'oracle.db') });
  return backend;
}

function insertMenu(storage: StorageBackend) {
  const now = new Date(1700000000000);
  return storage.db.insert(menuItems).values({
    path: `/soft-delete-${Date.now()}`,
    label: 'Soft Delete',
    groupKey: 'tools',
    source: 'route',
    createdAt: now,
    updatedAt: now,
  }).returning({ id: menuItems.id }).get();
}

test('soft delete helper stamps deletedAt instead of deleting existing menu rows', () => {
  const storage = createBackend();
  const inserted = insertMenu(storage);
  const deletedAt = new Date(1700000005000);

  const result = softDeleteMenuItemById(storage.db, inserted.id, deletedAt);
  const row = storage.db.select().from(softDeleteMenuItems).where(eq(softDeleteMenuItems.id, inserted.id)).get();

  expect(result.count).toBe(1);
  expect(row?.enabled).toBe(false);
  expect(row?.deletedAt?.getTime()).toBe(deletedAt.getTime());
  expect(storage.db.select().from(menuItems).where(eq(menuItems.id, inserted.id)).get()).toBeTruthy();
});

test('generic soft delete helpers filter and restore deleted rows', () => {
  const storage = createBackend();
  const inserted = insertMenu(storage);
  const deletedAt = new Date(1700000010000);

  softDeleteById(storage.db, softDeleteMenuItems, inserted.id, { deletedAt, set: { enabled: false } });
  const visibleAfterDelete = storage.db.select().from(softDeleteMenuItems)
    .where(notDeleted(softDeleteMenuItems, eq(softDeleteMenuItems.id, inserted.id))).all();
  const activeRows = storage.db.select().from(softDeleteMenuItems).where(notDeleted(softDeleteMenuItems)).all();
  expect(visibleAfterDelete).toEqual([]);
  expect(activeRows.some((row) => row.id === inserted.id)).toBe(false);

  const restored = restoreById(storage.db, softDeleteMenuItems, inserted.id, deletedAt, { enabled: true });
  const second = insertMenu(storage);
  const defaultDelete = softDeleteById(storage.db, softDeleteMenuItems, second.id);
  const defaultRestore = restoreById(storage.db, softDeleteMenuItems, second.id);
  const visibleAfterRestore = storage.db.select().from(softDeleteMenuItems)
    .where(notDeleted(softDeleteMenuItems, eq(softDeleteMenuItems.id, inserted.id))).all();
  expect(restored).toMatchObject({ id: inserted.id, enabled: true, deletedAt: null });
  expect(defaultDelete.count).toBe(1);
  expect(defaultRestore).toMatchObject({ id: second.id, deletedAt: null });
  expect(visibleAfterRestore).toHaveLength(1);
});

test('generic soft delete helpers ignore invalid row ids', () => {
  const storage = createBackend();
  const deletedAt = new Date(1700000020000);

  const deleted = softDeleteById(storage.db, softDeleteMenuItems, Number.NaN, { deletedAt });
  const restored = restoreById(storage.db, softDeleteMenuItems, -1, deletedAt);

  expect(deleted).toEqual({ rows: [], count: 0, deletedAt });
  expect(restored).toBeUndefined();
});

test('generic helpers do not re-delete or restore already-active rows', () => {
  const storage = createBackend();
  const inserted = insertMenu(storage);
  const firstDeletedAt = new Date(1700000030000);
  const secondDeletedAt = new Date(1700000040000);

  const firstDelete = softDeleteById(storage.db, softDeleteMenuItems, inserted.id, { deletedAt: firstDeletedAt });
  const secondDelete = softDeleteById(storage.db, softDeleteMenuItems, inserted.id, { deletedAt: secondDeletedAt });
  const restored = restoreById(storage.db, softDeleteMenuItems, inserted.id, secondDeletedAt, { enabled: true });
  const secondRestore = restoreById(storage.db, softDeleteMenuItems, inserted.id, secondDeletedAt);
  const row = storage.db.select().from(softDeleteMenuItems)
    .where(eq(softDeleteMenuItems.id, inserted.id)).get();

  expect(firstDelete.count).toBe(1);
  expect(secondDelete).toMatchObject({ rows: [], count: 0, deletedAt: secondDeletedAt });
  expect(restored).toMatchObject({ id: inserted.id, enabled: true, deletedAt: null });
  expect(secondRestore).toBeUndefined();
  expect(row?.updatedAt?.getTime()).toBe(secondDeletedAt.getTime());
});

test('menu schema exposes deletedAt and parent metadata for Drizzle migrations', () => {
  const fkSymbol = Object.getOwnPropertySymbols(menuItems)
    .find((symbol) => String(symbol).includes('SQLiteInlineForeignKeys'));
  const foreignKeys = fkSymbol ? (menuItems as never as Record<symbol, { reference: () => {
    foreignColumns: unknown[];
  } }[]>)[fkSymbol] : [];

  expect(menuItems.deletedAt.name).toBe('deleted_at');
  expect(foreignKeys[0]?.reference().foreignColumns[0]).toBe(menuItems.id);
});
