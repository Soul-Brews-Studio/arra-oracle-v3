import type { Database } from 'bun:sqlite';
import { runWithTenant } from '../middleware/tenant.ts';
import { runSupersede } from '../tools/supersede.ts';
import type { ToolContext } from '../tools/types.ts';
import { runFactCuration, type FactCurationOptions, type FactCurationResult } from './fact-curation.ts';

type Db = ToolContext['db'];
type Logger = Pick<Console, 'log' | 'warn' | 'error'>;
type RawDoc = {
  id: string; tenantId: string; type: string; sourceFile: string; concepts: string;
  createdAt: number; updatedAt: number; indexedAt: number; project: string | null;
  createdBy: string | null; content: string;
};
type CandidateDoc = RawDoc & { tokens: string[]; tokenSet: Set<string>; confidence: ConfidenceReceipt };
type ResolvedOptions = {
  dryRun: boolean; limit: number; minCosine: number; minFtsOverlap: number;
  staleDays: number; tenantId?: string; now: number;
};

export type ConsolidationOptions = {
  dryRun?: boolean; limit?: number; minCosine?: number; minFtsOverlap?: number;
  staleDays?: number; tenantId?: string; now?: number; logger?: Logger; llm?: unknown;
  factCuration?: boolean | FactCurationOptions;
};
export type ConfidenceReceipt = {
  id: string; tenantId: string; score: number; stale: boolean;
  label: 'high' | 'medium' | 'low'; reasons: string[];
};
export type ConsolidationPlan = {
  oldId: string; newId: string; tenantId: string; cosine: number; ftsOverlap: number;
  oldConfidence: number; newConfidence: number; reason: string;
};
export type ConsolidationResult = {
  dryRun: boolean; scanned: number; planned: number; applied: number; skipped: number;
  deleted: 0; plans: ConsolidationPlan[]; confidence: ConfidenceReceipt[];
  factCuration?: FactCurationResult;
};

const DAY_MS = 86_400_000;
const DEFAULTS = { dryRun: true, limit: 250, minCosine: 0.94, minFtsOverlap: 0.86, staleDays: 45 };
const MAX_SCAN_LIMIT = 1_000;
const MIN_EVIDENCE_TOKENS = 6;
const STOP_WORDS = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was']);

function clamp(value: number, min = 0, max = 1): number { return Math.min(max, Math.max(min, value)); }

function round(value: number): number { return Number(value.toFixed(4)); }

function finiteNumber(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }

function resolveOptions(input: ConsolidationOptions): ResolvedOptions {
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : undefined;
  return {
    dryRun: input.dryRun ?? DEFAULTS.dryRun,
    limit: Math.max(0, Math.min(MAX_SCAN_LIMIT, Math.floor(finiteNumber(input.limit, DEFAULTS.limit)))),
    minCosine: clamp(finiteNumber(input.minCosine, DEFAULTS.minCosine)),
    minFtsOverlap: clamp(finiteNumber(input.minFtsOverlap, DEFAULTS.minFtsOverlap)),
    staleDays: Math.max(1, Math.floor(finiteNumber(input.staleDays, DEFAULTS.staleDays))),
    now: finiteNumber(input.now, Date.now()),
    ...(tenantId ? { tenantId } : {}),
  };
}

