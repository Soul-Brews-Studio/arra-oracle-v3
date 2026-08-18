import { indexRetroFile } from '../indexer/retro-index.ts';
import type { OracleIndexRetroInput, ToolResponse } from './types.ts';

type IndexRetroResult = Awaited<ReturnType<typeof indexRetroFile>>;
export type IndexRetroFn = (repoRoot: string, filePath: string) => Promise<IndexRetroResult>;

export const indexRetroToolDef = {
  name: 'oracle_index_retro',
  description: 'Index one already-written retrospective under <repoRoot>/ψ/memory/retrospectives. This bounded write never runs a full reindex.',
  inputSchema: {
    type: 'object',
    properties: {
      repoRoot: {
        type: 'string',
        description: 'Absolute Oracle repository root that owns the retrospective tree',
      },
      filePath: {
        type: 'string',
        description: 'Absolute path to one markdown retrospective under the repository retrospective tree',
      },
    },
    required: ['repoRoot', 'filePath'],
    additionalProperties: false,
  },
};

function response(payload: unknown, isError = false): ToolResponse {
  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}

export async function handleIndexRetro(
  input: OracleIndexRetroInput,
  runIndex: IndexRetroFn = indexRetroFile,
): Promise<ToolResponse> {
  const repoRoot = typeof input?.repoRoot === 'string' ? input.repoRoot.trim() : '';
  const filePath = typeof input?.filePath === 'string' ? input.filePath.trim() : '';
  if (!repoRoot || !filePath) {
    return response({
      ok: false,
      error: 'oracle_index_retro requires non-empty repoRoot and filePath strings.',
      usage: "oracle_index_retro({ repoRoot: '/absolute/oracle/root', filePath: '/absolute/oracle/root/ψ/memory/retrospectives/YYYY-MM/DD/retro.md' })",
    }, true);
  }

  try {
    return response(await runIndex(repoRoot, filePath));
  } catch (error) {
    return response({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      repoRoot,
      filePath,
    }, true);
  }
}
