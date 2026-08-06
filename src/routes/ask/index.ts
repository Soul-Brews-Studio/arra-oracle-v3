import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { currentTenantId } from '../../middleware/tenant.ts';
import { augmentQueryWithAcronyms } from '../../search/acronyms.ts';
import { filterResultsAsOf, parseAsOf } from '../../search/bitemporal.ts';
import { rerankByEntityLinks } from '../../search/entity-ranking.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import { handleSearch } from '../../server/handlers.ts';
import { asOfResponse } from '../search/asof.ts';
import { parseOptionalSearchModel } from '../search/model-key.ts';
import { handleTenantSearch } from '../search/tenant-search.ts';
import { AskBody } from './model.ts';
import {
  citationsFrom,
  envAskClient,
  rankAskResults,
  sourcesFrom,
  synthesize,
  warningsFrom,
  type AskClient,
} from './synthesis.ts';

type AskDeps = { client?: AskClient; now?: () => Date };
export type AskInput = {
  q?: string;
  question?: string;
  type?: string;
  limit?: number;
  project?: string;
  cwd?: string;
  model?: string;
  asOf?: string;
  llm?: boolean;
};
export type AskResult = { status: number; body: Record<string, unknown> };

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function limitOf(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 8;
  return Math.max(1, Math.min(20, Math.floor(value as number)));
}

export function createAskRoutes(deps: AskDeps = {}) {
  return new Elysia({ prefix: '/api' }).post('/ask', async ({ body, set }) => {
    const result = await answerOracleAsk(body, deps);
    if (result.status >= 400) set.status = result.status;
    return result.body;
  }, {
    body: AskBody,
    detail: { tags: ['ask'], menu: { group: 'main', path: '/ask', order: 12 }, summary: 'Ask the oracle with cited synthesis over hybrid/vector search' },
  });
}

export const askRoutes = createAskRoutes();

export async function answerOracleAsk(body: AskInput, deps: AskDeps = {}): Promise<AskResult> {
  const q = sanitize(body.question ?? body.q ?? '');
  if (!q) return { status: 400, body: { error: 'Invalid query: empty after sanitization' } };

  const limit = limitOf(body.limit);
  const parsedModel = parseOptionalSearchModel(body.model);
  if (!parsedModel.ok) return { status: 400, body: { error: parsedModel.error } };
  const asOf = parseAsOf(body.asOf);
  if (!asOf.ok) return { status: 400, body: { error: asOf.error } };
  const augmentedQ = augmentQueryWithAcronyms(q);
  const tenantResult = handleTenantSearch(augmentedQ, body.type ?? 'all', limit, 0, asOf.value);
  const result = tenantResult
    ?? await handleSearch(augmentedQ, body.type ?? 'all', limit, 0, 'hybrid', body.project, body.cwd, parsedModel.value);
  if (asOf.value && !tenantResult) {
    result.results = filterResultsAsOf(
      sqlite,
      result.results as unknown as Array<Record<string, unknown>>,
      asOf.value,
    ) as unknown as typeof result.results;
    result.total = result.results.length;
  }
  result.results = rerankByEntityLinks(sqlite, result.results, augmentedQ, currentTenantId()) as typeof result.results;
  attachSupersedeStatus(sqlite, result.results as unknown as Array<Record<string, unknown>>);
  const sources = sourcesFrom(rankAskResults(result.results), limit);
  const client = body.llm === false ? undefined : deps.client ?? envAskClient();
  const synthesis = await synthesize(q, sources, client);
  return {
    status: 200,
    body: {
      query: q,
      answer: synthesis.answer,
      citations: citationsFrom(synthesis.citations, sources),
      citationIndexes: synthesis.citations,
      warnings: warningsFrom(sources, result.warning, synthesis.noEvidence),
      noEvidence: synthesis.noEvidence,
      mode: synthesis.mode,
      generatedAt: deps.now?.().toISOString() ?? new Date().toISOString(),
      ...asOfResponse(asOf.value),
      search: { total: result.total, limit, vectorAvailable: result.vectorAvailable, warning: result.warning },
      sources,
    },
  };
}
