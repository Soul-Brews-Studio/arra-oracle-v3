import { afterAll, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApiVersionHeaderMiddleware, createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createRequestLogger, formatRequestLog, type RequestLogEntry } from '../../../src/middleware/logger.ts';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-core-hardening-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));


const sampleLog: RequestLogEntry = {
  event: 'http_request',
  method: 'GET',
  path: '/api/health',
  status: 200,
  durationMs: 12.5,
  correlationId: 'abcdef123456',
  headers: {},
  sandbox: 'dev',
};

test('request logger formats nginx, short, and json records', () => {
  expect(formatRequestLog(sampleLog, 'nginx')).toBe('GET /api/health 200 12.5ms [abcdef12] [dev]');
  expect(formatRequestLog(sampleLog, 'short')).toBe('200 GET /api/health 13ms');
  expect(JSON.parse(formatRequestLog(sampleLog, 'json'))).toMatchObject(sampleLog);
});

function pluginDir(name: string, entry: string) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), JSON.stringify({ name, version: '1.0.0', entry }, null, 2));
  writeFileSync(join(dir, 'index.ts'), 'export default () => ({ ok: true });\n');
  return dir;
}

test('core hardening keeps versioned health reachable, logs configurable, and rejects escaping plugin entries', async () => {
  const oldFormat = process.env.LOG_FORMAT;
  process.env.LOG_FORMAT = 'short';
  const lines: string[] = [];
  const logger = createRequestLogger({ now: () => 10, log: (entry) => lines.push(`${entry.status} ${entry.method} ${entry.path}`) });
  const app = new Elysia()
    .onRequest(logger.onRequest)
    .onAfterResponse(logger.onAfterResponse)
    .use(createApiVersionHeaderMiddleware())
    .use(createHealthRoutes({ vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }) }));
  const fetcher = createApiVersionedFetch((request) => app.handle(request));

  try {
    const res = await fetcher(new Request('http://local/api/v1/health'));
    const body = await res.json() as Record<string, unknown>;
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(body).toMatchObject({ status: 'ok', db: 'connected' });
    expect(typeof body.uptime).toBe('number');
    expect(typeof body.version).toBe('string');
    for (let i = 0; i < 20 && !lines[0]; i += 1) await Bun.sleep(5);
    expect(lines[0]).toBe('200 GET /api/health');
  } finally {
    if (oldFormat === undefined) delete process.env.LOG_FORMAT;
    else process.env.LOG_FORMAT = oldFormat;
  }

  const warnings: string[] = [];
  pluginDir('escape', '../outside.ts');
  const runtime = await loadUnifiedPlugins({ dirs: [tmp], warn: (message) => warnings.push(message) });
  expect(runtime.pluginCount).toBe(0);
  expect(warnings.join('\n')).toContain('plugin entry escapes plugin directory');
});
