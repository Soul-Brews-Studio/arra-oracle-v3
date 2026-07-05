import type { Database } from 'bun:sqlite';
import { runWithTenant } from '../middleware/tenant.ts';
import { runSupersede } from '../tools/supersede.ts';
import type { ToolContext } from '../tools/types.ts';

type Db = ToolContext['db'];
type Logger = Pick<Console, 'log' | 'warn'>;
type Action = 'ADD' | 'UPDATE' | 'NOOP';
type FactDoc = {
  id: string; tenantId: string; type: string; sourceFile: string; updatedAt: number;
  content: string; tokens: string[]; tokenSet: Set<string>; contentSet: Set<string>;
};
type Similar = { doc: FactDoc; similarity: number; overlap: number };
type Resolved = {
  dryRun: boolean; limit: number; topK: number; minSimilarity: number; minOverlap: number;
  minNoveltyTokens: number; tenantId?: string; logger: Logger;
};

export type FactCurationOptions = {
  dryRun?: boolean; limit?: number; topK?: number; minSimilarity?: number; minOverlap?: number;
  minNoveltyTokens?: number; tenantId?: string; logger?: Logger;
};
export type FactCurationDecision = {
  action: Action; targetId: string; tenantId: string; similarIds: string[];
  similarity: number; overlap: number; reason: string;
  supersede?: { oldId: string; newId: string };
};
export type FactCurationResult = {
  enabled: true; scanned: number; decisions: FactCurationDecision[];
  planned: number; applied: number; skipped: number; deleted: 0;
};

const DEFAULTS = { dryRun: true, limit: 120, topK: 5, minSimilarity: 0.55, minOverlap: 0.35, minNoveltyTokens: 4 };
const MAX_LIMIT = 500;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'use', 'uses']);

function clamp(value: number, min = 0, max = 1): number { return Math.min(max, Math.max(min, value)); }
function finite(value: unknown, fallback: number): number { return typeof value === 'number' && Number.isFinite(value) ? value : fallback; }
function round(value: number): number { return Number(value.toFixed(4)); }

function resolve(input: FactCurationOptions): Resolved {
  const tenantId = typeof input.tenantId === 'string' ? input.tenantId.trim() : undefined;
  return {
    dryRun: input.dryRun ?? DEFAULTS.dryRun,
    limit: Math.max(0, Math.min(MAX_LIMIT, Math.floor(finite(input.limit, DEFAULTS.limit)))),
    topK: Math.max(1, Math.min(20, Math.floor(finite(input.topK, DEFAULTS.topK)))),
    minSimilarity: clamp(finite(input.minSimilarity, DEFAULTS.minSimilarity)),
    minOverlap: clamp(finite(input.minOverlap, DEFAULTS.minOverlap)),
    minNoveltyTokens: Math.max(0, Math.floor(finite(input.minNoveltyTokens, DEFAULTS.minNoveltyTokens))),
    logger: input.logger ?? console,
    ...(tenantId ? { tenantId } : {}),
  };
}

function tokenize(text: string): string[] {
  return (text.toLowerCase().normalize('NFKC').match(/[a-z0-9_:-]+/g) ?? [])
    .filter((token) => token.length > 2 && !STOP.has(token));
}

function cosine(left: string[], right: string[]): number {
  if (!left.length || !right.length) return 0;
  const counts = new Map<string, number>();
  for (const token of left) counts.set(token, (counts.get(token) ?? 0) + 1);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of counts.values()) leftNorm += value * value;
  const rightCounts = new Map<string, number>();
  for (const token of right) rightCounts.set(token, (rightCounts.get(token) ?? 0) + 1);
  for (const [token, value] of rightCounts) {
    rightNorm += value * value;
    dot += (counts.get(token) ?? 0) * value;
  }
  return round(dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)));
}

function overlap(left: Set<string>, right: Set<string>): number {
  const smallest = left.size <= right.size ? left : right;
  const largest = left.size <= right.size ? right : left;
  if (!smallest.size) return 0;
  let hits = 0;
  for (const token of smallest) if (largest.has(token)) hits += 1;
  return round(hits / smallest.size);
}

