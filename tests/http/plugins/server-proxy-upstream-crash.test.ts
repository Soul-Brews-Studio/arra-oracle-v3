import { describe, expect, test } from 'bun:test';
import { createPluginServerFixture } from './server-fixture.ts';

describe('plugin server proxy upstream failure', () => {
  test('returns 502 when the plugin server drops the proxied request', async () => {
    const fixture = await createPluginServerFixture();
    try {
      const res = await fetch(`${fixture.baseUrl}/api/plugins/${fixture.pluginName}/server/crash`);
      expect(res.status).toBe(502);
      expect((await res.json()) as { ok: boolean; error: string }).toMatchObject({ ok: false });
    } finally {
      await fixture.stop();
    }
  });
});
