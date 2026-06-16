import { afterAll, beforeAll, expect, test } from 'bun:test';
import { logSmoke, startSmokeServer, type SmokeServer } from './_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'plugins-api', withPlugin: true });
});

afterAll(async () => {
  await server.stop();
});

test('live /api/plugins lists a local plugin manifest', async () => {
  const res = await fetch(`${server.baseUrl}/api/plugins`);
  expect(res.status).toBe(200);
  const body = await res.json() as { plugins: Array<{ name: string; file: string; server?: unknown }> };
  const plugin = body.plugins.find((entry) => entry.name === 'smoke-orbit');
  expect(plugin).toBeDefined();
  expect(plugin!.file).toBe('');
  expect(plugin!.server).toMatchObject({ command: 'bun', autostart: false });
  logSmoke('plugins-api', { plugins: body.plugins.map((entry) => entry.name) });
});
