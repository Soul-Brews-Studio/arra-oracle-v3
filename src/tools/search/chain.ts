import type { VectorQueryResult } from '../../vector/types.ts';
import { linkTraces } from '../../trace/links.ts';
import { createTrace } from '../../trace/store.ts';
import type { FoundFile } from '../../trace/types.ts';
import type { ToolContext } from '../types.ts';
import { parseConceptsFromMetadata } from './helpers.ts';
import type { VectorResult } from './types.ts';
import { vectorSearch } from './vector.ts';

export type ChainSearchInput = {
  seedQuery: string;
  type?: string;
  breadth?: number;
  maxHops?: number;
  scoreDecay?: number;
  minScore?: number;
  model?: string;
  project?: string;
  sessionId?: string;
};

export type ChainSearchHop = {
  hop: number;
  query: string;
  sourceId: string | null;
  traceId: string;
  resultIds: string[];
  bestId: string | null;
  bestScore: number;
  stoppedReason?: 'max_hops' | 'no_results' | 'cycle_guard' | 'score_decay';
};

export type ChainSearchResult = {
  results: VectorResult[];
  traceIds: string[];
  hops: ChainSearchHop[];
};

const DEFAULT_BREADTH = 5;
const DEFAULT_MAX_HOPS = 3;
const DEFAULT_SCORE_DECAY = 0.5;

function clampLimit(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(value!)));
}

function rankScore(result: Pick<VectorResult, 'distance' | 'score'>): number {
  const raw = Number.isFinite(result.distance) ? result.distance : result.score;
  if (!Number.isFinite(raw)) return 0;
  if (raw >= 0 && raw <= 1) return 1 - raw;
  return 1 / (1 + Math.max(0, raw));
}

function traceType(type: string): FoundFile['type'] {
  if (type === 'learning' || type === 'retro' || type === 'resonance') return type;
  return 'other';
}

function foundFilesFor(results: VectorResult[], hop: number): FoundFile[] {
  return results.map((result) => ({
    path: result.source_file || result.id,
    type: traceType(result.type),
    matchReason: `chainSearch hop ${hop}: ${result.id}`,
    confidence: rankScore(result) >= 0.7 ? 'high' : rankScore(result) >= 0.4 ? 'medium' : 'low',
  }));
}

function mapQueryById(result: VectorQueryResult, model: string | undefined): VectorResult[] {
  const mapped: VectorResult[] = [];
  for (let i = 0; i < result.ids.length; i++) {
    const metadata = result.metadatas[i] as Record<string, unknown> | null;
    const distance = result.distances[i] ?? 0;
    mapped.push({
      id: result.ids[i],
      type: (metadata?.type as string) || 'unknown',
      content: (result.documents[i] || '').substring(0, 500),
      source_file: (metadata?.source_file as string) || '',
      concepts: parseConceptsFromMetadata(metadata?.concepts),
      score: distance,
      distance,
      model: model || 'bge-m3',
      source: 'vector',
    });
  }
  return mapped;
}

function uniqueUnvisited(results: VectorResult[], visited: Set<string>): VectorResult[] {
  const next: VectorResult[] = [];
  const seen = new Set<string>();
  for (const result of results) {
    if (!result.id || visited.has(result.id) || seen.has(result.id)) continue;
    seen.add(result.id);
    next.push(result);
  }
  return next;
}

function createHopTrace(input: {
  query: string;
  hopResults: VectorResult[];
  hop: number;
  project?: string;
  sessionId?: string;
}): string {
  return createTrace({
    query: input.query,
    queryType: 'pattern',
    foundFiles: foundFilesFor(input.hopResults, input.hop),
    scope: input.project ? 'project' : 'cross-project',
    project: input.project,
    sessionId: input.sessionId,
  }).traceId;
}

export async function chainSearch(ctx: ToolContext, input: ChainSearchInput): Promise<ChainSearchResult> {
  const seedQuery = input.seedQuery?.trim();
  if (!seedQuery) throw new Error('seedQuery is required');

  const breadth = clampLimit(input.breadth, DEFAULT_BREADTH);
  const maxHops = clampLimit(input.maxHops, DEFAULT_MAX_HOPS);
  const scoreDecay = Number.isFinite(input.scoreDecay) ? Math.max(0, input.scoreDecay!) : DEFAULT_SCORE_DECAY;
  const minScore = Number.isFinite(input.minScore) ? Math.max(0, input.minScore!) : 0;
  const type = input.type || 'all';
  const visited = new Set<string>();
  const results: VectorResult[] = [];
  const traceIds: string[] = [];
  const hops: ChainSearchHop[] = [];

  let query = seedQuery;
  let sourceId: string | null = null;
  let previousTraceId: string | null = null;
  let previousBestScore = Number.POSITIVE_INFINITY;

  for (let hop = 0; hop < maxHops; hop++) {
    const raw = hop === 0
      ? await vectorSearch(ctx, query, type, breadth, input.model)
      : mapQueryById(await ctx.vectorStore.queryById(sourceId!, breadth), input.model);
    const hopResults = uniqueUnvisited(raw, visited);
    const best = hopResults[0] ?? null;
    const bestScore = best ? rankScore(best) : 0;

    if (!best) {
      if (hops.length > 0) hops[hops.length - 1].stoppedReason = raw.length ? 'cycle_guard' : 'no_results';
      break;
    }
    if (hop > 0 && (bestScore < minScore || bestScore < previousBestScore * scoreDecay)) {
      if (hops.length > 0) hops[hops.length - 1].stoppedReason = 'score_decay';
      break;
    }

    for (const result of hopResults) visited.add(result.id);
    results.push(...hopResults);
    const traceId = createHopTrace({ query, hopResults, hop, project: input.project, sessionId: input.sessionId });
    if (previousTraceId) {
      const linked = linkTraces(previousTraceId, traceId);
      if (!linked.success) {
        hops[hops.length - 1].stoppedReason = 'cycle_guard';
        break;
      }
    }
    traceIds.push(traceId);
    hops.push({
      hop,
      query,
      sourceId,
      traceId,
      resultIds: hopResults.map((result) => result.id),
      bestId: best.id,
      bestScore,
      stoppedReason: hop === maxHops - 1 ? 'max_hops' : undefined,
    });

    previousTraceId = traceId;
    previousBestScore = bestScore;
    sourceId = best.id;
    query = best.id;
  }

  return { results, traceIds, hops };
}
