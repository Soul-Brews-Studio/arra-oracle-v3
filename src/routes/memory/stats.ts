import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { db as defaultDb, oracleMemories } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { memoryConfidence } from './confidence.ts';
import type { MemoryRecord } from './store.ts';
import type * as schema from '../../db/schema.ts';

type Db = BunSQLiteDatabase<typeof schema>;
type Row = typeof oracleMemories.$inferSelect;

type Buckets = Record<'cold' | 'warm' | 'hot', number>;
type Histogram = Record<'low' | 'medium' | 'high', number>;

export function createMemoryStatsEndpoint(database: Db = defaultDb) {
  return new Elysia().get('/memory/stats', () => memoryStats(database), {
    detail: { tags: ['memory'], menu: { group: 'hidden' }, summary: 'Memory health and consolidation metrics' },
  });
}

export function memoryStats(database: Db = defaultDb, now = new Date()) {
  const rows = loadRows(database);
  const records = rows.map(memoryFromRow);
  const confidence: Histogram = { low: 0, medium: 0, high: 0 };
  const heat: Buckets = { cold: 0, warm: 0, hot: 0 };
  for (const memory of records) {
    confidence[memoryConfidence(memory, { now }).label] += 1;
    heat[heatBucket(memory, now)] += 1;
  }
  const superseded = rows.filter((row) => row.supersededAt !== null || row.supersededBy !== null).length;
  const validTime = rows.filter((row) => row.validFrom !== null || row.validTo !== null).length;
  return {
    total: rows.length,
    active: rows.length - superseded,
    superseded,
    heat_distribution: heat,
    confidence_histogram: confidence,
    supersede_chain: chainStats(rows),
    valid_time_coverage: {
      count: validTime,
      percent: rows.length ? round(validTime / rows.length) : 0,
    },
  };
}

function loadRows(database: Db): Row[] {
  const tenantId = currentTenantId();
  const query = database.select().from(oracleMemories);
  return tenantId ? query.where(eq(oracleMemories.tenantId, tenantId)).all() : query.all();
}

function chainStats(rows: Row[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  let maxDepth = 0;
  let linked = 0;
  for (const row of rows) {
    if (!row.supersededBy) continue;
    linked += 1;
    let depth = 1;
    const seen = new Set([row.id]);
    let next = byId.get(row.supersededBy);
    while (next?.supersededBy && !seen.has(next.id)) {
      seen.add(next.id);
      depth += 1;
      next = byId.get(next.supersededBy);
    }
    maxDepth = Math.max(maxDepth, depth);
  }
  return { linked, max_depth: maxDepth };
}

function heatBucket(memory: MemoryRecord, now: Date): keyof Buckets {
  const usage = Math.max(0, Number(memory.usageCount ?? 0));
  const touched = Date.parse(memory.lastAccessedAt ?? memory.updatedAt);
  const ageDays = Number.isFinite(touched) ? Math.max(0, (now.getTime() - touched) / 86_400_000) : Number.POSITIVE_INFINITY;
  if (usage >= 10 || ageDays <= 7) return 'hot';
  if (usage >= 2 || ageDays <= 30) return 'warm';
  return 'cold';
}

function memoryFromRow(row: Row): MemoryRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    content: row.content,
    title: row.title ?? undefined,
    tags: tagsFrom(row.tags),
    source: row.source ?? undefined,
    tier: row.tier === 'core' || row.tier === 'cold' ? row.tier : 'warm',
    heatScore: Number(row.heatScore ?? 0),
    usageCount: Math.max(0, Number(row.usageCount ?? 0)),
    lastAccessedAt: row.lastAccessedAt ? new Date(row.lastAccessedAt).toISOString() : undefined,
    validFrom: row.validFrom ? new Date(row.validFrom).toISOString() : undefined,
    validTo: row.validTo ? new Date(row.validTo).toISOString() : undefined,
    supersededBy: row.supersededBy ?? undefined,
    supersededAt: row.supersededAt ? new Date(row.supersededAt).toISOString() : undefined,
    supersededReason: row.supersededReason ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function tagsFrom(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {}
  return [];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
