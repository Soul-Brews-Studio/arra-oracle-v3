import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createRequestLogger, type RequestLogEntry } from '../../../src/middleware/logger.ts';

async function waitForLog(logs: string[]): Promise<string> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (logs[0]) return logs[0];
    await Bun.sleep(5);
  }
  throw new Error('request log was not emitted');
}

test('request logger emits structured JSON and redacts Authorization headers', async () => {
  const lines: string[] = [];
  const original = console.log;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const logger = createRequestLogger();
    const app = new Elysia()
      .onRequest(logger.onRequest)
      .onAfterResponse(logger.onAfterResponse)
      .get('/logged', ({ set }) => {
        set.status = 201;
        return { ok: true };
      });

    const response = await app.fetch(new Request('http://localhost/logged?ignored=true', {
      headers: { authorization: 'Bearer secret-token', 'x-correlation-id': 'test-correlation-id' },
    }));
    expect(response.status).toBe(201);
    expect(response.headers.get('x-correlation-id')).toBe('test-correlation-id');

    const raw = await waitForLog(lines);
    expect(raw).not.toContain('secret-token');
    const entry = JSON.parse(raw) as RequestLogEntry;
    expect(entry).toMatchObject({
      event: 'http_request',
      method: 'GET',
      path: '/logged',
      status: 201,
      correlationId: 'test-correlation-id',
      headers: { authorization: '[REDACTED]', 'x-correlation-id': 'test-correlation-id' },
    });
    expect(typeof entry.durationMs).toBe('number');
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  } finally {
    console.log = original;
  }
});
