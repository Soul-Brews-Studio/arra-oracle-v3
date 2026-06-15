import { describe, expect, test } from 'bun:test';
import { runArra } from '../index.ts';

type Call = { path: string; init?: RequestInit };

const models = {
  models: {
    'bge-m3': {
      collection: 'oracle_knowledge_bge_m3',
      adapter: 'lancedb',
      model: 'bge-m3',
      count: 42,
    },
    nomic: {
      collection: 'oracle_knowledge_nomic',
      adapter: 'lancedb',
      model: 'nomic-embed-text',
      count: 7,
    },
  },
};

const health = {
  status: 'degraded',
  checked_at: '2026-06-16T00:00:00.000Z',
  engines: [
    { key: 'bge-m3', collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', ok: true },
    { key: 'nomic', collection: 'oracle_knowledge_nomic', model: 'nomic-embed-text', ok: false },
  ],
};

async function vectorConfig(args: string[]) {
  const calls: Call[] = [];
  const result = await runArra(args, async (path, init) => {
    calls.push({ path, init });
    return path === '/api/vector/index/models' ? models : health;
  });
  return { result, calls };
}

describe('maw arra vector-config', () => {
  test('fetches models and health then prints a compact table', async () => {
    const { result, calls } = await vectorConfig(['vector-config']);

    expect(result.ok).toBe(true);
    expect(calls.map(call => [call.init?.method, call.path])).toEqual([
      ['GET', '/api/vector/index/models'],
      ['GET', '/api/vector/health'],
    ]);
    expect(result.output).toContain('Collection | Adapter | Model | Docs | Status');
    expect(result.output).toContain('oracle_knowledge_bge_m3 | lancedb | bge-m3 | 42 | ok');
    expect(result.output).toContain('oracle_knowledge_nomic | lancedb | nomic-embed-text | 7 | down');
  });

  test('prints raw endpoint payloads with --json', async () => {
    const { result } = await vectorConfig(['vector-config', '--json']);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output ?? '')).toEqual({ models, health });
  });
});
