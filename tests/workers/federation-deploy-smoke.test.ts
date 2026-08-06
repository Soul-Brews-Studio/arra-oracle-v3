import { describe, expect, setDefaultTimeout, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { handleFederationRequest, type FederationEnv } from '../../workers/federation/src/index.ts';

setDefaultTimeout(60_000);

type SeenRequest = {
  body: string;
  method: string;
  pathname: string;
  query: string;
  signature: string | null;
  timestamp: string | null;
  version: string | null;
};

function runWranglerDryRun() {
  return spawnSync('bunx', ['wrangler', 'deploy', '--dry-run', '--config', 'wrangler.jsonc'], {
    cwd: 'workers/federation',
    encoding: 'utf8',
    env: {
      ...process.env,
      CI: '1',
      NO_COLOR: '1',
      WRANGLER_SEND_METRICS: 'false',
    },
    timeout: 45_000,
  });
}

function startMockTunnel() {
  const seen: SeenRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      seen.push({
        body: await request.text(),
        method: request.method,
        pathname: url.pathname,
        query: url.search,
        signature: request.headers.get('x-maw-signature'),
        timestamp: request.headers.get('x-maw-timestamp'),
        version: request.headers.get('x-maw-auth-version'),
      });
      if (url.pathname.endsWith('/api/send')) return Response.json({ delivered: true }, { status: 202 });
      if (url.pathname.endsWith('/api/sessions')) return Response.json({ sessions: [{ name: 'codex-5' }] });
      if (url.pathname.endsWith('/api/federation/status')) return Response.json({ ok: true, peers: 1 });
      return Response.json({ error: 'unexpected route' }, { status: 404 });
    },
  });
  return {
    seen,
    url: `http://127.0.0.1:${server.port}/maw/`,
    stop: () => server.stop(true),
  };
}

function env(tunnelUrl: string): FederationEnv {
  return { TUNNEL_URL: tunnelUrl, FEDERATION_TOKEN: 'deploy-smoke-secret' };
}

function expectSigned(seen: SeenRequest, version: string | null): void {
  expect(seen.signature).toMatch(/^[a-f0-9]{64}$/);
  expect(seen.timestamp).toMatch(/^\d+$/);
  expect(seen.version).toBe(version);
}

describe('Federation Worker deploy smoke', () => {
  test('wrangler deploy --dry-run bundles workers/federation', () => {
    const result = runWranglerDryRun();
    const output = `${result.stdout}\n${result.stderr}`;

    expect(result.status, output).toBe(0);
    expect(output).toContain('Total Upload');
    expect(output).toContain('env.TUNNEL_URL');
    expect(output).toContain('--dry-run: exiting now');
  });

  test('relays hey, peek, and status through a mock cloudflared tunnel', async () => {
    const tunnel = startMockTunnel();
    try {
      const send = await handleFederationRequest(new Request('https://worker.example/api/send?trace=1', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'codex-5', text: 'starting' }),
      }), env(tunnel.url));
      const sessions = await handleFederationRequest(new Request('https://worker.example/api/sessions?local=true'), env(tunnel.url));
      const status = await handleFederationRequest(new Request('https://worker.example/api/federation/status'), env(tunnel.url));

      expect(send.status).toBe(202);
      expect(sessions.status).toBe(200);
      expect(status.status).toBe(200);
      expect(await send.json()).toEqual({ delivered: true });
      expect(await sessions.json()).toEqual({ sessions: [{ name: 'codex-5' }] });
      expect(await status.json()).toEqual({ ok: true, peers: 1 });
      expect(tunnel.seen.map(({ method, pathname, query }) => ({ method, pathname, query }))).toEqual([
        { method: 'POST', pathname: '/maw/api/send', query: '?trace=1' },
        { method: 'GET', pathname: '/maw/api/sessions', query: '?local=true' },
        { method: 'GET', pathname: '/maw/api/federation/status', query: '' },
      ]);
      expect(tunnel.seen[0].body).toBe('{"target":"codex-5","text":"starting"}');
      expectSigned(tunnel.seen[0], 'v2');
      expectSigned(tunnel.seen[1], null);
      expectSigned(tunnel.seen[2], null);
    } finally {
      tunnel.stop();
    }
  });
});
