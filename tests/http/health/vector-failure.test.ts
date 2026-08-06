import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';

test('GET /api/health reports vector check failures as down status', async () => {
  const app = createHealthRoutes({
    uptimeSeconds: () => 3,
    vectorHealth: async () => { throw new Error('vector unavailable'); },
  });
  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.vectorStatus).toBe('down');
  expect(body.vector).toMatchObject({ status: 'down', error: 'vector unavailable' });
  expect(typeof body.pluginCount).toBe('number');
});
