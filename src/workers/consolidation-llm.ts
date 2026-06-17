import type { Database } from 'bun:sqlite';
import { runWithTenant } from '../middleware/tenant.ts';
import { runSupersede } from '../tools/supersede.ts';
import type { ToolContext } from '../tools/types.ts';
import {
  runConsolidationWorker,
  type ConsolidationOptions,
  type ConsolidationPlan,
  type ConsolidationResult,
} from './consolidation.ts';

type Db = ToolContext['db'];
type LlmDoc = { id: string; tenantId: string; type: string; sourceFile: string; updatedAt: number; content: string };
type Pair = { left: LlmDoc; right: LlmDoc; sharedTokens: number };
export type LlmSupersedeCall = { action: 'SUPERSEDE'; oldId: string; newId: string; reason: string; tenantId: string };
export type LlmPrompt = { instruction: string; pair: Pair };
export type LlmClient = (prompt: LlmPrompt) => Promise<unknown>;
export type LlmLayerOptions = {
  enabled?: boolean; client?: LlmClient; limit?: number; maxPairs?: number; minSharedTokens?: number;
};
export type LlmConsolidationOptions = ConsolidationOptions & { llm?: LlmLayerOptions };
export type LlmConsolidationResult = ConsolidationResult & {
  llm: { enabled: boolean; pairs: number; planned: number; applied: number; skipped: number; calls: LlmSupersedeCall[] };
};

const DEFAULT_LLM = { limit: 80, maxPairs: 20, minSharedTokens: 3 };
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was']);

function llmEnabled(input: LlmConsolidationOptions): boolean {
  return input.llm?.enabled ?? ['1', 'true', 'yes'].includes(String(process.env.ORACLE_CONSOLIDATION_LLM ?? '').toLowerCase());
}

function envClient(): LlmClient | null {
  const url = process.env.ORACLE_CONSOLIDATION_LLM_URL?.trim();
  if (!url) return null;
  return async (prompt) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(prompt),
    });
    if (!response.ok) throw new Error(`LLM consolidation endpoint failed (${response.status})`);
    return response.text();
  };
}

function stripLlm(input: LlmConsolidationOptions): ConsolidationOptions {
  const { llm: _llm, ...base } = input;
  return base;
}

function tokens(value: string): Set<string> {
  return new Set((value.toLowerCase().normalize('NFKC').match(/[a-z0-9_:-]+/g) ?? [])
    .filter((token) => token.length > 2 && !STOP.has(token)));
}

function shared(left: LlmDoc, right: LlmDoc): number {
  const leftTokens = tokens(`${left.content}\n${left.sourceFile}`);
  const rightTokens = tokens(`${right.content}\n${right.sourceFile}`);
  let count = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) count += 1;
  return count;
}

