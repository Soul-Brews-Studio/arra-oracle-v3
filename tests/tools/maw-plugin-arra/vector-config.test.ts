import { afterEach, describe, expect, test } from 'bun:test';
import handler from '../../../tools/maw-plugin-arra/index.ts';

type Call = { url: string; init?: RequestInit; body?: unknown };

const originalFetch = globalThis.fetch;
const originalApi = process.env.ARRA_API;
const originalToken = process.env.ARRA_API_TOKEN;

const configPayload = {
  source: 'file',
  config: {
    collections: {
      'bge-m3': {
        collection: 'oracle_knowledge_bge_m3',
        adapter: 'lancedb',
        model: 'bge-m3',
        provider: 'ollama',
        primary: true,
      },
      nomic: {
        collection: 'oracle_knowledge_nomic',
        adapter: 'qdrant',
        model: 'nomic-embed-text',
        provider: 'remote',
      },
    },
  },
  collections: [
    { key: 'bge-m3', collection: 'oracle_knowledge_bge_m3', adapter: 'lancedb', model: 'bge-m3', count: 42, status: 'ok' },
    { key: 'nomic', collection: 'oracle_knowledge_nomic', adapter: 'qdrant', model: 'nomic-embed-text', count: 7, status: 'ok' },
  ],
};

function installFetch(response: unknown = configPayload): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      init,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return calls;
}

async function run(args: string[], response?: unknown) {
  process.env.ARRA_API = 'http://arra.test/';
  const calls = installFetch(response);
  const result = await handler({ args });
  return { result, calls };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApi === undefined) delete process.env.ARRA_API;
  else process.env.ARRA_API = originalApi;
  if (originalToken === undefined) delete process.env.ARRA_API_TOKEN;
  else process.env.ARRA_API_TOKEN = originalToken;
});

describe('tools maw arra vector-config command', () => {
  test('lists vector backend config collections as JSON', async () => {
    const { result, calls } = await run(['vector-config', 'list']);
    const body = JSON.parse(result.output ?? '');

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config');
    expect(calls[0].init?.method).toBeUndefined();
    expect(body).toMatchObject({
      source: 'file',
      collections: [
        { key: 'bge-m3', adapter: 'lancedb', count: 42 },
        { key: 'nomic', adapter: 'qdrant', count: 7 },
      ],
    });
  });

  test('gets one vector collection from the config response', async () => {
    const { result, calls } = await run(['vector-config', 'get', 'bge-m3']);
    const body = JSON.parse(result.output ?? '');

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config');
    expect(body).toMatchObject({
      key: 'bge-m3',
      collection: 'oracle_knowledge_bge_m3',
      adapter: 'lancedb',
      model: 'bge-m3',
      count: 42,
    });
  });

  test('sets one vector backend config field with JSON output', async () => {
    process.env.ARRA_API_TOKEN = 'secret';
    const response = { success: true, collection: 'bge-m3', config: { collections: { 'bge-m3': { adapter: 'turbovec' } } } };
    const { result, calls } = await run(['vector-config', 'set', 'bge-m3', 'adapter', 'turbovec', '--endpoint', 'http://turbo.test'], response);
    const body = JSON.parse(result.output ?? '');

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config/bge-m3');
    expect(calls[0].init?.method).toBe('PUT');
    expect(calls[0].init?.headers).toMatchObject({
      authorization: 'Bearer secret',
      'content-type': 'application/json',
    });
    expect(calls[0].body).toEqual({ adapter: 'turbovec', endpoint: 'http://turbo.test' });
    expect(body).toMatchObject({ success: true, collection: 'bge-m3' });
  });

  test('sets boolean fields and supports underscore alias', async () => {
    const { result, calls } = await run(['vector_config', 'set', 'nomic', 'enabled', 'false']);

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config/nomic');
    expect(calls[0].body).toEqual({ enabled: false });
  });

  test('switches all collection adapters through the config patch API', async () => {
    const { result, calls } = await run(['vector-config', 'switch', 'sqlite-vec', '--enabled', 'true']);

    expect(result.ok).toBe(true);
    expect(calls.map((call) => call.url)).toEqual([
      'http://arra.test/api/v1/vector/config',
      'http://arra.test/api/v1/vector/config',
    ]);
    expect(calls[1].init?.method).toBe('PATCH');
    expect(calls[1].body).toMatchObject({
      collections: {
        'bge-m3': { adapter: 'sqlite-vec', enabled: true },
        nomic: { adapter: 'sqlite-vec', enabled: true },
      },
    });
  });
});
