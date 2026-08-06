import { and, desc, eq, inArray, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { db as defaultDb, oracleMemories } from '../../db/index.ts';
import { currentTenantId, tenantIdForWrite } from '../../middleware/tenant.ts';
import type * as schema from '../../db/schema.ts';
import { parseMemoryLimit } from './model.ts';
import { memorySalience, normalizeMemoryTier, type MemoryTier } from './salience.ts';

export type MemoryInput = {
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
  tier?: MemoryTier;
  validFrom?: string | number;
  validTo?: string | number | null;
  validUntil?: string | number;
};

export type MemoryRecord = MemoryInput & {
  id: string;
  tenantId?: string;
  createdAt: string;
  updatedAt: string;
  tier?: MemoryTier;
  heatScore?: number;
  usageCount?: number;
  lastAccessedAt?: string;
  validFrom?: string;
  validTo?: string;
  validUntil?: string;
  supersededBy?: string;
  supersededAt?: string;
  supersededReason?: string;
};

export type MemoryTierSummary = {
  counts: Record<MemoryTier, number>;
  total: number;
  items: Record<MemoryTier, MemoryRecord[]>;
};

type OracleDb = BunSQLiteDatabase<typeof schema>;
type MemoryRow = typeof oracleMemories.$inferSelect;
type RecallOptions = { includeCold?: boolean; now?: Date; asOf?: string | number };
export type MemoryDecayOptions = { enabled?: boolean; now?: () => number };

export class MemoryStore {
  constructor(private readonly database?: OracleDb, private readonly decay: MemoryDecayOptions = {}) {}

  private get db(): OracleDb {
    return this.database ?? defaultDb;
  }

  save(input: MemoryInput): MemoryRecord {
    const content = input.content.trim();
    if (!content) throw new Error('memory content is required');
    const now = Date.now();
    const validFrom = parseValidTime(input.validFrom);
    const validTo = parseValidTime(input.validTo ?? input.validUntil);
    if (validFrom && validTo && validTo <= validFrom) throw new Error('valid_to must be after valid_from');
    const isoNow = new Date(now).toISOString();
    const salience = memorySalience({ tier: input.tier, createdAt: isoNow, updatedAt: isoNow, usageCount: 0 }, new Date(now));
    const row = this.db.insert(oracleMemories).values({
      id: `mem_${now.toString(36)}_${crypto.randomUUID().slice(0, 8)}`,
      tenantId: tenantIdForWrite(),
      content,
      title: input.title?.trim() || null,
      tags: JSON.stringify(cleanTags(input.tags)),
      source: input.source?.trim() || null,
      validFrom: validFrom ?? null,
      validTo: validTo ?? null,
      tier: salience.tier,
      heatScore: salience.heatScore,
      usageCount: 0,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    return memoryFromRow(row);
  }

  recall(query = '', limit = 10, options: RecallOptions | string | number = {}): MemoryRecord[] {
    this.supersedeExpired();
    const opts = normalizeOptions(options);
    const normalized = query.trim();
    const safeLimit = parseMemoryLimit(limit);
    const includeCold = opts.includeCold ?? Boolean(normalized);
    const where = combineWhere(
      tenantWhere(), isNull(oracleMemories.supersededAt), searchWhere(normalized),
      asOfWhere(parseValidTime(opts.asOf)), includeCold ? undefined : ne(oracleMemories.tier, 'cold'),
    );
    const selected = this.db.select().from(oracleMemories);
    const rows = (where ? selected.where(where) : selected)
      .orderBy(tierOrder(), desc(oracleMemories.heatScore), desc(oracleMemories.updatedAt))
      .limit(safeLimit).all();
    return this.reinforceRows(rows, opts.now);
  }

  getByIds(ids: string[], options: RecallOptions | string | number = {}): MemoryRecord[] {
    if (!ids.length) return [];
    this.supersedeExpired();
    const opts = normalizeOptions(options);
    const where = combineWhere(inArray(oracleMemories.id, ids), tenantWhere(), isNull(oracleMemories.supersededAt), asOfWhere(parseValidTime(opts.asOf)));
    const rows = this.db.select().from(oracleMemories).where(where).all();
    const byId = new Map(this.reinforceRows(rows, opts.now).map((row) => [row.id, row]));
    return ids.map((id) => byId.get(id)).filter((row): row is MemoryRecord => Boolean(row));
  }

  tierSummary(limit = 5, options: RecallOptions = {}): MemoryTierSummary {
    this.supersedeExpired();
    this.rebalance(options.now);
    const tiers: MemoryTier[] = ['core', 'warm', 'cold'];
    const items: Record<MemoryTier, MemoryRecord[]> = { core: [], warm: [], cold: [] };
    const counts = { core: 0, warm: 0, cold: 0 } as Record<MemoryTier, number>;
    for (const tier of tiers) {
      const where = combineWhere(tenantWhere(), isNull(oracleMemories.supersededAt), eq(oracleMemories.tier, tier));
      const rows = this.db.select().from(oracleMemories).where(where)
        .orderBy(desc(oracleMemories.heatScore), desc(oracleMemories.updatedAt))
        .limit(parseMemoryLimit(limit, 5, 25)).all();
      items[tier] = rows.map(memoryFromRow);
      counts[tier] = Number(this.db.select({ count: sql<number>`count(*)` }).from(oracleMemories).where(where).get()?.count ?? 0);
    }
    return { counts, total: counts.core + counts.warm + counts.cold, items };
  }

  supersedeExpired(reason = 'memory TTL expired'): number {
    if (!this.decay.enabled) return 0;
    const now = this.now();
    const result = this.db.update(oracleMemories).set({ supersededAt: now, supersededReason: reason })
      .where(combineWhere(tenantWhere(), isNull(oracleMemories.supersededAt), lt(oracleMemories.validTo, now)))
      .run() as { changes?: number } | void;
    return result?.changes ?? 0;
  }

  rebalance(now = new Date()): void {
    const where = combineWhere(tenantWhere(), isNull(oracleMemories.supersededAt));
    const selected = this.db.select().from(oracleMemories);
    const rows = where ? selected.where(where).all() : selected.all();
    for (const row of rows) this.updateSalience(row, row.usageCount, row.lastAccessedAt, now);
  }

  private now(): number {
    return this.decay.now?.() ?? Date.now();
  }

  private reinforceRows(rows: MemoryRow[], now = new Date(this.now())): MemoryRecord[] {
    return rows.map((row) => this.updateSalience(row, row.usageCount + 1, now.getTime(), now));
  }

  private updateSalience(row: MemoryRow, usageCount: number, lastAccessedAt: number | null, now: Date): MemoryRecord {
    const current = memoryFromRow({ ...row, usageCount, lastAccessedAt });
    const salience = memorySalience(current, now);
    this.db.update(oracleMemories).set({ usageCount, lastAccessedAt, tier: salience.tier, heatScore: salience.heatScore })
      .where(eq(oracleMemories.id, row.id)).run();
    return { ...current, tier: salience.tier, heatScore: salience.heatScore, usageCount };
  }
}

function normalizeOptions(options: RecallOptions | string | number): RecallOptions {
  return typeof options === 'string' || typeof options === 'number' ? { asOf: options } : options;
}

function tierOrder(): SQL {
  return sql`CASE ${oracleMemories.tier} WHEN 'core' THEN 0 WHEN 'warm' THEN 1 ELSE 2 END`;
}

function tenantWhere(): SQL | undefined {
  const tenantId = currentTenantId();
  return tenantId ? eq(oracleMemories.tenantId, tenantId) : undefined;
}

function asOfWhere(asOf: number | undefined): SQL | undefined {
  if (!asOf) return undefined;
  return sql`coalesce(${oracleMemories.validFrom}, ${oracleMemories.createdAt}) <= ${asOf}
    and (${oracleMemories.validTo} is null or ${oracleMemories.validTo} > ${asOf})`;
}

function searchWhere(query: string): SQL | undefined {
  if (!query) return undefined;
  return or(like(oracleMemories.content, `%${query}%`), like(oracleMemories.title, `%${query}%`), like(oracleMemories.tags, `%${query}%`), like(oracleMemories.source, `%${query}%`));
}

function combineWhere(...clauses: Array<SQL | undefined>): SQL | undefined {
  const present = clauses.filter((clause): clause is SQL => Boolean(clause));
  return present.length > 1 ? and(...present) : present[0];
}

function cleanTags(tags: string[] = []): string[] {
  return tags.map((tag) => tag.trim()).filter(Boolean);
}

export function parseValidTime(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const ms = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms <= 0) throw new Error('invalid valid-time timestamp');
  return ms;
}

function tagsFrom(value: string): string[] {
  try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean); } catch {}
  return [];
}

function iso(value: number | null): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

function memoryFromRow(row: MemoryRow): MemoryRecord {
  return {
    id: row.id, tenantId: row.tenantId, content: row.content, title: row.title ?? undefined,
    tags: tagsFrom(row.tags), source: row.source ?? undefined, tier: normalizeMemoryTier(row.tier),
    heatScore: Number(row.heatScore ?? 0), usageCount: Math.max(0, Number(row.usageCount ?? 0)),
    lastAccessedAt: iso(row.lastAccessedAt), validFrom: iso(row.validFrom), validTo: iso(row.validTo), validUntil: iso(row.validTo),
    supersededBy: row.supersededBy ?? undefined, supersededAt: iso(row.supersededAt), supersededReason: row.supersededReason ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export const memoryStore = new MemoryStore(undefined, {
  enabled: process.env.MEMORY_TTL_AUTOSUPERSEDE === '1' || process.env.MEMORY_TTL_AUTOSUPERSEDE === 'true',
});
