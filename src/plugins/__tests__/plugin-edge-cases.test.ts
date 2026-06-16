import { describe, expect, test } from 'bun:test';
import { pluginFailureMessage, responseFromPluginResult } from '../plugin-result.ts';
import { proxyRequestForManifest } from '../proxy-surface.ts';
import type { UnifiedProxyManifest } from '../unified-manifest.ts';

const manifest: UnifiedProxyManifest = {
  path: '/api/plugin-edge',
  targetEnv: 'PLUGIN_EDGE_URL',
  stripPrefix: true,
  methods: ['GET'],
};

async function json(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('plugin edge hardening', () => {
  test('plugin failure messages preserve Error details and trim string errors', async () => {
    expect(pluginFailureMessage(new Error('handler exploded'))).toBe('handler exploded');
    expect(pluginFailureMessage('  bad input  ')).toBe('bad input');
    expect(pluginFailureMessage('   ')).toBe('plugin failed');

    const response = responseFromPluginResult({
      ok: false,
      error: new Error('handler exploded'),
    });

    expect(response).toBeInstanceOf(Response);
    expect(await json(response as Response)).toEqual({ ok: false, error: 'handler exploded' });
  });

  test('plugin proxy rejects blank and non-http target env values before fetch', async () => {
    const request = new Request('http://local/api/plugin-edge/status');
    const blank = await proxyRequestForManifest(request, [manifest], { PLUGIN_EDGE_URL: '   ' });
    const invalid = await proxyRequestForManifest(request, [manifest], { PLUGIN_EDGE_URL: 'ftp://example.test' });

    expect(blank?.status).toBe(502);
    expect(await json(blank!)).toMatchObject({ ok: false, error: 'PLUGIN_EDGE_URL is unset' });
    expect(invalid?.status).toBe(502);
    expect(await json(invalid!)).toMatchObject({
      ok: false,
      error: 'PLUGIN_EDGE_URL must be an http(s) URL',
    });
  });
});
