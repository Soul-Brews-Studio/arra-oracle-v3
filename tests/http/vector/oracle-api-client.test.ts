import { afterEach, expect, test } from 'bun:test';
import {
  getVectorProviders,
  getVectorServices,
  registerVectorService,
  testVectorProvider,
  testVectorService,
  unregisterVectorService,
} from '../../../frontend/src/api/oracle.ts';

const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

function mockFetch(handler: (url: string, init?: RequestInit) => unknown) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = handler(String(input), init);
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

test('Studio vector API helpers call provider endpoints', async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  mockFetch((url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (url.endsWith('/providers')) return { providers: [{ type: 'gemini', available: true }] };
    return { success: true, provider: 'gemini', dimensions: 768 };
  });

  await expect(getVectorProviders()).resolves.toEqual([{ type: 'gemini', available: true }]);
  await expect(testVectorProvider({ provider: 'gemini', text: 'hello' })).resolves.toMatchObject({ success: true });
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    'GET http://localhost:47778/api/v1/vector/providers',
    'POST http://localhost:47778/api/v1/vector/providers/test',
  ]);
});

test('Studio vector API helpers call service registry endpoints', async () => {
  const calls: Array<{ url: string; method: string }> = [];
  mockFetch((url, init) => {
    calls.push({ url, method: init?.method ?? 'GET' });
    if (url.endsWith('/services')) return { services: [{ name: 'qdrant', type: 'proxy' }] };
    if (url.endsWith('/test')) return { status: 'up', success: true };
    return { success: true };
  });

  await expect(getVectorServices()).resolves.toEqual([{ name: 'qdrant', type: 'proxy' }]);
  await expect(registerVectorService({ name: 'qdrant', type: 'proxy', endpoint: 'http://qdrant' })).resolves.toBeUndefined();
  await expect(testVectorService('qdrant')).resolves.toMatchObject({ status: 'up' });
  await expect(unregisterVectorService('qdrant')).resolves.toBeUndefined();
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    'GET http://localhost:47778/api/v1/vector/services',
    'POST http://localhost:47778/api/v1/vector/services/register',
    'POST http://localhost:47778/api/v1/vector/services/qdrant/test',
    'DELETE http://localhost:47778/api/v1/vector/services/qdrant',
  ]);
});
