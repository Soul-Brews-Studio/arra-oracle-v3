import { expect, test } from 'bun:test';
import { DB_PATH } from '../../../src/config.ts';
import { mcpTools } from '../../../src/tools/mcp-manifest.ts';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health reports uptime, DB, vector, MCP, and plugin status', async () => {
  const app = createHealthRoutes({
    pluginCount: 5,
    pluginMcpToolCount: 2,
    uptimeSeconds: () => 42.125,
    vectorHealth: async () => ({
      status: 'ok',
      engines: [{ key: 'bge-m3', model: 'bge-m3', collection: 'oracle_knowledge_bge_m3', ok: true }],
      checked_at: '2026-06-16T00:00:00.000Z',
    }),
  });

  const res = await app.handle(new Request('http://local/api/health'));
  expect(res.status).toBe(200);
  const body = await res.json() as Record<string, any>;

  expect(body.status).toBe('ok');
  expect(body.sandbox).toBe('dev');
  expect(body.uptime).toBe(42.125);
  expect(body.uptimeSeconds).toBe(42.125);
  expect(body.db).toBe('connected');
  expect(body.dbStatus).toBe('connected');
  expect(body.dbCheck).toMatchObject({ status: 'connected', path: DB_PATH });
  expect(body.vectorStatus).toBe('ok');
  expect(body.vector).toMatchObject({ status: 'ok', engines: [{ key: 'bge-m3', ok: true }] });
  expect(body.mcpToolCount).toBe(mcpTools.length + 2);
  expect(body.mcp.toolCount).toBe(mcpTools.length + 2);
  expect(body.pluginCount).toBe(5);
  expect(body.plugins.count).toBe(5);
  expect(body.db).toBe('connected');
  expect(body.version).toBeTypeOf('string');
  expect(typeof body.uptime).toBe('number');
});

test('GET /api/health reflects database ping result in status and db field', async () => {
  const app = createHealthRoutes({
    uptimeSeconds: () => 12.25,
    dbPing: () => ({ status: 'error', error: 'db offline' }),
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.status).toBe('degraded');
  expect(body.db).toBe('error');
  expect(body.dbCheck).toMatchObject({ status: 'error', error: 'db offline' });
});
