import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('GET /api/plugins/:name/server/health', () => {
  test('returns the plugin-owned server health through arra', async () => {
    const fixture = await createPluginServerFixture();
    try {
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as { plugin: string; healthy: boolean; routePrefix: string };
      expect(body).toMatchObject({
        plugin: fixture.pluginName,
        healthy: true,
        routePrefix: `/api/plugins/${fixture.pluginName}/server`,
      });
    } finally {
      await fixture.stop();
    }
  });
});
