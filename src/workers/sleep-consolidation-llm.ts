import type { Database } from 'bun:sqlite';
import { envAskClient, type AskClient, type AskSource } from '../routes/ask/synthesis.ts';
import { memoryConfidence } from '../routes/memory/confidence.ts';
import type { MemoryRecord } from '../routes/memory/store.ts';
import { ensureVectorStoreConnected, getEmbeddingModels, type EmbeddingModelConfig } from '../vector/factory.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../vector/types.ts';
import type { ConsolidationPlan } from './consolidation.ts';
import { queueConsolidationSuggestions } from './consolidation-queue.ts';
import { tokenSetForConsolidation } from './tokenize.ts';

type Env = Record<string, string | undefined>;
type Logger = Pick<Console, 'warn'>;
type QueryStore = Pick<VectorStoreAdapter, 'queryById'>;
type RawDoc = {
  id: string; tenantId: string; type: string; sourceFile: string; concepts: string;
  createdAt: number; updatedAt: number; usageCount: number; lastAccessedAt: number | null; content: string;
};
type Candidate = RawDoc & { confidence: number; tokens: Set<string> };
type Pair = { left: Candidate; right: Candidate; model: string; similarity: number };
type Decision = { oldId: string; newId: string; reason: string; model: string };

export type LlmConsolidationOptions = {
  env?: Env; now?: number; limit?: number; dedupThreshold?: number;
  models?: () => Record<string, EmbeddingModelConfig>;
  connect?: (key: string, models: Record<string, EmbeddingModelConfig>) => Promise<QueryStore>;
  logger?: Logger; llmClient?: AskClient;
};
export type LlmConsolidationPassResult = {
  enabled: boolean; scanned: number; pairs: number; planned: number;
  suggestionsEmitted: number; skipped: number; plans: ConsolidationPlan[];
};

const DEFAULT_LLM_CAP = 10;
const LLM_SIMILARITY_FLOOR = 0.6;
const DEFAULT_DEDUP_THRESHOLD = 0.95;

export function llmConsolidationEnabled(env: Env = process.env): boolean {
  return env.ORACLE_CONSOLIDATION_LLM === '1';
}

export function llmConsolidationStatus(env: Env = process.env) {
  return { enabled: llmConsolidationEnabled(env), cap: capFrom(env), similarityFloor: LLM_SIMILARITY_FLOOR };
}

export async function runLlmConsolidationPass(
  sqlite: Database,
  input: LlmConsolidationOptions = {},
): Promise<LlmConsolidationPassResult> {
  const env = input.env ?? process.env;
  if (!llmConsolidationEnabled(env)) return empty(false);
  const client = input.llmClient ?? envAskClient({ ...process.env, ...env, ORACLE_ASK_LLM: env.ORACLE_ASK_LLM ?? '1' });
  if (!client) return empty(true);
  const now = input.now ?? Date.now();
  const docs = loadDocs(sqlite, Math.min(500, Math.max(0, Math.floor(input.limit ?? 250))), now);
  const pairs = await candidatePairs(docs, input.dedupThreshold ?? DEFAULT_DEDUP_THRESHOLD, input);
  const cap = capFrom(env);
  const plans: ConsolidationPlan[] = [];
  let calls = 0;
  for (const pair of pairs) {
    if (calls >= cap || plans.length >= cap) break;
    calls += 1;
    const decision = parseDecision(await client(promptFor(pair)), pair, env);
    if (!decision) continue;
    const plan = planFrom(pair, decision);
    if (plan) plans.push(plan);
  }
  const queued = queueConsolidationSuggestions(plans.map((plan) => ({
    ...plan, queuedAt: now, source: 'sleep-time-llm' as const,
    model: modelFromReason(plan.reason), similarity: plan.cosine,
  })));
  return {
    enabled: true, scanned: docs.length, pairs: calls, planned: plans.length,
    suggestionsEmitted: queued.emitted, skipped: Math.max(0, calls - plans.length), plans,
  };
}

async function candidatePairs(docs: Candidate[], dedupThreshold: number, input: LlmConsolidationOptions): Promise<Pair[]> {
  const models = input.models?.() ?? getEmbeddingModels();
  const connect = input.connect ?? ensureVectorStoreConnected;
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const pairs = new Map<string, Pair>();
  for (const key of Object.keys(models)) {
    const store = await connect(key, models);
    for (const doc of docs) {
      const result = await queryById(store, doc.id, input.logger);
      result.ids.forEach((id, index) => {
        const other = byId.get(id);
        if (!other || other.id === doc.id || other.tenantId !== doc.tenantId || other.type !== doc.type) return;
        const similarity = similarityFromDistance(result.distances[index]);
        if (similarity >= dedupThreshold || similarity < LLM_SIMILARITY_FLOOR) return;
        const pairKey = [doc.id, other.id].sort().join('::');
        if (!pairs.has(pairKey)) pairs.set(pairKey, { left: doc, right: other, model: key, similarity });
      });
    }
  }
  return [...pairs.values()].sort((a, b) => b.similarity - a.similarity);
}

async function queryById(store: QueryStore, id: string, logger?: Logger): Promise<VectorQueryResult> {
  try { return await store.queryById(id, 6); }
  catch (error) {
    logger?.warn?.(`[sleep-consolidation:llm] vector lookup skipped for ${id}: ${error instanceof Error ? error.message : String(error)}`);
    return { ids: [], documents: [], distances: [], metadatas: [] };
  }
}

