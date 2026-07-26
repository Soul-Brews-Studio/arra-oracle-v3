import type { Database } from 'bun:sqlite';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../vector/factory.ts';
import { cosineDistanceToSimilarity } from '../vector/scoring.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../vector/types.ts';
import { memoryConfidence } from '../routes/memory/confidence.ts';
import type { MemoryRecord } from '../routes/memory/store.ts';
import type { AskClient } from '../routes/ask/synthesis.ts';
import type { ConsolidationPlan } from './consolidation.ts';
import { queueConsolidationSuggestions, queuedConsolidationCount } from './consolidation-queue.ts';
import { llmConsolidationEnabled, llmConsolidationStatus, runLlmConsolidationPass, type LlmConsolidationPassResult } from './sleep-consolidation-llm.ts';

type QueryStore = Pick<VectorStoreAdapter, 'queryById'>;
type Env = Record<string, string | undefined>;
type Logger = Pick<Console, 'warn' | 'error'>;
type RawDoc = {
  id: string; tenantId: string; type: string; sourceFile: string; concepts: string;
  createdAt: number; updatedAt: number; usageCount: number; lastAccessedAt: number | null; content: string;
};
type Candidate = RawDoc & { confidence: number; tokens: Set<string> };

export type SleepConsolidationOptions = {
  env?: Env;
  force?: boolean;
  limit?: number;
  now?: number;
  models?: () => Record<string, EmbeddingModelConfig>;
  connect?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<QueryStore>;
  llmClient?: AskClient;
  logger?: Logger;
};

export type SleepConsolidationResult = {
  enabled: boolean;
  scanned: number;
  planned: number;
  suggestionsEmitted: number;
  queueSize: number;
  deleted: 0;
  plans: ConsolidationPlan[];
  llm?: LlmConsolidationPassResult;
};

export type SleepConsolidationStatus = {
  enabled: boolean;
  vectorEnabled: boolean;
  running: boolean;
  intervalMs: number;
  similarityThreshold: number;
  lastRun?: string;
  lastDurationMs?: number;
  lastScanned: number;
  lastSuggestionsEmitted: number;
  suggestionsEmitted: number;
  queueSize: number;
  llm: ReturnType<typeof llmConsolidationStatus>;
  lastError?: string;
  disabledReason?: string;
};

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_SIMILARITY_THRESHOLD = 0.95;
const MAX_SCAN_LIMIT = 500;
const status = {
  running: false, lastScanned: 0, lastSuggestionsEmitted: 0, suggestionsEmitted: 0,
  queueSize: 0, lastRun: undefined as string | undefined, lastDurationMs: undefined as number | undefined,
  lastError: undefined as string | undefined,
};

export function sleepConsolidationConfig(env: Env = process.env) {
  const vectorEnabled = env.ORACLE_CONSOLIDATION_WORKER === '1';
  return {
    enabled: vectorEnabled || llmConsolidationEnabled(env),
    vectorEnabled,
    intervalMs: intEnv(env.ORACLE_CONSOLIDATION_WORKER_INTERVAL_MS, DEFAULT_INTERVAL_MS, 60_000, 86_400_000),
    similarityThreshold: floatEnv(env.ORACLE_CONSOLIDATION_SIMILARITY_THRESHOLD, DEFAULT_SIMILARITY_THRESHOLD, 0, 1),
  };
}

export function sleepConsolidationStatus(env: Env = process.env): SleepConsolidationStatus {
  const config = sleepConsolidationConfig(env);
  return {
    ...status,
    ...config,
    llm: llmConsolidationStatus(env),
    queueSize: queuedConsolidationCount(),
    ...(config.enabled ? {} : { disabledReason: 'set ORACLE_CONSOLIDATION_WORKER=1 or ORACLE_CONSOLIDATION_LLM=1 to enable' }),
  };
}

export async function runSleepConsolidationSweep(
  sqlite: Database,
  input: SleepConsolidationOptions = {},
): Promise<SleepConsolidationResult> {
  const started = Date.now();
  const config = sleepConsolidationConfig(input.env);
  if (!config.enabled && !input.force) return finish(config.enabled, started, [], 0);
  const now = input.now ?? started;
  try {
    const runVector = config.vectorEnabled || input.force;
    const docs = runVector ? loadDocs(sqlite, Math.min(MAX_SCAN_LIMIT, Math.max(0, Math.floor(input.limit ?? 250))), now) : [];
    const plans = runVector ? await vectorPlans(docs, config.similarityThreshold, input) : [];
    const queued = queueConsolidationSuggestions(plans.map((plan) => ({
      ...plan,
      queuedAt: now,
      source: 'sleep-time-vector' as const,
      model: modelFromReason(plan.reason),
      similarity: plan.cosine,
    })));
    const llm = await runLlmConsolidationPass(sqlite, { ...input, now, dedupThreshold: config.similarityThreshold });
    return finish(true, started, [...plans, ...llm.plans], Math.max(docs.length, llm.scanned), queued.emitted + llm.suggestionsEmitted, llm);
  } catch (error) {
    status.lastError = error instanceof Error ? error.message : String(error);
    input.logger?.error?.(status.lastError);
    return finish(true, started, [], 0);
  }
}

export function createSleepConsolidationWorker(sqlite: Database, input: SleepConsolidationOptions = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const runOnce = () => runSleepConsolidationSweep(sqlite, input);
  return {
    runOnce,
    start() {
      const config = sleepConsolidationConfig(input.env);
      if (!config.enabled || timer) return;
      status.running = true;
      timer = setInterval(() => { void runOnce().catch((error) => (input.logger ?? console).error(error)); }, config.intervalMs);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      status.running = false;
    },
    isRunning: () => timer !== null,
  };
}

