import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildTunnelUrl, handleFederationRequest, proxyFederationRequest, resolveTunnelUrl, signFederationHeaders, type FederationEnv } from '../../workers/federation/src/index.ts';

const token = '0123456789abcdef0123456789abcdef';

function env(overrides: Partial<FederationEnv> = {}): FederationEnv {
  return { TUNNEL_URL: 'https://tunnel.example.test/root/', FEDERATION_TOKEN: token, ...overrides };
}

describe('federation Worker proxy', () => {
  test('normalizes tunnel URLs and preserves relayed path/query', () => {
    expect(resolveTunnelUrl({ TUNNEL_URL: ' https://user:pass@tunnel.example.test/root/?x=1#hash ' })).toBe('https://tunnel.example.test/root');
    expect(resolveTunnelUrl({})).toBeNull();
    expect(resolveTunnelUrl({ TUNNEL_URL: 'not a url' })).toBeNull();
    expect(resolveTunnelUrl({ TUNNEL_URL: 'file:///tmp/tunnel.sock' })).toBeNull();
    expect(buildTunnelUrl('https://tunnel.example.test/root', 'https://worker.example/api/sessions?local=true')).toBe('https://tunnel.example.test/root/api/sessions?local=true');
  });

  test('signs maw-compatible v1 and v2 HMAC headers', async () => {
    const read = await signFederationHeaders(token, 'GET', '/api/sessions', '', 1_700_000_000);
    const write = await signFederationHeaders(token, 'POST', '/api/send', '{"text":"hi"}', 1_700_000_000);

    expect(read).toEqual({
      'X-Maw-Timestamp': '1700000000',
      'X-Maw-Signature': '71d6f172033dd255b0458185707a8ca32c71458d16e4bbb16bf2cde0f6037563',
    });
    expect(write['X-Maw-Auth-Version']).toBe('v2');
    expect(write['X-Maw-Signature']).toBe('5cd5f190469ba5059ef6b0b490f6af66cbea2f38727d348e14ae3507d61f977e');
  });

  test('relays send and sessions to the tunnel with HMAC headers', async () => {
    const seen: Array<{ url: string; method: string; version: string | null; body: string; host: string | null; forwarded: string | null }> = [];
    const fetcher = async (request: Request) => {
      seen.push({
        url: request.url,
        method: request.method,
        version: request.headers.get('x-maw-auth-version'),
        body: await request.text(),
        host: request.headers.get('host'),
        forwarded: request.headers.get('x-forwarded-for'),
      });
      expect(request.headers.get('x-maw-signature')).toMatch(/^[a-f0-9]{64}$/);
      expect(request.headers.get('x-oracle-federation-proxy')).toBe('cloudflare-workers');
      return Response.json({ ok: true });
    };

    const send = await proxyFederationRequest(new Request('https://worker.example/api/send', { method: 'POST', body: JSON.stringify({ target: 'codex-1', text: 'hi' }) }), env(), fetcher);
    const sessions = await proxyFederationRequest(new Request('https://worker.example/api/sessions?local=true', {
      headers: { host: 'evil.example', 'x-forwarded-for': '203.0.113.1', 'x-maw-auth-version': 'spoofed' },
    }), env(), fetcher);

    expect(send.headers.get('cache-control')).toBe('no-store');
    expect(sessions.status).toBe(200);
    expect(seen).toEqual([
      { url: 'https://tunnel.example.test/root/api/send', method: 'POST', version: 'v2', body: '{"target":"codex-1","text":"hi"}', host: null, forwarded: null },
      { url: 'https://tunnel.example.test/root/api/sessions?local=true', method: 'GET', version: null, body: '', host: null, forwarded: null },
    ]);
  });

  test('rejects unsupported routes and reports missing tunnel config', async () => {
    expect((await proxyFederationRequest(new Request('https://worker.example/api/send'), env())).status).toBe(404);
    const missing = await proxyFederationRequest(new Request('https://worker.example/api/sessions'), env({ TUNNEL_URL: undefined }));
    expect(missing.status).toBe(502);
    expect(await missing.json()).toMatchObject({ error: 'tunnel unavailable' });
    const unsigned = await proxyFederationRequest(new Request('https://worker.example/api/sessions'), env({ FEDERATION_TOKEN: undefined, federationToken: '' }));
    expect(unsigned.status).toBe(502);
    expect(await unsigned.json()).toMatchObject({ error: 'token unavailable' });
  });

  test('serves health with tunnel configuration state', async () => {
    const response = await handleFederationRequest(new Request('https://worker.example/__health'), env());
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ ok: true, app: 'arra-oracle-federation-proxy', tunnelConfigured: true });
  });

  test('keeps federation deploy config free of committed secrets', () => {
    const cfg = JSON.parse(readFileSync('workers/federation/wrangler.jsonc', 'utf8'));

    expect(cfg.vars.TUNNEL_URL).toContain('your-tunnel');
    expect(cfg.vars.FEDERATION_TOKEN).toBeUndefined();
    expect(JSON.stringify(cfg)).not.toContain('deploy-smoke-secret');
  });
});
