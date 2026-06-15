import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('unified plugin server manifest registration', () => {
  test('exposes one manifest server for reverse-proxy mounting', async () => {
    const fixture = await createPluginServerFixture();
    try {
      expect(fixture.runtime.servers).toHaveLength(1);
      expect(fixture.runtime.servers[0]).toMatchObject({
        plugin: fixture.pluginName,
        routePrefix: `/api/plugins/${fixture.pluginName}/server`,
        env: { PLUGIN_MESSAGE: 'pong' },
      });
      expect(fixture.servers.started).toBe(1);
    } finally {
      await fixture.stop();
    }
  });
});
