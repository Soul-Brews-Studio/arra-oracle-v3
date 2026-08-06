import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('autostart:false plugin server manifests', () => {
  test('start lazily on first health request', async () => {
    const fixture = await createPluginServerFixture({ autostart: false });
    try {
      expect(fixture.servers.started).toBe(0);
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(200);
      expect((await res.json()) as { healthy: boolean }).toMatchObject({ healthy: true });
    } finally {
      await fixture.stop();
    }
  });
});