async function vectorPlans(docs: Candidate[], threshold: number, input: SleepConsolidationOptions): Promise<ConsolidationPlan[]> {
  const models = input.models?.() ?? getEmbeddingModels();
  const connect = input.connect ?? ensureVectorStoreConnected;
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const plans = new Map<string, ConsolidationPlan>();
  for (const key of Object.keys(models)) {
    const store = await connect(key, models);
    for (const doc of docs) {
      const result = await queryById(store, doc.id, input.logger);
      result.ids.forEach((id, index) => {
        const other = byId.get(id);
        if (!other || other.id === doc.id || other.tenantId !== doc.tenantId || other.type !== doc.type) return;
        const similarity = similarityFromDistance(result.distances[index]);
        if (similarity < threshold) return;
        const [oldDoc, newDoc] = chooseOld(doc, other);
        const pairKey = `${oldDoc.tenantId}:${oldDoc.id}->${newDoc.id}`;
        if (!plans.has(pairKey)) plans.set(pairKey, plan(oldDoc, newDoc, key, similarity));
      });
    }
  }
  return [...plans.values()];
}

async function queryById(store: QueryStore, id: string, logger?: Logger): Promise<VectorQueryResult> {
  try { return await store.queryById(id, 6); }
  catch (error) {
    logger?.warn?.(`[sleep-consolidation] vector lookup skipped for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
}

function loadDocs(sqlite: Database, limit: number, now: number): Candidate[] {
  if (limit <= 0) return [];
  const hasFts = objectExists(sqlite, 'oracle_fts');
  const content = hasFts ? "coalesce(f.content, '')" : "''";
  const join = hasFts ? 'LEFT JOIN oracle_fts f ON f.id = d.id' : '';
  const rows = sqlite.query<RawDoc, [number]>(`
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile, d.concepts,
      d.created_at AS createdAt, d.updated_at AS updatedAt, d.usage_count AS usageCount,
      d.last_accessed_at AS lastAccessedAt, ${content} AS content
    FROM oracle_documents d ${join}
    WHERE d.superseded_by IS NULL
    ORDER BY d.updated_at DESC
    LIMIT ?`,
  ).all(limit);
  return rows.map((row) => ({ ...row, confidence: confidence(row, now), tokens: tokens(row) }));
}

function plan(oldDoc: Candidate, newDoc: Candidate, model: string, similarity: number): ConsolidationPlan {
  const overlap = tokenOverlap(oldDoc.tokens, newDoc.tokens);
  return {
    oldId: oldDoc.id, newId: newDoc.id, tenantId: oldDoc.tenantId, cosine: round(similarity),
    ftsOverlap: overlap, oldConfidence: oldDoc.confidence, newConfidence: newDoc.confidence,
    reason: `sleep-time vector duplicate (model=${model}, similarity=${round(similarity)})`,
  };
}

function chooseOld(left: Candidate, right: Candidate): [Candidate, Candidate] {
  if (left.confidence !== right.confidence) return left.confidence < right.confidence ? [left, right] : [right, left];
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? [left, right] : [right, left];
  return left.createdAt <= right.createdAt ? [left, right] : [right, left];
}

function confidence(doc: RawDoc, now: number): number {
  const memory: MemoryRecord = {
    id: doc.id, content: doc.content, source: doc.sourceFile, tags: tagList(doc.concepts),
    createdAt: new Date(doc.createdAt).toISOString(), updatedAt: new Date(doc.updatedAt).toISOString(),
    usageCount: doc.usageCount, lastAccessedAt: doc.lastAccessedAt ? new Date(doc.lastAccessedAt).toISOString() : undefined,
  };
  return memoryConfidence(memory, { mode: 'semantic', semanticScore: 1, now: new Date(now) }).score;
}

function similarityFromDistance(value: unknown): number {
  const distance = Number(value);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return round(cosineDistanceToSimilarity(distance));
}

function finish(enabled: boolean, started: number, plans: ConsolidationPlan[], scanned: number, emitted = 0, llm?: LlmConsolidationPassResult): SleepConsolidationResult {
  status.lastRun = new Date(started).toISOString();
  status.lastDurationMs = Date.now() - started;
  status.lastScanned = scanned;
  status.lastSuggestionsEmitted = emitted;
  status.suggestionsEmitted += emitted;
  status.queueSize = queuedConsolidationCount();
  return { enabled, scanned, planned: plans.length, suggestionsEmitted: emitted, queueSize: status.queueSize, deleted: 0, plans, ...(llm ? { llm } : {}) };
}

function objectExists(sqlite: Database, name: string): boolean {
  return Boolean(sqlite.query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE name = ? LIMIT 1').get(name));
}

function tokens(doc: RawDoc): Set<string> { return new Set(tokenize(`${doc.content}\n${doc.concepts}\n${doc.sourceFile}`)); }
// Unicode-aware (#2912). Its missing NFKC/length/stopword filters are left as-is there.
function tokenize(text: string): string[] { return text.toLowerCase().match(/[\p{L}\p{N}_:-]+/gu) ?? []; }
function tagList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function tokenOverlap(left: Set<string>, right: Set<string>): number {
  const [smallest, largest] = left.size <= right.size ? [left, right] : [right, left];
  if (!smallest.size) return 0;
  let hits = 0;
  for (const token of smallest) if (largest.has(token)) hits += 1;
  return round(hits / smallest.size);
}
function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function floatEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(raw ?? '');
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}
function modelFromReason(reason: string): string { return reason.match(/model=([^,)]+)/)?.[1] ?? 'unknown'; }
function round(value: number): number { return Number(value.toFixed(4)); }
