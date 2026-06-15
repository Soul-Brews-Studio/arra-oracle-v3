import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('server.healthPath manifest option', () => {
  test('uses the declared health path for readiness checks', async () => {
    const fixture = await createPluginServerFixture({ healthPath: '/ready' });
    try {
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(200);
      expect((await res.json()) as { healthPath: string }).toMatchObject({ healthPath: '/ready' });
    } finally {
      await fixture.stop();
    }
  });
});