function resolveFactCuration(input: ConsolidationOptions): FactCurationOptions | null {
  if (!input.factCuration) return null;
  return { dryRun: input.dryRun, tenantId: input.tenantId, logger: input.logger, ...(typeof input.factCuration === 'object' ? input.factCuration : {}) };
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[a-z0-9_:-]+/g) ?? [])
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function cosine(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  const rightCounts = new Map<string, number>();
  for (const token of right) rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of counts.values()) leftNorm += value * value;
  for (const [token, value] of rightCounts) {
    rightNorm += value * value;
    dot += (counts.get(token) ?? 0) * value;
  }
  return round(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function ftsOverlap(left: Set<string>, right: Set<string>): number {
  const smallest = left.size <= right.size ? left : right;
  const largest = left.size <= right.size ? right : left;
  if (!smallest.size) return 0;
  let intersection = 0;
  for (const token of smallest) if (largest.has(token)) intersection += 1;
  return round(intersection / smallest.size);
}

function confidenceFor(doc: RawDoc, tokens: string[], now: number, staleDays: number): ConfidenceReceipt {
  const ageDays = Math.max(0, Math.floor((now - (doc.updatedAt || doc.createdAt)) / DAY_MS));
  const freshness = clamp(1 - (ageDays / Math.max(1, staleDays * 3)));
  const provenance = (doc.project ? 0.45 : 0) + (doc.createdBy ? 0.35 : 0) + (doc.sourceFile ? 0.2 : 0);
  const completeness = clamp(tokens.length / 80);
  const score = round((freshness * 0.45) + (provenance * 0.35) + (completeness * 0.2));
  const stale = ageDays >= staleDays || !doc.indexedAt;
  return { id: doc.id, tenantId: doc.tenantId, score, stale, label: score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low',
    reasons: [stale ? 'stale_document' : 'fresh_document', doc.project ? 'project_provenance' : 'missing_project', tokens.length >= 40 ? 'content_complete' : 'content_sparse'] };
}

function docsSql(hasFts: boolean, tenantId?: string): string {
  const content = hasFts ? "coalesce(f.content, '')" : "''";
  const join = hasFts ? 'LEFT JOIN oracle_fts f ON f.id = d.id' : '';
  const tenant = tenantId ? 'AND d.tenant_id = ?' : '';
  return `
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile,
      d.concepts, d.created_at AS createdAt, d.updated_at AS updatedAt,
      d.indexed_at AS indexedAt, d.project, d.created_by AS createdBy, ${content} AS content
    FROM oracle_documents d
    ${join}
    WHERE d.superseded_by IS NULL ${tenant}
    ORDER BY d.updated_at DESC
    LIMIT ?`;
}

function objectExists(sqlite: Database, name: string): boolean {
  const row = sqlite.query<{ name: string }, [string]>(
    'SELECT name FROM sqlite_master WHERE name = ? LIMIT 1',
  ).get(name);
  return Boolean(row);
}

function loadDocs(sqlite: Database, options: ResolvedOptions): CandidateDoc[] {
  const params = options.tenantId ? [options.tenantId, options.limit] : [options.limit];
  const rows = sqlite.query<RawDoc, (string | number)[]>(docsSql(objectExists(sqlite, 'oracle_fts'), options.tenantId))
    .all(...params);
  return rows.map((row) => {
    const tokens = tokenize(`${row.content}\n${row.concepts}\n${row.sourceFile}`);
    return { ...row, content: row.content ?? '', tokens, tokenSet: new Set(tokens), confidence: confidenceFor(row, tokens, options.now, options.staleDays) };
  });
}

function chooseOld(left: CandidateDoc, right: CandidateDoc): [CandidateDoc, CandidateDoc] {
  if (left.confidence.score !== right.confidence.score) {
    return left.confidence.score < right.confidence.score ? [left, right] : [right, left];
  }
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? [left, right] : [right, left];
  return left.createdAt <= right.createdAt ? [left, right] : [right, left];
}

function planDocs(docs: CandidateDoc[], options: ResolvedOptions): ConsolidationPlan[] {
  const plans: ConsolidationPlan[] = [];
  const used = new Set<string>();
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) {
      const left = docs[i];
      const right = docs[j];
      if (left.tenantId !== right.tenantId || left.type !== right.type) continue;
      if (used.has(left.id) || used.has(right.id)) continue;
      if (Math.min(left.tokenSet.size, right.tokenSet.size) < MIN_EVIDENCE_TOKENS) continue;
      const sim = cosine(left.tokens, right.tokens);
      const overlap = ftsOverlap(left.tokenSet, right.tokenSet);
      if (sim < options.minCosine || overlap < options.minFtsOverlap) continue;
      const [oldDoc, newDoc] = chooseOld(left, right);
      used.add(oldDoc.id);
      used.add(newDoc.id);
      plans.push({
        oldId: oldDoc.id,
        newId: newDoc.id,
        tenantId: oldDoc.tenantId,
        cosine: sim,
        ftsOverlap: overlap,
        oldConfidence: oldDoc.confidence.score,
        newConfidence: newDoc.confidence.score,
        reason: `async consolidation duplicate (cosine=${sim}, fts_overlap=${overlap})`,
      });
    }
  }
  return plans;
}

export async function runConsolidationWorker(
  db: Db,
  sqlite: Database,
  input: ConsolidationOptions = {},
): Promise<ConsolidationResult> {
  if (input.llm) {
    const { runLlmConsolidationWorker } = await import('./consolidation-llm.ts');
    return runLlmConsolidationWorker(db, sqlite, input as any);
  }
  const options = resolveOptions(input);
  const logger = input.logger ?? console;
  const docs = loadDocs(sqlite, options);
  const plans = planDocs(docs, options);
  let applied = 0;
  for (const plan of plans) {
    if (options.dryRun) {
      logger.log(`[consolidation:dry-run] would supersede ${plan.oldId} -> ${plan.newId}`);
      continue;
    }
    try {
      const result = runWithTenant(plan.tenantId, () => runSupersede(db, {
        oldId: plan.oldId,
        newId: plan.newId,
        reason: plan.reason,
      }));
      if (result.isError) logger.warn(`[consolidation] skipped ${plan.oldId}: ${JSON.stringify(result.payload)}`);
      else applied += 1;
    } catch (error) {
      logger.warn(`[consolidation] skipped ${plan.oldId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const factCuration = resolveFactCuration(input);
  const curated = factCuration ? await runFactCuration(db, sqlite, factCuration) : undefined;
  return {
    dryRun: options.dryRun, scanned: docs.length, planned: plans.length + (curated?.planned ?? 0),
    applied: applied + (curated?.applied ?? 0), skipped: (plans.length - applied) + (curated?.skipped ?? 0),
    deleted: 0, plans, confidence: docs.map((doc) => doc.confidence).filter((receipt) => receipt.stale),
    ...(curated ? { factCuration: curated } : {}),
  };
}

export function createConsolidationWorker(db: Db, sqlite: Database, input: ConsolidationOptions & { intervalMs?: number } = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const intervalMs = input.intervalMs ?? 300_000;
  const runOnce = () => runConsolidationWorker(db, sqlite, input);
  return {
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(() => { void runOnce().catch((error) => (input.logger ?? console).error(error)); }, intervalMs);
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    },
    isRunning: () => timer !== null,
  };
}
