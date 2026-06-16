import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createRequestLoggingMiddleware,
  type StructuredRequestLogEntry,
} from '../../../src/middleware/request-logger.ts';

async function waitForLog(logs: StructuredRequestLogEntry[]) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (logs[0]) return logs[0];
    await Bun.sleep(5);
  }
  throw new Error('request log was not emitted');
}

function app(logs: StructuredRequestLogEntry[], ticks = [10, 14.25]) {
  return new Elysia()
    .use(createRequestLoggingMiddleware({
      log: (entry) => logs.push(entry),
      now: () => ticks.shift() ?? 14.25,
      timestamp: () => '2026-06-16T00:00:00.000Z',
    }))
    .get('/ok', ({ set }) => {
      set.status = 201;
      return { ok: true };
    })
    .get('/raw', () => new Response('raw', { status: 202 }));
}

describe('structured request logging middleware', () => {
  test('logs method, path, status, duration, and timestamp', async () => {
    const logs: StructuredRequestLogEntry[] = [];

    const res = await app(logs).fetch(new Request('http://local/ok?secret=hidden'));

    expect(res.status).toBe(201);
    expect(await waitForLog(logs)).toEqual({
      method: 'GET',
      path: '/ok',
      status: 201,
      durationMs: 4.25,
      timestamp: '2026-06-16T00:00:00.000Z',
    });
  });

  test('uses Response status for raw responses', async () => {
    const logs: StructuredRequestLogEntry[] = [];

    const res = await app(logs).fetch(new Request('http://local/raw'));

    expect(res.status).toBe(202);
    const entry = await waitForLog(logs);
    expect(entry).toMatchObject({ method: 'GET', path: '/raw', status: 202 });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
