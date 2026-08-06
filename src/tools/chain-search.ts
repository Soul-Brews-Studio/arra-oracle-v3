import { ensureVectorStoreConnected } from '../vector/factory.ts';
import { chainSearch, type ChainSearchInput, type ChainSearchResult } from './search/chain.ts';
import type { ToolContext, ToolResponse } from './types.ts';

export type OracleSearchChainInput = {
  query: string;
  maxHops?: number;
  breadth?: number;
  model?: string;
};

export const chainSearchToolDef = {
  name: 'oracle_search_chain',
  description:
    'Run iterative vector search over linked results, expanding from the best hit on each hop.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Seed query to start the chained search.',
      },
      maxHops: {
        type: 'number',
        default: 3,
        minimum: 1,
        description: 'Maximum number of chain hops to follow.',
      },
      breadth: {
        type: 'number',
        default: 5,
        minimum: 1,
        description: 'Number of nearest neighbors to consider per hop.',
      },
      model: {
        type: 'string',
        description: 'Optional embedding model key to search with.',
      },
    },
    required: ['query'],
  },
};

function positiveInt(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.floor(value));
}

function toChainInput(input: OracleSearchChainInput): ChainSearchInput {
  return {
    seedQuery: input.query.trim(),
    maxHops: positiveInt(input.maxHops, 3),
    breadth: positiveInt(input.breadth, 5),
    model: input.model?.trim() || undefined,
  };
}

function payload(input: ChainSearchInput, result: ChainSearchResult) {
  return {
    query: input.seedQuery,
    maxHops: input.maxHops,
    breadth: input.breadth,
    model: input.model,
    traceIds: result.traceIds,
    hops: result.hops,
    results: result.results,
  };
}

export async function handleChainSearch(
  ctx: ToolContext,
  input: OracleSearchChainInput,
): Promise<ToolResponse> {
  if (!input?.query?.trim()) {
    return {
      isError: true,
      content: [{ type: 'text', text: JSON.stringify({ error: 'query is required' }, null, 2) }],
    };
  }

  const chainInput = toChainInput(input);

  try {
    const searchCtx = chainInput.model
      ? { ...ctx, vectorStore: await ensureVectorStoreConnected(chainInput.model) }
      : ctx;
    const result = await chainSearch(searchCtx, chainInput);
    return {
      content: [{ type: 'text', text: JSON.stringify(payload(chainInput, result), null, 2) }],
    };
  } catch (error) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify(
            { error: error instanceof Error ? error.message : String(error) },
            null,
            2,
          ),
        },
      ],
    };
  }
}
