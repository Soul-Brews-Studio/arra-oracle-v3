import { Elysia, t } from 'elysia';
import pkg from '../../../package.json' with { type: 'json' };
import { REPO_ROOT } from '../../config.ts';
import { db, sqlite } from '../../db/index.ts';
import { chainSearch } from '../../tools/search.ts';
import type { ToolContext } from '../../tools/types.ts';
import { ensureVectorStoreConnected } from '../../vector/factory.ts';
import { parseOptionalSearchModel } from './model-key.ts';

const bodySchema = t.Object({
  query: t.String(),
  maxHops: t.Optional(t.Number({ minimum: 1, default: 3 })),
  breadth: t.Optional(t.Number({ minimum: 1, default: 5 })),
  model: t.Optional(t.String()),
});

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || REPO_ROOT;
}

async function createToolContext(model: string | undefined): Promise<ToolContext> {
  const vectorStore = await ensureVectorStoreConnected(model);
  return {
    db,
    sqlite,
    repoRoot: repoRoot(),
    vectorStore,
    vectorStatus: 'connected',
    version: pkg.version,
  };
}

export const chainSearchEndpoint = new Elysia().post(
  '/v1/search/chain',
  async ({ body, set }) => {
    const query = body.query.trim();
    if (!query) {
      set.status = 400;
      return { error: 'query is required' };
    }

    const parsedModel = parseOptionalSearchModel(body.model);
    if (!parsedModel.ok) {
      set.status = 400;
      return { error: parsedModel.error };
    }

    try {
      const maxHops = positiveInt(body.maxHops, 3);
      const breadth = positiveInt(body.breadth, 5);
      const ctx = await createToolContext(parsedModel.value);
      const result = await chainSearch(ctx, {
        seedQuery: query,
        maxHops,
        breadth,
        model: parsedModel.value,
      });

      return {
        query,
        maxHops,
        breadth,
        model: parsedModel.value,
        traceIds: result.traceIds,
        hops: result.hops,
        results: result.results,
      };
    } catch (error) {
      set.status = 500;
      return { error: error instanceof Error ? error.message : String(error) };
    }
  },
  { body: bodySchema },
);
