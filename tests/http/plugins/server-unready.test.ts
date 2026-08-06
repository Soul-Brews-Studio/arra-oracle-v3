import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('unready plugin server', () => {
  test('returns 502 when readiness never passes', async () => {
    const oldStart = process.env.ARRA_PLUGIN_START_TIMEOUT_MS;
    process.env.ARRA_PLUGIN_START_TIMEOUT_MS = '120';
    const fixture = await createPluginServerFixture({ healthy: false });
    try {
      expect(fixture.servers.started).toBe(0);
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/health`);
      expect(res.status).toBe(502);
      expect((await res.json()) as { ok: boolean; error: string }).toMatchObject({
        ok: false,
        error: 'plugin server health check failed',
      });
    } finally {
      if (oldStart === undefined) delete process.env.ARRA_PLUGIN_START_TIMEOUT_MS;
      else process.env.ARRA_PLUGIN_START_TIMEOUT_MS = oldStart;
      await fixture.stop();
    }
  });
});
