import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('unknown plugin server routes', () => {
  test('return 404 without spawning a server', async () => {
    const fixture = await createPluginServerFixture();
    try {
      const res = await fetch(`${fixture.baseUrl}/api/plugins/missing/server/health`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({
        ok: false,
        plugin: 'missing',
        error: 'plugin server not found',
      });
    } finally {
      await fixture.stop();
    }
  });
});
