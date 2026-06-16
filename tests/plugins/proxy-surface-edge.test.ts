import { expect, test } from 'bun:test';
import { proxyRequestForManifest } from '../../src/plugins/proxy-surface.ts';

test('plugin proxy normalizes target base URLs before forwarding', async () => {
  let captured: { path?: string; search?: string } = {};
  const upstream = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      captured = { path: url.pathname, search: url.search };
      return Response.json(captured);
    },
  });

  try {
    const response = await proxyRequestForManifest(
      new Request('http://oracle.test/proxy/nested?q=1'),
      [{ path: '/proxy', targetEnv: 'PLUGIN_URL', stripPrefix: true }],
      { PLUGIN_URL: ` http://127.0.0.1:${upstream.port}/base/?debug=1#frag ` },
    );

    expect(response?.status).toBe(200);
    expect(captured).toEqual({ path: '/base/nested', search: '?q=1' });
  } finally {
    await upstream.stop();
  }
});

test('plugin proxy rejects non-http target base URLs', async () => {
  const response = await proxyRequestForManifest(
    new Request('http://oracle.test/proxy'),
    [{ path: '/proxy', targetEnv: 'PLUGIN_URL' }],
    { PLUGIN_URL: 'file:///tmp/plugin.sock' },
  );

  expect(response?.status).toBe(502);
  expect(await response?.json()).toMatchObject({ ok: false, targetEnv: 'PLUGIN_URL' });
});
