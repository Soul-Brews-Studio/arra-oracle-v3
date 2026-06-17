import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { attachSupersedeStatus } from '../../search/supersede-status.ts';
import { handleSearch } from '../../server/handlers.ts';
import { AskBody } from './model.ts';
import { envAskClient, sourcesFrom, synthesize, type AskClient } from './synthesis.ts';

type AskDeps = { client?: AskClient; now?: () => Date };

function sanitize(q: string): string {
  return q.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

function limitOf(value: number | undefined): number {
  if (!Number.isFinite(value ?? NaN)) return 8;
  return Math.max(1, Math.min(20, Math.floor(value as number)));
}

export function createAskRoutes(deps: AskDeps = {}) {
  return new Elysia({ prefix: '/api' }).post('/ask', async ({ body, set }) => {
    const q = sanitize(body.q ?? '');
    if (!q) {
      set.status = 400;
      return { error: 'Invalid query: empty after sanitization' };
    }

    const limit = limitOf(body.limit);
    const result = await handleSearch(q, body.type ?? 'all', limit, 0, 'hybrid', body.project, body.cwd, body.model);
    attachSupersedeStatus(sqlite, result.results as unknown as Array<Record<string, unknown>>);
    const sources = sourcesFrom(result.results, limit);
    const client = body.llm === false ? undefined : deps.client ?? envAskClient();
    const synthesis = await synthesize(q, sources, client);
    return {
      query: q,
      answer: synthesis.answer,
      citations: synthesis.citations,
      noEvidence: synthesis.noEvidence,
      mode: synthesis.mode,
      generatedAt: deps.now?.().toISOString() ?? new Date().toISOString(),
      search: { total: result.total, limit, vectorAvailable: result.vectorAvailable, warning: result.warning },
      sources,
    };
  }, {
    body: AskBody,
    detail: { tags: ['ask'], menu: { group: 'main', path: '/ask', order: 12 }, summary: 'Ask the oracle with cited synthesis over hybrid search' },
  });
}

export const askRoutes = createAskRoutes();
