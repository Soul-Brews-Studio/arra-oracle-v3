import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('ALL /api/plugins/:name/server/*', () => {
  test('proxies requests to the plugin-owned web server', async () => {
    const fixture = await createPluginServerFixture();
    try {
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/echo?q=ok`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        message: 'pong',
        plugin: fixture.pluginName,
        query: 'ok',
      });
    } finally {
      await fixture.stop();
    }
  });
});
