import { expect, test } from 'bun:test';
import { getWorkerStatus } from '../../src/process-manager/index.ts';

const originalFetch = globalThis.fetch;

test('worker status stays running when readiness fetch fails after health succeeds', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname);
    if (url.pathname === '/health') return new Response('{}', { status: 200 });
    throw new TypeError('socket closed');
  }) as typeof fetch;

  try {
    expect(await getWorkerStatus(47778)).toEqual({ running: true, healthy: false });
    expect(calls).toEqual(['/health', '/readiness']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
