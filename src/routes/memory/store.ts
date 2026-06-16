import { desc, inArray, like, or } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { db as defaultDb, oracleMemories } from '../../db/index.ts';
import type * as schema from '../../db/schema.ts';

export type MemoryInput = {
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
};

export type MemoryRecord = MemoryInput & {
  id: string;
  createdAt: string;
  updatedAt: string;
};

type OracleDb = BunSQLiteDatabase<typeof schema>;
type MemoryRow = typeof oracleMemories.$inferSelect;

export class MemoryStore {
  constructor(private readonly database: OracleDb = defaultDb) {}

  save(input: MemoryInput): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new Error('memory content is required');
    const now = Date.now();
    const row = this.database.insert(oracleMemories).values({
      id: `mem_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
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
    const safeLimit = Math.min(50, Math.max(1, limit));
    const base = this.database.select().from(oracleMemories);
    const rows = normalized
      ? base.where(or(
        like(oracleMemories.content, `%${normalized}%`),
        like(oracleMemories.title, `%${normalized}%`),
        like(oracleMemories.tags, `%${normalized}%`),
        like(oracleMemories.source, `%${normalized}%`),
      )).orderBy(desc(oracleMemories.createdAt)).limit(safeLimit).all()
      : base.orderBy(desc(oracleMemories.createdAt)).limit(safeLimit).all();
    return rows.map(memoryFromRow);
  }

  getByIds(ids: string[]): MemoryRecord[] {
    if (!ids.length) return [];
    const rows = this.database.select().from(oracleMemories)
      .where(inArray(oracleMemories.id, ids))
      .all();
    const byId = new Map(rows.map((row) => [row.id, memoryFromRow(row)]));
    return ids.map((id) => byId.get(id)).filter((row): row is MemoryRecord => Boolean(row));
  }

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
    content: row.content,
    title: row.title ?? undefined,
    tags: tagsFrom(row.tags),
    source: row.source ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export const memoryStore = new MemoryStore();
