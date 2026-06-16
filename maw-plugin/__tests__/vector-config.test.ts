import { describe, expect, test } from 'bun:test';
import { runArra } from '../index.ts';

type Call = { path: string; init?: RequestInit };

const config = {
  source: 'file',
  config: { collections: {
    'bge-m3': { collection: 'oracle_knowledge_bge_m3', adapter: 'lancedb', model: 'bge-m3', primary: true },
    nomic: { collection: 'oracle_knowledge_nomic', adapter: 'lancedb', model: 'nomic-embed-text' },
  } },
  collections: [
    { key: 'bge-m3', collection: 'oracle_knowledge_bge_m3', adapter: 'lancedb', model: 'bge-m3', count: 42, status: 'ok' },
    { key: 'nomic', collection: 'oracle_knowledge_nomic', adapter: 'lancedb', model: 'nomic-embed-text', count: 7, status: 'down' },
  ],
  doc_counts: { 'bge-m3': 42, nomic: 7 },
};

async function vectorConfig(args: string[]) {
  const calls: Call[] = [];
  const result = await runArra(args, async (path, init) => {
    calls.push({ path, init });
    return { success: true, collection: 'bge-m3', removed: 'old-model', path: '/tmp/vector-server.json', ...config };
  });
  return { result, calls };
}

async function body(call: Call) {
  return call.init?.body ? JSON.parse(String(call.init.body)) : undefined;
}

describe('maw arra vector-config', () => {
  test('reads config and prints a compact table', async () => {
    const { result, calls } = await vectorConfig(['vector-config']);

    expect(result.ok).toBe(true);
    expect(calls.map(call => [call.init?.method, call.path])).toEqual([['GET', '/api/v1/vector/config']]);
    expect(result.output).toContain('Collection | Adapter | Model | Enabled | Docs | Status');
    expect(result.output).toContain('oracle_knowledge_bge_m3 | lancedb | bge-m3 | true | 42 | ok');
    expect(result.output).toContain('oracle_knowledge_nomic | lancedb | nomic-embed-text | true | 7 | down');
  });

  test('prints raw config payload with --json', async () => {
    const { result } = await vectorConfig(['vector-config', '--json']);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.output ?? '').config.collections['bge-m3'].model).toBe('bge-m3');
  });

  test('writes set, add, primary, reload, test, and remove operations', async () => {
    let out = await vectorConfig(['vector-config', 'set', 'bge-m3', 'adapter', 'qdrant', '--url', 'http://localhost:6333']);
    expect(out.calls[0].path).toBe('/api/v1/vector/config/bge-m3');
    expect(out.calls[0].init?.method).toBe('PUT');
    expect(await body(out.calls[0])).toEqual({ adapter: 'qdrant', endpoint: 'http://localhost:6333' });

    out = await vectorConfig(['vector-config', 'set', 'bge-m3', 'enabled', 'false']);
    expect(await body(out.calls[0])).toEqual({ enabled: false });

    out = await vectorConfig(['vector-config', 'add', 'qwen4', '--model', 'qwen4-embedding', '--adapter', 'lancedb']);
    expect(out.calls[0].path).toBe('/api/v1/vector/config/qwen4');
    expect(out.calls[0].init?.method).toBe('POST');
    expect(await body(out.calls[0])).toEqual({ adapter: 'lancedb', model: 'qwen4-embedding' });

    out = await vectorConfig(['vector-config', 'set-primary', 'qwen4']);
    expect(out.calls[0].path).toBe('/api/v1/vector/config/qwen4/primary');

    out = await vectorConfig(['vector-config', 'reload']);
    expect(out.calls[0].path).toBe('/api/v1/vector/config/reload');

    out = await vectorConfig(['vector-config', 'test', 'qwen4']);
    expect(out.calls[0].path).toBe('/api/v1/vector/config/qwen4/test');

    out = await vectorConfig(['vector-config', 'remove', 'old-model', '--yes']);
    expect(out.calls[0].init?.method).toBe('DELETE');
    expect(out.calls[0].path).toBe('/api/v1/vector/config/old-model');
  });

  test('remove requires --yes', async () => {
    const { result, calls } = await vectorConfig(['vector-config', 'remove', 'old-model']);

    expect(result).toEqual({ ok: false, error: 'remove requires --yes' });
    expect(calls).toEqual([]);
  });
});
