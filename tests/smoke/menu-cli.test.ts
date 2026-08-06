import { afterAll, beforeAll, expect, test } from 'bun:test';
import { logSmoke, runSmokeCli, startSmokeServer, type SmokeServer } from './_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'menu-cli' });
});

afterAll(async () => {
  await server.stop();
});

test('CLI menu list exercises /api/menu on a live server', async () => {
  const result = await runSmokeCli(server, ['menu', 'list']);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  const body = JSON.parse(result.stdout) as { endpoint: string; items: Array<{ path: string }> };
  expect(body.endpoint).toBe('/api/menu');
  expect(body.items.some((item) => item.path === '/search')).toBe(true);
  logSmoke('menu-cli', { items: body.items.length, endpoint: body.endpoint });
});
