import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Elysia } from 'elysia';
import { createPluginsRouter } from '../../../src/routes/plugins/index.ts';
import { pluginDir } from '../../plugins/_fixtures.ts';

const tmp = mkdtempSync(join(tmpdir(), 'arra-plugin-state-'));
const previousDirs = process.env.ARRA_PLUGIN_DIRS;
process.env.ARRA_PLUGIN_DIRS = tmp;

afterAll(() => {
  if (previousDirs === undefined) delete process.env.ARRA_PLUGIN_DIRS;
  else process.env.ARRA_PLUGIN_DIRS = previousDirs;
  rmSync(tmp, { recursive: true });
});

describe('PATCH /api/plugins/:name/state', () => {
  test('persists enabled=false to plugin.json', async () => {
    const dir = pluginDir(tmp, 'toggle-plugin', { description: 'toggle me' });
    const app = new Elysia().use(createPluginsRouter());

    const response = await app.handle(new Request('http://local/api/plugins/toggle-plugin/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    }));

    expect(response.status).toBe(200);
    const body = await response.json() as { enabled: boolean; requiresRestart: boolean };
    expect(body).toMatchObject({ enabled: false, requiresRestart: true });
    const manifest = JSON.parse(readFileSync(join(dir, 'plugin.json'), 'utf8')) as { enabled?: boolean };
    expect(manifest.enabled).toBe(false);
  });

  test('returns 404 for unknown plugin manifests', async () => {
    const app = new Elysia().use(createPluginsRouter());
    const response = await app.handle(new Request('http://local/api/plugins/missing/state', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    }));

    expect(response.status).toBe(404);
  });
});
