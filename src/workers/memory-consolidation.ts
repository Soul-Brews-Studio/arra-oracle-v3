import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import { oracleMemories } from '../db/schema.ts';
import { runWithTenant } from '../middleware/tenant.ts';
import { memoryConfidence } from '../routes/memory/confidence.ts';
import type { MemoryRecord } from '../routes/memory/store.ts';
import type * as schema from '../db/schema.ts';

type Db = BunSQLiteDatabase<typeof schema>;
type Row = typeof oracleMemories.$inferSelect;
type Logger = Pick<Console, 'log' | 'warn'>;
type ResolvedOptions = Omit<Required<MemoryConsolidationOptions>, 'tenantId' | 'logger'> & { tenantId?: string; logger?: Logger };

type Candidate = MemoryRecord & {
  tenantId: string;
  tokens: string[];
  tokenSet: Set<string>;
  confidenceScore: number;
  heatScore: number;
};

export type MemoryConsolidationOptions = {
  dryRun?: boolean;
  limit?: number;
  tenantId?: string;
  now?: Date;
  minCosine?: number;
  minOverlap?: number;
  logger?: Logger;
};

export type MemoryConsolidationPlan = {
  oldId: string;
  newId: string;
  tenantId: string;
  cosine: number;
  overlap: number;
  oldScore: number;
  newScore: number;
  reason: string;
};

export type MemoryConsolidationResult = {
  dryRun: boolean;
  scanned: number;
  planned: number;
  applied: number;
  deleted: 0;
  plans: MemoryConsolidationPlan[];
};

const DEFAULTS = { dryRun: true, limit: 250, minCosine: 0.96, minOverlap: 0.9 };
const DAY_MS = 86_400_000;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into']);

export async function runMemoryConsolidationWorker(
  db: Db,
  input: MemoryConsolidationOptions = {},
): Promise<MemoryConsolidationResult> {
  const options = { ...DEFAULTS, now: new Date(), ...input };
  const memories = loadCandidates(db, options);
  const plans = planConsolidation(memories, options);
  let applied = 0;
  for (const plan of plans) {
    if (options.dryRun) {
      options.logger?.log(`[memory-consolidation:dry-run] would supersede ${plan.oldId} -> ${plan.newId}`);
      continue;
    }
    applied += runWithTenant(plan.tenantId, () => applyPlan(db, plan, options.now.getTime())) ? 1 : 0;
  }
  return { dryRun: options.dryRun, scanned: memories.length, planned: plans.length, applied, deleted: 0, plans };
}

function loadCandidates(db: Db, options: ResolvedOptions): Candidate[] {
  const where = options.tenantId
    ? and(eq(oracleMemories.tenantId, options.tenantId), isNull(oracleMemories.supersededAt))
    : isNull(oracleMemories.supersededAt);
  return db.select().from(oracleMemories).where(where).limit(options.limit).all().map((row) => candidate(row, options.now));
}

function candidate(row: Row, now: Date): Candidate {
  const record = memoryFromRow(row);
  const tokens = tokenize([record.title, record.content, record.source, ...(record.tags ?? [])].filter(Boolean).join(' '));
  const confidence = memoryConfidence(record, { now, mode: 'keyword' }).score;
  return { ...record, tenantId: row.tenantId, tokens, tokenSet: new Set(tokens), confidenceScore: confidence, heatScore: heat(row, now) };
}

function planConsolidation(candidates: Candidate[], options: ResolvedOptions): MemoryConsolidationPlan[] {
  const plans: MemoryConsolidationPlan[] = [];
  const used = new Set<string>();
  for (let i = 0; i < candidates.length; i += 1) {
    for (let j = i + 1; j < candidates.length; j += 1) {
      const left = candidates[i];
      const right = candidates[j];
      if (left.tenantId !== right.tenantId || used.has(left.id) || used.has(right.id)) continue;
      const sim = cosine(left.tokens, right.tokens);
      const overlap = tokenOverlap(left.tokenSet, right.tokenSet);
      if (sim < options.minCosine || overlap < options.minOverlap) continue;
      const [oldMem, newMem] = chooseSurvivor(left, right);
      used.add(oldMem.id);
      used.add(newMem.id);
      plans.push({
        oldId: oldMem.id,
        newId: newMem.id,
        tenantId: oldMem.tenantId,
        cosine: sim,
        overlap,
        oldScore: combinedScore(oldMem),
        newScore: combinedScore(newMem),
        reason: `memory consolidation duplicate (cosine=${sim}, overlap=${overlap})`,
      });
    }
  }
  return plans;
}

function applyPlan(db: Db, plan: MemoryConsolidationPlan, now: number): boolean {
  const result = db.update(oracleMemories).set({
    supersededBy: plan.newId,
    supersededAt: now,
    supersededReason: plan.reason,
  }).where(and(eq(oracleMemories.id, plan.oldId), eq(oracleMemories.tenantId, plan.tenantId), isNull(oracleMemories.supersededAt))).run() as { changes?: number } | void;
  return (result?.changes ?? 0) > 0;
}

function chooseSurvivor(left: Candidate, right: Candidate): [Candidate, Candidate] {
  const leftScore = combinedScore(left);
  const rightScore = combinedScore(right);
  if (leftScore !== rightScore) return leftScore < rightScore ? [left, right] : [right, left];
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? [left, right] : [right, left];
  return left.createdAt <= right.createdAt ? [left, right] : [right, left];
}

function combinedScore(memory: Candidate): number {
  return round((memory.confidenceScore * 0.7) + (memory.heatScore * 0.3));
}

function heat(row: Row, now: Date): number {
  const ageDays = Math.max(0, (now.getTime() - row.updatedAt) / DAY_MS);
  return round(0.5 ** (ageDays / 30));
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[a-z0-9_:-]+/g) ?? [])
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function cosine(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  const rightCounts = new Map<string, number>();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  for (const token of right) rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  let dot = 0, leftNorm = 0, rightNorm = 0;
  for (const value of counts.values()) leftNorm += value * value;
  for (const [token, value] of rightCounts) {
    rightNorm += value * value;
    dot += (counts.get(token) ?? 0) * value;
  }
  return round(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function tokenOverlap(left: Set<string>, right: Set<string>): number {
  const [smallest, largest] = left.size <= right.size ? [left, right] : [right, left];
  if (!smallest.size) return 0;
  let hits = 0;
  for (const token of smallest) if (largest.has(token)) hits += 1;
  return round(hits / smallest.size);
}

function memoryFromRow(row: Row): MemoryRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    content: row.content,
    title: row.title ?? undefined,
    tags: tagsFrom(row.tags),
    source: row.source ?? undefined,
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
  return Number(value.toFixed(4));
}
