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
      // Assert the CONTRACT (502 + ok:false + a stated reason), not the wording.
      // src/plugins/unified-server.ts:148 is `result.error ?? 'plugin server health
      // check failed'`, so the literal previously pinned here was only the FALLBACK.
      // An unready server legitimately fails in more than one way and each reports
      // its own reason: "health check failed: <url>" when the probe answers unhealthy,
      // "Unable to connect. Is the computer able to access the url?" when it never
      // listens. Both are correctly 502 + ok:false. Which one you get depends on
      // machine load, so pinning either makes the suite fail by contention.
      // Measured: passes alone and as tests/http/plugins/ (36/36); failed ONLY in the
      // full `bun test --isolate tests/http/` run over 300 files — the exact
      // invocation the nightly tier added in #2999 executes.
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(typeof body.error).toBe('string');
      expect(body.error.length).toBeGreaterThan(0);
    } finally {
      if (oldStart === undefined) delete process.env.ARRA_PLUGIN_START_TIMEOUT_MS;
      else process.env.ARRA_PLUGIN_START_TIMEOUT_MS = oldStart;
      await fixture.stop();
    }
  });
});
