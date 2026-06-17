import { afterEach, expect, test } from 'bun:test';
import { getWorkerStatus, getWorkerVersion, httpShutdown, isPortInUse } from '../../src/process-manager/index.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('health helpers tolerate malformed option objects and normalize defaults', async () => {
  const seen: Array<{ url: string; method?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method });
    return Response.json({ version: ' 2.0.0 ' });
  }) as typeof fetch;

  expect(await isPortInUse(47778, { baseUrl: undefined, healthPath: undefined } as any))
    .toBe(true);
  expect(await httpShutdown(47778, { baseUrl: 'http://worker.local///', shutdownPath: 'stop' }))
    .toBe(true);
  expect(await getWorkerStatus(47778, null as any)).toEqual({ running: true, healthy: true });
  expect(await getWorkerVersion(47778, undefined as any, { baseUrl: '   ' } as any))
    .toBe('2.0.0');

  expect(seen).toEqual([
    { url: 'http://127.0.0.1:47778/health', method: undefined },
    { url: 'http://worker.local:47778/stop', method: 'POST' },
    { url: 'http://127.0.0.1:47778/health', method: undefined },
    { url: 'http://127.0.0.1:47778/readiness', method: undefined },
    { url: 'http://127.0.0.1:47778/version', method: undefined },
  ]);
});

test('health helpers fall back when option objects throw during lookup', async () => {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    seen.push(String(input));
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  const options = new Proxy({}, {
    get() {
      throw new Error('options unavailable');
    },
  });

  expect(await isPortInUse(47778, options as any)).toBe(true);
  expect(seen).toEqual(['http://127.0.0.1:47778/health']);
});
