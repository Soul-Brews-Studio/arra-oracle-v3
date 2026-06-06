import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { runFederationSmoke } from '../../scripts/federation-smoke.ts';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;
const TOKEN = 'test-peer-token';
const PUBKEY = 'a'.repeat(64);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function authed(req: Request): boolean {
  return req.headers.get('authorization') === `Bearer ${TOKEN}`;
}

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === '/info') {
        return json({ maw: { schema: 'arra-federation/v1' }, node: { id: 'mock-peer' }, locators: [baseUrl], capabilities: ['arra-search', 'feed'] });
      }
      if (url.pathname === '/api/identity') {
        return json({ pubkey: PUBKEY, tofu: { pinned: true } });
      }
      if (url.pathname === '/api/peers') {
        return json({ peers: [{ id: 'mock-peer', url: baseUrl, pinned: true }] });
      }
      if (url.pathname === '/api/feed') {
        return json({ events: [{ source: 'local-oraclenet-feed' }], total: 1 });
      }
      if (url.pathname === '/api/peer/feed') {
        if (!authed(req)) return json({ error: 'Unauthorized' }, 401);
        return json({ items: [{ source: 'peer-feed' }], total: 1 });
      }
      if (url.pathname === '/api/peer/search') {
        if (!authed(req)) return json({ error: 'Unauthorized' }, 401);
        return json({ results: [{ id: 'doc-1', score: 0.99 }], total: 1 });
      }
      return json({ error: 'Not found' }, 404);
    },
  });
  baseUrl = `http://127.0.0.1:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe('federation smoke harness (#44)', () => {
  test('walks info → identity → peers → peer feed/search and guards /api/feed namespace', async () => {
    const checks = await runFederationSmoke({ baseUrl, token: TOKEN, requireFederation: true });
    expect(checks.filter((check) => check.status === 'fail')).toEqual([]);
    expect(checks.filter((check) => check.status === 'pending')).toEqual([]);
    expect(checks.map((check) => check.name)).toContain('feed namespace separation');
    expect(checks.map((check) => check.name)).toContain('peer auth feed');
    expect(checks.map((check) => check.name)).toContain('peer auth search');
  });
});
