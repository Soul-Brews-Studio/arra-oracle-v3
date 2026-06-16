import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createRequestLogger, type RequestLogEntry } from '../../../src/middleware/logger.ts';

const CORRELATION_ID = 'abcdef12-correlation-id';

async function waitForLog(logs: string[]): Promise<string> {
  const deadline = Date.now() + 500;
  while (Date.now() < deadline) {
    if (logs[0]) return logs[0];
    await Bun.sleep(5);
  }
  throw new Error('request log was not emitted');
}

function restoreLogFormat(value: string | undefined) {
  if (value === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = value;
}

async function captureLogLine(format: string | undefined, env?: string): Promise<string> {
  const lines: string[] = [];
  const originalLog = console.log;
  const originalFormat = process.env.LOG_FORMAT;
  const originalEnv = process.env.ARRA_ENV;
  if (format === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = format;
  if (env === undefined) delete process.env.ARRA_ENV;
  else process.env.ARRA_ENV = env;
  console.log = (message?: unknown) => {
    lines.push(String(message));
  };

  try {
    const ticks = [100, 101.37];
    const logger = createRequestLogger({ now: () => ticks.shift() ?? 101.37 });
    const app = new Elysia()
      .onRequest(logger.onRequest)
      .onAfterResponse(logger.onAfterResponse)
      .get('/api/health', () => ({ ok: true }));

    const response = await app.fetch(new Request('http://local/api/health?ignored=true', {
      headers: { 'x-correlation-id': CORRELATION_ID },
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-correlation-id')).toBe(CORRELATION_ID);
    expect(response.headers.get('x-sandbox-label')).toBe(env === 'production' ? 'prod' : 'dev');

    return await waitForLog(lines);
  } finally {
    console.log = originalLog;
    restoreLogFormat(originalFormat);
    if (originalEnv === undefined) delete process.env.ARRA_ENV;
    else process.env.ARRA_ENV = originalEnv;
  }
}

test('LOG_FORMAT selects json, nginx, and short request log output', async () => {
  const json = JSON.parse(await captureLogLine('json')) as RequestLogEntry;
  expect(json).toMatchObject({
    event: 'http_request',
    method: 'GET',
    path: '/api/health',
    status: 200,
    durationMs: 1.37,
    correlationId: CORRELATION_ID,
    sandbox: 'dev',
  });

  expect(await captureLogLine('nginx')).toBe('GET /api/health 200 1.37ms [abcdef12] [dev]');
  expect(await captureLogLine('short')).toBe('200 GET /api/health 1ms');
});

test('LOG_FORMAT defaults to nginx and labels production sandbox', async () => {
  expect(await captureLogLine(undefined, 'production')).toBe('GET /api/health 200 1.37ms [abcdef12] [prod]');
});
