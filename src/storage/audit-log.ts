import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { currentDbRequestId, type DbQueryObserver } from '../middleware/db-context.ts';

export const auditLog = sqliteTable('audit_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  who: text('who').notNull(),
  what: text('what').notNull(),
  when: integer('when').notNull(),
  requestId: text('request_id'),
}, (table) => [
  index('idx_audit_log_when').on(table.when),
  index('idx_audit_log_request').on(table.requestId),
  index('idx_audit_log_who').on(table.who),
]);

export type AuditLogSchema = { auditLog: typeof auditLog };
export type AuditLogDatabase = BunSQLiteDatabase<AuditLogSchema>;
export type AuditLogEntry = typeof auditLog.$inferSelect;
export type AuditLogOptions = {
  actor?: () => string | undefined;
  now?: () => number;
};

const writeOperations = new Set(['insert', 'update', 'delete', 'replace']);

export function normalizeAuditQuery(query: string): string {
  return query.replace(/\s+/g, ' ').trim();
}

function firstQueryToken(query: string): string {
  return normalizeAuditQuery(query).split(' ', 1)[0]?.toLowerCase() ?? '';
}

export function isWriteQuery(query: string): boolean {
  return writeOperations.has(firstQueryToken(query));
}

export function isAuditLogQuery(query: string): boolean {
  const normalized = normalizeAuditQuery(query).toLowerCase().replace(/[\"`]/g, '');
  return normalized.startsWith('insert into audit_log')
    || normalized.startsWith('update audit_log')
    || normalized.startsWith('delete from audit_log')
    || normalized.startsWith('replace into audit_log');
}

function defaultActor(requestId?: string): string {
  return requestId ? 'http' : 'system';
}

export function createAuditLogObserver(
  db: AuditLogDatabase,
  options: AuditLogOptions = {},
): DbQueryObserver {
  return (query) => {
    if (!isWriteQuery(query) || isAuditLogQuery(query)) return;

    const requestId = currentDbRequestId();
    db.insert(auditLog).values({
      who: options.actor?.() ?? defaultActor(requestId),
      what: normalizeAuditQuery(query),
      when: options.now?.() ?? Date.now(),
      requestId,
    }).run();
  };
}