function loadDocs(sqlite: Database, limit: number, tenantId?: string): LlmDoc[] {
  const tenant = tenantId ? 'AND d.tenant_id = ?' : '';
  const params = tenantId ? [tenantId, limit] : [limit];
  return sqlite.prepare(`
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile,
      d.updated_at AS updatedAt, coalesce(f.content, '') AS content
    FROM oracle_documents d
    LEFT JOIN oracle_fts f ON f.id = d.id
    WHERE d.superseded_by IS NULL ${tenant}
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(...params) as LlmDoc[];
}

function candidatePairs(docs: LlmDoc[], minSharedTokens: number, maxPairs: number): Pair[] {
  const pairs: Pair[] = [];
  for (let i = 0; i < docs.length; i += 1) {
    for (let j = i + 1; j < docs.length; j += 1) {
      const left = docs[i];
      const right = docs[j];
      if (left.tenantId !== right.tenantId || left.type !== right.type) continue;
      const sharedTokens = shared(left, right);
      if (sharedTokens < minSharedTokens) continue;
      pairs.push({ left, right, sharedTokens });
      if (pairs.length >= maxPairs) return pairs;
    }
  }
  return pairs;
}

function promptFor(pair: Pair): LlmPrompt {
  return {
    instruction: [
      'Decide whether these two memories contradict and one should supersede the other.',
      'Return JSON only: {"calls":[{"action":"SUPERSEDE","oldId":"...","newId":"...","reason":"..."}]}.',
      'Return {"calls":[]} when unsure. Never emit DELETE/UPDATE; supersede is reversible.',
    ].join(' '),
    pair,
  };
}

function jsonish(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  const fenced = raw.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1] ?? raw.trim();
  const start = Math.min(...['{', '['].map((char) => {
    const index = fenced.indexOf(char);
    return index === -1 ? Number.POSITIVE_INFINITY : index;
  }));
  if (!Number.isFinite(start)) return null;
  const text = fenced.slice(start);
  try { return JSON.parse(text); } catch { return null; }
}

function callItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const record = payload as Record<string, unknown>;
  if (Array.isArray(record.calls)) return record.calls;
  if (Array.isArray(record.tool_calls)) return record.tool_calls;
  return [record];
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeCall(item: unknown, pair: Pair): LlmSupersedeCall | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  const args = (record.arguments && typeof record.arguments === 'object')
    ? record.arguments as Record<string, unknown>
    : record;
  const action = text(args.action) ?? text(record.action) ?? text(record.name);
  if (action?.toUpperCase() !== 'SUPERSEDE') return null;
  const oldId = text(args.oldId) ?? text(args.old_id);
  const newId = text(args.newId) ?? text(args.new_id);
  const validIds = new Set([pair.left.id, pair.right.id]);
  if (!oldId || !newId || oldId === newId || !validIds.has(oldId) || !validIds.has(newId)) return null;
  return {
    action: 'SUPERSEDE',
    oldId,
    newId,
    tenantId: pair.left.tenantId,
    reason: text(args.reason) ?? 'LLM contradiction consolidation',
  };
}

export function extractSupersedeCalls(raw: unknown, pair: Pair): LlmSupersedeCall[] {
  return callItems(jsonish(raw))
    .map((item) => normalizeCall(item, pair))
    .filter((call): call is LlmSupersedeCall => Boolean(call));
}

function asPlan(call: LlmSupersedeCall): ConsolidationPlan {
  return {
    oldId: call.oldId,
    newId: call.newId,
    tenantId: call.tenantId,
    cosine: 0,
    ftsOverlap: 0,
    oldConfidence: 0,
    newConfidence: 0,
    reason: `LLM contradiction consolidation: ${call.reason}`,
  };
}

async function collectCalls(
  client: LlmClient,
  pairs: Pair[],
  blockedOldIds: Set<string>,
  logger: Pick<Console, 'warn'>,
): Promise<LlmSupersedeCall[]> {
  const calls: LlmSupersedeCall[] = [];
  const seen = new Set<string>();
  for (const pair of pairs) {
    let raw: unknown;
    try { raw = await client(promptFor(pair)); } catch (error) {
      logger.warn(`[consolidation:llm] skipped pair ${pair.left.id}/${pair.right.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const call of extractSupersedeCalls(raw, pair)) {
      const key = `${call.oldId}->${call.newId}`;
      if (blockedOldIds.has(call.oldId) || seen.has(key)) continue;
      seen.add(key);
      calls.push(call);
    }
  }
  return calls;
}

export async function runLlmConsolidationWorker(
  db: Db,
  sqlite: Database,
  input: LlmConsolidationOptions = {},
): Promise<LlmConsolidationResult> {
  const logger = input.logger ?? console;
  const base = await runConsolidationWorker(db, sqlite, stripLlm(input));
  if (!llmEnabled(input)) {
    return { ...base, llm: { enabled: false, pairs: 0, planned: 0, applied: 0, skipped: 0, calls: [] } };
  }
  const client = input.llm?.client ?? envClient();
  if (!client) {
    logger.warn('[consolidation:llm] enabled but no client or ORACLE_CONSOLIDATION_LLM_URL configured');
    return { ...base, llm: { enabled: true, pairs: 0, planned: 0, applied: 0, skipped: 0, calls: [] } };
  }

  const settings = { ...DEFAULT_LLM, ...input.llm };
  const docs = loadDocs(sqlite, settings.limit, input.tenantId);
  const pairs = candidatePairs(docs, settings.minSharedTokens, settings.maxPairs);
  const calls = await collectCalls(client, pairs, new Set(base.plans.map((plan) => plan.oldId)), logger);
  let applied = 0;
  for (const call of calls) {
    if (input.dryRun ?? true) continue;
    const result = runWithTenant(call.tenantId, () => runSupersede(db, {
      oldId: call.oldId,
      newId: call.newId,
      reason: `LLM contradiction consolidation: ${call.reason}`,
    }));
    if (result.isError) logger.warn(`[consolidation:llm] skipped ${call.oldId}: ${JSON.stringify(result.payload)}`);
    else applied += 1;
  }
  const plans = calls.map(asPlan);
  const skipped = calls.length - applied;
  return {
    ...base,
    planned: base.planned + plans.length,
    applied: base.applied + applied,
    skipped: base.skipped + skipped,
    plans: [...base.plans, ...plans],
    llm: { enabled: true, pairs: pairs.length, planned: calls.length, applied, skipped, calls },
  };
}
