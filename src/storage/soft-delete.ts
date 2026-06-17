import { and, eq, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { menuItems } from '../db/schema.ts';

export const softDeleteMenuItems = menuItems;

type SoftDeleteDatabase = Pick<BunSQLiteDatabase<Record<string, never>>, 'update'>;
type SoftDeleteTable = typeof softDeleteMenuItems;

type SoftDeleteOptions = {
  deletedAt?: Date;
  set?: Record<string, unknown>;
};

export type SoftDeleteResult<Row> = {
  rows: Row[];
  count: number;
  deletedAt: Date;
};

function deletePatch(table: SoftDeleteTable, deletedAt: Date, extra: Record<string, unknown>) {
  return { updatedAt: deletedAt, ...extra, deletedAt };
}

function restorePatch(restoredAt: Date, extra: Record<string, unknown>) {
  return { updatedAt: restoredAt, ...extra, deletedAt: null };
}

function validRowId(id: number): boolean {
  return Number.isSafeInteger(id) && id > 0;
}

export function notDeleted(table: SoftDeleteTable, predicate?: SQL): SQL | undefined {
  const active = isNull(table.deletedAt);
  return predicate ? and(predicate, active) : active;
}

export function softDeleteWhere<Row = unknown>(
  db: SoftDeleteDatabase,
  table: SoftDeleteTable,
  where: SQL,
  options: SoftDeleteOptions = {},
): SoftDeleteResult<Row> {
  const deletedAt = options.deletedAt ?? new Date();
  const rows = (db.update(table as never)
    .set(deletePatch(table, deletedAt, options.set ?? {}) as never)
    .where(where)
    .returning()
    .all() as unknown) as Row[];
  return { rows, count: rows.length, deletedAt };
}

export function softDeleteById<Row = unknown>(
  db: SoftDeleteDatabase,
  table: SoftDeleteTable,
  id: number,
  options: SoftDeleteOptions = {},
): SoftDeleteResult<Row> {
  if (!validRowId(id)) {
    const deletedAt = options.deletedAt ?? new Date();
    return { rows: [], count: 0, deletedAt };
  }
  return softDeleteWhere(db, table, notDeleted(table, eq(table.id, id))!, options);
}

export function restoreById<Row = unknown>(
  db: SoftDeleteDatabase,
  table: SoftDeleteTable,
  id: number,
  restoredAt = new Date(),
  extra: Record<string, unknown> = {},
): Row | undefined {
  if (!validRowId(id)) return undefined;
  return (db.update(table as never)
    .set(restorePatch(restoredAt, extra) as never)
    .where(and(eq(table.id, id), isNotNull(table.deletedAt)))
    .returning()
    .get() as unknown) as Row | undefined;
}

export function softDeleteMenuItemById(
  db: SoftDeleteDatabase,
  id: number,
  deletedAt = new Date(),
): SoftDeleteResult<typeof softDeleteMenuItems.$inferSelect> {
  return softDeleteById(db, softDeleteMenuItems, id, {
    deletedAt,
    set: { enabled: false, touchedAt: deletedAt },
  });
}
