import { and, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { db as defaultDb, oracleMemories } from '../../db/index.ts';
import { currentTenantId, tenantIdForWrite } from '../../middleware/tenant.ts';
import type * as schema from '../../db/schema.ts';
import { parseMemoryLimit } from './model.ts';

export type MemoryInput = {
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
};

export type MemoryRecord = MemoryInput & {
  id: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
  usageCount?: number;
  lastAccessedAt?: string;
};

type OracleDb = BunSQLiteDatabase<typeof schema>;
type MemoryRow = typeof oracleMemories.$inferSelect;

export class MemoryStore {
  constructor(private readonly database?: OracleDb) {}

  private get db(): OracleDb {
    return this.database ?? defaultDb;
  }

  save(input: MemoryInput): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new Error('memory content is required');
    const now = Date.now();
    const row = this.db.insert(oracleMemories).values({
      id: `mem_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForWrite(),
      content,
      title: input.title?.trim() || null,
      tags: JSON.stringify(cleanTags(input.tags)),
      source: input.source?.trim() || null,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    return memoryFromRow(row);
  }

  recall(query = '', limit = 10): MemoryRecord[] {
    const normalized = query.trim();
    const safeLimit = parseMemoryLimit(limit);
    const where = combineWhere(tenantWhere(), searchWhere(normalized));
    const selected = this.db.select().from(oracleMemories);
    const rows = where
      ? selected.where(where).orderBy(desc(oracleMemories.createdAt)).limit(safeLimit).all()
      : selected.orderBy(desc(oracleMemories.createdAt)).limit(safeLimit).all();
    return rows.map(memoryFromRow);
  }

  getByIds(ids: string[]): MemoryRecord[] {
    if (!ids.length) return [];
    const where = combineWhere(inArray(oracleMemories.id, ids), tenantWhere());
    const rows = this.db.select().from(oracleMemories).where(where).all();
    const byId = new Map(rows.map((row) => [row.id, memoryFromRow(row)]));
    return ids.map((id) => byId.get(id)).filter((row): row is MemoryRecord => Boolean(row));
  }

}

function tenantWhere(): SQL | undefined {
  const tenantId = currentTenantId();
  return tenantId ? eq(oracleMemories.tenantId, tenantId) : undefined;
}

function searchWhere(query: string): SQL | undefined {
  if (!query) return undefined;
  return or(
    like(oracleMemories.content, `%${query}%`),
    like(oracleMemories.title, `%${query}%`),
    like(oracleMemories.tags, `%${query}%`),
    like(oracleMemories.source, `%${query}%`),
  );
}

function combineWhere(...clauses: Array<SQL | undefined>): SQL | undefined {
  const present = clauses.filter((clause): clause is SQL => Boolean(clause));
  return present.length > 1 ? and(...present) : present[0];
}

function cleanTags(tags: string[] = []): string[] {
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

function tagsFrom(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return [];
}

function memoryFromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    content: row.content,
    title: row.title ?? undefined,
    tags: tagsFrom(row.tags),
    source: row.source ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export const memoryStore = new MemoryStore();
