import { afterEach, describe, expect, test } from 'bun:test';
import handler from '../../../tools/maw-plugin-arra/index.ts';

type Call = { url: string; init?: RequestInit; body?: unknown };

const originalFetch = globalThis.fetch;
const originalApi = process.env.ARRA_API;

function installFetch(response: unknown = { success: true, collection: 'nomic' }): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify(response), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return calls;
}

async function run(args: string[], response?: unknown) {
  process.env.ARRA_API = 'http://arra.test/';
  const calls = installFetch(response);
  const result = await handler({ args });
  return { result, calls, body: result.output ? JSON.parse(result.output) as Record<string, unknown> : {} };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApi === undefined) delete process.env.ARRA_API;
  else process.env.ARRA_API = originalApi;
});

describe('maw arra vector-config ops commands', () => {
  test('adds a configured vector collection', async () => {
    const { result, calls, body } = await run([
      'vector-config', 'add', 'qwen3', '--model', 'qwen3-embedding', '--adapter', 'lancedb', '--collection', 'oracle_qwen3', '--primary',
    ], { success: true, collection: 'qwen3' });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config/qwen3');
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].body).toEqual({ model: 'qwen3-embedding', adapter: 'lancedb', collection: 'oracle_qwen3', primary: true });
    expect(body).toMatchObject({ success: true, collection: 'qwen3' });
  });

  test('removes a vector collection config', async () => {
    const { result, calls } = await run(['vector-config', 'remove', 'nomic'], { success: true, removed: 'nomic' });

    expect(result.ok).toBe(true);
    expect(calls[0].url).toBe('http://arra.test/api/v1/vector/config/nomic');
    expect(calls[0].init?.method).toBe('DELETE');
  });

  test('sets primary, tests, and reloads vector config', async () => {
    const primary = await run(['vector-config', 'set-primary', 'qwen3'], { success: true, collection: 'qwen3' });
    const testRes = await run(['vector-config', 'test', 'qwen3'], { success: true, key: 'qwen3' });
    const reload = await run(['vector-config', 'reload'], { success: true, reloaded: true });

    expect(primary.calls[0].url).toBe('http://arra.test/api/v1/vector/config/qwen3/primary');
    expect(primary.calls[0].init?.method).toBe('POST');
    expect(testRes.calls[0].url).toBe('http://arra.test/api/v1/vector/config/qwen3/test');
    expect(testRes.calls[0].init?.method).toBe('POST');
    expect(reload.calls[0].url).toBe('http://arra.test/api/v1/vector/config/reload');
    expect(reload.calls[0].init?.method).toBe('POST');
  });

  test('requires a model when adding a collection', async () => {
    const { result, calls } = await run(['vector-config', 'add', 'missing-model']);

    expect(result.ok).toBe(false);
    expect(result.error).toBe('add requires --model <model>');
    expect(calls).toEqual([]);
  });
});
