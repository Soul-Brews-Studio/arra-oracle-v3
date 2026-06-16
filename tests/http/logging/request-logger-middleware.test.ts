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

async function waitForLine(lines: string[]) {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (lines[0]) return lines[0];
    await Bun.sleep(5);
  }
  throw new Error('request log line was not emitted');
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
  test('default sink emits a JSON request log line', async () => {
    const original = console.log;
    const lines: string[] = [];
    console.log = (message?: unknown) => { lines.push(String(message)); };
    try {
      const res = await new Elysia()
        .use(createRequestLoggingMiddleware({
          now: () => 1,
          timestamp: () => '2026-06-16T00:00:00.000Z',
        }))
        .get('/json-log', () => ({ ok: true }))
        .fetch(new Request('http://local/json-log', { headers: { 'x-correlation-id': 'json-1' } }));

      expect(res.status).toBe(200);
      const entry = JSON.parse(await waitForLine(lines)) as StructuredRequestLogEntry;
      expect(entry).toMatchObject({
        event: 'http_request',
        method: 'GET',
        path: '/json-log',
        status: 200,
        correlationId: 'json-1',
        sandbox: 'dev',
      });
    } finally {
      console.log = original;
    }
  });

  test('logs structured JSON request metadata with redacted headers', async () => {
    const logs: StructuredRequestLogEntry[] = [];

    const res = await app(logs).fetch(new Request('http://local/ok?secret=hidden', {
      headers: { authorization: 'Bearer secret', 'x-correlation-id': 'req-1' },
    }));

    expect(res.status).toBe(201);
    expect(res.headers.get('x-correlation-id')).toBe('req-1');
    expect(res.headers.get('x-sandbox-label')).toBe('dev');
    expect(await waitForLog(logs)).toMatchObject({
      event: 'http_request',
      method: 'GET',
      path: '/ok',
      status: 201,
      durationMs: 4.25,
      timestamp: '2026-06-16T00:00:00.000Z',
      correlationId: 'req-1',
      headers: { authorization: '[REDACTED]', 'x-correlation-id': 'req-1' },
      sandbox: 'dev',
    });
  });

  test('uses Response status for raw responses', async () => {
    const logs: StructuredRequestLogEntry[] = [];

    const res = await app(logs).fetch(new Request('http://local/raw'));

    expect(res.status).toBe(202);
    const entry = await waitForLog(logs);
    expect(entry).toMatchObject({ event: 'http_request', method: 'GET', path: '/raw', status: 202 });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });
});