function loadDocs(sqlite: Database, options: Resolved): FactDoc[] {
  const tenant = options.tenantId ? 'AND d.tenant_id = ?' : '';
  const params = options.tenantId ? [options.tenantId, options.limit] : [options.limit];
  const rows = sqlite.prepare(`
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile,
      d.updated_at AS updatedAt, coalesce(f.content, '') AS content, d.concepts
    FROM oracle_documents d
    LEFT JOIN oracle_fts f ON f.id = d.id
    WHERE d.superseded_by IS NULL ${tenant}
    ORDER BY d.updated_at DESC
    LIMIT ?
  `).all(...params) as Array<Omit<FactDoc, 'tokens' | 'tokenSet' | 'contentSet'> & { concepts: string }>;
  return rows.map((row) => {
    const contentTokens = tokenize(row.content ?? '');
    const tokens = tokenize(`${row.content}\n${row.concepts}\n${row.sourceFile}`);
    return { ...row, content: row.content ?? '', tokens, tokenSet: new Set(tokens), contentSet: new Set(contentTokens) };
  });
}

function topSimilar(target: FactDoc, docs: FactDoc[], blocked: Set<string>, options: Resolved): Similar[] {
  return docs
    .filter((doc) => doc.id !== target.id && !blocked.has(doc.id) && doc.tenantId === target.tenantId && doc.type === target.type)
    .map((doc) => ({ doc, similarity: cosine(target.tokens, doc.tokens), overlap: overlap(target.tokenSet, doc.tokenSet) }))
    .filter((item) => item.similarity >= options.minSimilarity && item.overlap >= options.minOverlap)
    .sort((a, b) => (b.similarity - a.similarity) || (b.overlap - a.overlap) || (b.doc.updatedAt - a.doc.updatedAt))
    .slice(0, options.topK);
}

function novelty(target: FactDoc, existing: FactDoc): number {
  let count = 0;
  for (const token of target.contentSet) if (!existing.contentSet.has(token)) count += 1;
  return count;
}

function classify(target: FactDoc, similar: Similar[], options: Resolved): FactCurationDecision {
  if (!similar.length) {
    return { action: 'ADD', targetId: target.id, tenantId: target.tenantId, similarIds: [], similarity: 0, overlap: 0, reason: 'no similar active facts above threshold' };
  }
  const best = similar[0];
  const newTokens = novelty(target, best.doc);
  const targetIsNewer = target.updatedAt >= best.doc.updatedAt;
  if (targetIsNewer && newTokens >= options.minNoveltyTokens) {
    return {
      action: 'UPDATE', targetId: target.id, tenantId: target.tenantId,
      similarIds: similar.map((item) => item.doc.id), similarity: best.similarity, overlap: best.overlap,
      supersede: { oldId: best.doc.id, newId: target.id },
      reason: `active fact-curation UPDATE against top-${options.topK} similar (novel_tokens=${newTokens})`,
    };
  }
  return {
    action: 'NOOP', targetId: target.id, tenantId: target.tenantId,
    similarIds: similar.map((item) => item.doc.id), similarity: best.similarity, overlap: best.overlap,
    supersede: { oldId: target.id, newId: best.doc.id },
    reason: `active fact-curation NOOP against top-${options.topK} similar (novel_tokens=${newTokens})`,
  };
}

function planDecisions(docs: FactDoc[], options: Resolved): FactCurationDecision[] {
  const blocked = new Set<string>();
  const decisions: FactCurationDecision[] = [];
  for (const target of docs) {
    if (blocked.has(target.id)) continue;
    const decision = classify(target, topSimilar(target, docs, blocked, options), options);
    decisions.push(decision);
    if (decision.supersede) {
      blocked.add(decision.supersede.oldId);
      blocked.add(decision.supersede.newId);
    }
  }
  return decisions;
}

export async function runFactCuration(
  db: Db,
  sqlite: Database,
  input: FactCurationOptions = {},
): Promise<FactCurationResult> {
  const options = resolve(input);
  const docs = loadDocs(sqlite, options);
  const decisions = planDecisions(docs, options);
  const planned = decisions.filter((decision) => decision.supersede);
  let applied = 0;
  for (const decision of planned) {
    const edge = decision.supersede;
    if (!edge) continue;
    if (options.dryRun) {
      options.logger.log(`[fact-curation:dry-run] ${decision.action} ${edge.oldId} -> ${edge.newId}`);
      continue;
    }
    try {
      const result = runWithTenant(decision.tenantId, () => runSupersede(db, {
        oldId: edge.oldId,
        newId: edge.newId,
        reason: decision.reason,
      }));
      if (result.isError) options.logger.warn(`[fact-curation] skipped ${edge.oldId}: ${JSON.stringify(result.payload)}`);
      else applied += 1;
    } catch (error) {
      options.logger.warn(`[fact-curation] skipped ${edge.oldId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { enabled: true, scanned: docs.length, decisions, planned: planned.length, applied, skipped: planned.length - applied, deleted: 0 };
}
