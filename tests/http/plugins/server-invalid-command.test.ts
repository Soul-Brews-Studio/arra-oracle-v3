import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('invalid plugin server command', () => {
  test('returns a 500 health response instead of crashing arra', async () => {
    const fixture = await createPluginServerFixture({ command: 'not-a-real-arra-plugin-command' });
    try {
      expect(fixture.servers.started).toBe(0);
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(500);
      expect((await res.json()) as { ok: boolean; plugin: string }).toMatchObject({
        ok: false,
        plugin: fixture.pluginName,
      });
    } finally {
      await fixture.stop();
    }
  });
});
