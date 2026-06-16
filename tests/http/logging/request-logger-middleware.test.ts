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

async function collectDefaultLogLine(format: string | undefined, path: string, correlationId: string) {
  const originalLog = console.log;
  const originalFormat = process.env.LOG_FORMAT;
  const lines: string[] = [];
  if (format === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = format;
  console.log = (message?: unknown) => { lines.push(String(message)); };
  try {
    const res = await new Elysia()
      .use(createRequestLoggingMiddleware({
        now: () => 1,
        timestamp: () => '2026-06-16T00:00:00.000Z',
      }))
      .get(path, () => ({ ok: true }))
      .fetch(new Request(`http://local${path}`, { headers: { 'x-correlation-id': correlationId } }));

    expect(res.status).toBe(200);
    return await waitForLine(lines);
  } finally {
    console.log = originalLog;
    if (originalFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = originalFormat;
  }
}

describe('structured request logging middleware', () => {
  test('default sink emits nginx request log lines when LOG_FORMAT is unset', async () => {
    const line = await collectDefaultLogLine(undefined, '/nginx-log', 'nginx-1');
    expect(line).toBe('GET /nginx-log 200 0ms [nginx-1] [dev]');
  });

  test('default sink honors LOG_FORMAT=json and LOG_FORMAT=short', async () => {
    const json = await collectDefaultLogLine('json', '/json-log', 'json-1');
    const entry = JSON.parse(json) as StructuredRequestLogEntry;
    expect(entry).toMatchObject({
      event: 'http_request',
      method: 'GET',
      path: '/json-log',
      status: 200,
      timestamp: '2026-06-16T00:00:00.000Z',
      correlationId: 'json-1',
      sandbox: 'dev',
    });

    const short = await collectDefaultLogLine('short', '/short-log', 'short-1');
    expect(short).toBe('200 GET /short-log 0ms');
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