function loadDocs(sqlite: Database, limit: number, now: number): Candidate[] {
  if (limit <= 0) return [];
  const hasFts = Boolean(sqlite.query<{ name: string }, [string]>('SELECT name FROM sqlite_master WHERE name = ? LIMIT 1').get('oracle_fts'));
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

function promptFor(pair: Pair) {
  return {
    instruction: [
      'You are a consolidation reviewer. Decide if one source supersedes the other.',
      'Only return SUPERSEDE when the newer/better source corrects, replaces, or contradicts the older one.',
      'Never request deletion or direct writes. Return JSON only:',
      '{"action":"SUPERSEDE|NOOP","oldId":"...","newId":"...","reason":"...","model":"..."}.',
    ].join(' '),
    question: `Do ${pair.left.id} and ${pair.right.id} require a SUPERSEDE suggestion or NOOP?`,
    sources: [sourceFrom(pair.left, 1, pair.similarity), sourceFrom(pair.right, 2, pair.similarity)],
  };
}

function sourceFrom(doc: Candidate, index: number, score: number): AskSource {
  return {
    index, id: doc.id, type: doc.type, title: doc.sourceFile.split('/').pop() ?? doc.id,
    sourceFile: doc.sourceFile, score, confidence: doc.confidence,
    excerpt: doc.content.replace(/\s+/g, ' ').trim().slice(0, 420), stale: false,
  };
}

function parseDecision(raw: unknown, pair: Pair, env: Env): Decision | null {
  const record = firstRecord(typeof raw === 'string' ? jsonish(raw) : raw);
  const action = String(record?.action ?? '').toUpperCase();
  if (action !== 'SUPERSEDE') return null;
  const oldId = String(record?.oldId ?? record?.old_id ?? '');
  const newId = String(record?.newId ?? record?.new_id ?? '');
  if (!validPairIds(pair, oldId, newId)) return null;
  const reason = String(record?.reason ?? '').trim();
  return { oldId, newId, reason: reason || 'LLM marked this pair as superseding', model: String(record?.model ?? env.ORACLE_ASK_LLM_MODEL ?? 'ask-llm') };
}

function firstRecord(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Record<string, unknown>;
  const calls = Array.isArray(record.calls) ? record.calls : undefined;
  return (calls?.find((item) => item && typeof item === 'object') ?? record) as Record<string, unknown>;
}

function jsonish(raw: string): unknown {
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? raw.trim();
  const start = fenced.indexOf('{');
  if (start < 0) return null;
  try { return JSON.parse(fenced.slice(start)); } catch { return null; }
}

function planFrom(pair: Pair, decision: Decision): ConsolidationPlan | null {
  const docs = new Map([[pair.left.id, pair.left], [pair.right.id, pair.right]]);
  const oldDoc = docs.get(decision.oldId);
  const newDoc = docs.get(decision.newId);
  if (!oldDoc || !newDoc || oldDoc.id === newDoc.id) return null;
  return {
    oldId: oldDoc.id, newId: newDoc.id, tenantId: oldDoc.tenantId, cosine: round(pair.similarity),
    ftsOverlap: tokenOverlap(oldDoc.tokens, newDoc.tokens),
    oldConfidence: oldDoc.confidence, newConfidence: newDoc.confidence,
    reason: `sleep-time LLM SUPERSEDE-suggest (model=${decision.model}, vector_model=${pair.model}, similarity=${round(pair.similarity)}): ${decision.reason}`,
  };
}

function validPairIds(pair: Pair, oldId: string, newId: string): boolean {
  const ids = new Set([pair.left.id, pair.right.id]);
  return oldId !== newId && ids.has(oldId) && ids.has(newId);
}

function confidence(doc: RawDoc, now: number): number {
  const memory: MemoryRecord = {
    id: doc.id, content: doc.content, source: doc.sourceFile, tags: tagList(doc.concepts),
    createdAt: new Date(doc.createdAt).toISOString(), updatedAt: new Date(doc.updatedAt).toISOString(),
    usageCount: doc.usageCount, lastAccessedAt: doc.lastAccessedAt ? new Date(doc.lastAccessedAt).toISOString() : undefined,
  };
  return memoryConfidence(memory, { mode: 'semantic', semanticScore: 1, now: new Date(now) }).score;
}

function empty(enabled: boolean): LlmConsolidationPassResult {
  return { enabled, scanned: 0, pairs: 0, planned: 0, suggestionsEmitted: 0, skipped: 0, plans: [] };
}
function capFrom(env: Env): number {
  const parsed = Number.parseInt(env.ORACLE_CONSOLIDATION_LLM_CAP ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : DEFAULT_LLM_CAP;
}
function similarityFromDistance(value: unknown): number {
  const distance = Number(value ?? 1);
  if (!Number.isFinite(distance) || distance < 0) return 0;
  return round(distance <= 1 ? 1 - distance : 1 / (1 + distance));
}
// Unicode-aware (#2912). Like sleep-consolidation.ts this one has no NFKC and no filters;
// only the character class changes here.
function tokens(doc: RawDoc): Set<string> { return tokenSetForConsolidation(`${doc.content}\n${doc.concepts}\n${doc.sourceFile}`); }
function tagList(value: string): string[] { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } }
function tokenOverlap(left: Set<string>, right: Set<string>): number {
  const [smallest, largest] = left.size <= right.size ? [left, right] : [right, left];
  if (!smallest.size) return 0;
  let hits = 0;
  for (const token of smallest) if (largest.has(token)) hits += 1;
  return round(hits / smallest.size);
}
function modelFromReason(reason: string): string { return reason.match(/model=([^,)]+)/)?.[1] ?? 'unknown'; }
function round(value: number): number { return Number(value.toFixed(4)); }
