import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { loadUnifiedPlugins } from '../../../src/plugins/unified-loader.ts';
import { pluginDir } from '../../plugins/_fixtures.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-health-plugins-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

test('GET /api/health reports loaded plugin lifecycle status', async () => {
  pluginDir(tmp, 'healthy-plugin', {
    lifecycle: { init: 'init', destroy: 'destroy' },
  }, 'export function init() { return { ok: true }; }\nexport function destroy() { return { ok: true }; }\n');
  pluginDir(tmp, 'degraded-plugin', {
    lifecycle: { init: 'init', destroy: 'destroy' },
  }, 'export function init() { return { ok: false, error: "init failed" }; }\nexport function destroy() { return { ok: true }; }\n');
  const runtime = await loadUnifiedPlugins({ dirs: [tmp], warn: () => {} });
  await runtime.init();

  const app = createHealthRoutes({
    pluginCount: runtime.pluginCount,
    pluginStatuses: runtime.pluginStatuses,
    uptimeSeconds: () => 1,
    vectorHealth: async () => ({ status: 'ok', engines: [], checked_at: '2026-06-16T00:00:00.000Z' }),
  });
  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as { pluginStatus: string; plugins: { status: string; items: any[] } };
  const items = body.plugins.items.sort((a, b) => a.name.localeCompare(b.name));

  expect(body.pluginStatus).toBe('degraded');
  expect(body.plugins.status).toBe('degraded');
  expect(items).toEqual([
    { name: 'degraded-plugin', status: 'degraded', error: 'init failed' },
    { name: 'healthy-plugin', status: 'ok' },
  ]);
  await runtime.stop();
});
