import { afterEach, describe, expect, test } from 'bun:test';
import { peerRoutes } from '../../../src/routes/peer/index.ts';

const savedPeerToken = process.env.ARRA_PEER_TOKEN;

afterEach(() => {
  if (savedPeerToken === undefined) delete process.env.ARRA_PEER_TOKEN;
  else process.env.ARRA_PEER_TOKEN = savedPeerToken;
});

function request(path: string, init: RequestInit = {}) {
  return peerRoutes.handle(new Request(`http://local${path}`, init));
}

describe('peer HTTP routes', () => {
  test('GET /info exposes federation capabilities', async () => {
    const res = await request('/info');
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.oracle).toBe('arra');
    expect(body.maw.capabilities).toContain('arra-search');
  });

  test('GET /api/identity returns a stable identity document shape', async () => {
    const res = await request('/api/identity');
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(typeof body.pubkey).toBe('string');
    expect(body.oracle).toBe('arra');
    expect(typeof body.clockUtc).toBe('string');
  });

  test('peer-protected endpoints reject missing bearer token when configured', async () => {
    process.env.ARRA_PEER_TOKEN = 'secret';

    const feed = await request('/api/peer/feed');
    expect(feed.status).toBe(401);
    expect(await feed.json()).toMatchObject({ error: 'peer_auth_required' });

    const search = await request('/api/peer/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'oracle' }),
    });
    expect(search.status).toBe(401);
  });
});
