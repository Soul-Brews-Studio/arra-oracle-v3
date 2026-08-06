import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '../../types.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../../vector/types.ts';

const savedNodeEnv = process.env.NODE_ENV;
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-chain-search-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { chainSearch } = await import('../chain.ts');
const { getTrace } = await import('../../../trace/store.ts');

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function vectorResult(ids: string[], distances: number[]): VectorQueryResult {
  return {
    ids,
    distances,
    documents: ids.map((id) => `${id} document content`),
    metadatas: ids.map((id) => ({
      type: 'learning',
      source_file: `ψ/memory/learnings/${id}.md`,
      concepts: JSON.stringify(['chain', id]),
    })),
  };
}

function makeCtx(queryByIdCalls: string[]): ToolContext {
  const vectorStore: Partial<VectorStoreAdapter> = {
    name: 'mock-chain-vector',
    query: async (text: string, limit = 5) => {
      expect(text).toBe('seed query');
      expect(limit).toBe(3);
      return vectorResult(['seed', 'side'], [0.1, 0.2]);
    },
    queryById: async (id: string, limit = 5) => {
      queryByIdCalls.push(id);
      expect(limit).toBe(3);
      if (id === 'seed') return vectorResult(['seed', 'side', 'next'], [0, 0.2, 0.25]);
      if (id === 'next') return vectorResult(['seed', 'late'], [0.1, 1.5]);
      return vectorResult([], []);
    },
  };
  return {
    db: dbMod.db,
    sqlite: dbMod.sqlite,
    repoRoot: root,
    vectorStore: vectorStore as VectorStoreAdapter,
    vectorStatus: 'connected',
    version: 'test',
  };
}

afterAll(() => {
  dbMod.closeDb();
  restore('NODE_ENV', savedNodeEnv);
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('chainSearch', () => {
  test('walks vector neighbors with dedupe, score decay, and linked traces', async () => {
    const queryByIdCalls: string[] = [];
    const result = await chainSearch(makeCtx(queryByIdCalls), {
      seedQuery: 'seed query',
      breadth: 3,
      maxHops: 3,
      scoreDecay: 0.5,
      project: 'github.com/soul/arra',
      sessionId: 'chain-test-session',
    });

    expect(result.results.map((item) => item.id)).toEqual(['seed', 'side', 'next']);
    expect(new Set(result.results.map((item) => item.id)).size).toBe(3);
    expect(queryByIdCalls).toEqual(['seed', 'next']);
    expect(result.traceIds).toHaveLength(2);
    expect(result.hops.map((hop) => hop.resultIds)).toEqual([['seed', 'side'], ['next']]);
    expect(result.hops[1].stoppedReason).toBe('score_decay');

    const first = getTrace(result.traceIds[0]);
    const second = getTrace(result.traceIds[1]);
    expect(first?.nextTraceId).toBe(second?.traceId);
    expect(second?.prevTraceId).toBe(first?.traceId);
    expect(first?.foundFiles.map((file) => file.path)).toEqual([
      'ψ/memory/learnings/seed.md',
      'ψ/memory/learnings/side.md',
    ]);
    expect(second?.foundFiles[0].path).toBe('ψ/memory/learnings/next.md');
  });
});
