import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('running plugin server with failing health', () => {
  test('marks health response unhealthy with 502 status', async () => {
    const fixture = await createPluginServerFixture({ flipHealth: true });
    try {
      expect(fixture.servers.started).toBe(1);
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(502);
      expect((await res.json()) as { ok: boolean; healthy: boolean; status: number }).toMatchObject({
        ok: false,
        healthy: false,
        status: 500,
      });
    } finally {
      await fixture.stop();
    }
  });
});
