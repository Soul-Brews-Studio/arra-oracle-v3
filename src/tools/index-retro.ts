import fs from 'fs';
import path from 'path';
import { indexRetroFile } from '../indexer/retro-index.ts';
import { ORACLE_DATA_DIR } from '../config.ts';
import type { OracleIndexRetroInput, ToolResponse } from './types.ts';

/**
 * TINE decision 2026-08-19: the MCP data dir (~/.arra-oracle-v2) is Oracle's
 * internal store, not a fleet memory tree — a retro written there is invisible
 * to the next session's filesystem recap. Reject it so /rrr fails closed and
 * re-resolves the canonical project root instead.
 */
function isDataDirRoot(repoRoot: string): boolean {
  try {
    return fs.realpathSync(path.resolve(repoRoot)) === fs.realpathSync(ORACLE_DATA_DIR);
  } catch {
    return false;
  }
}

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

  if (isDataDirRoot(repoRoot)) {
    return response({
      ok: false,
      error: `repoRoot resolves to the Oracle data dir (${ORACLE_DATA_DIR}) — an internal store, not a fleet memory tree. Write the retrospective under the canonical project root's ψ/memory/retrospectives and pass that root.`,
      repoRoot,
      filePath,
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
