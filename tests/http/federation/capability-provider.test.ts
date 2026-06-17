import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { FederationCapabilityProvider } from '../../../src/federation/capability-provider.ts';
import { createFederationRoutes } from '../../../src/routes/federation/index.ts';

function createFetch() {
  const provider = new FederationCapabilityProvider({
    self: {
      id: 'local-oracle',
      url: 'http://127.0.0.1:47778',
      capabilities: ['maw:hey', 'federation:status'],
    },
  });
  const app = new Elysia().use(createFederationRoutes(provider));
  return (request: Request) => app.handle(request);
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

describe('federation capability HTTP routes', () => {
  test('reports provider status and active capabilities', async () => {
    const fetcher = createFetch();

    const status = await fetcher(new Request('http://local/api/federation/status'));
    const capabilities = await fetcher(new Request('http://local/api/federation/capabilities'));

    expect(status.status).toBe(200);
    expect(await json(status)).toMatchObject({
      ok: true,
      provider: 'arra-oracle-federation',
      nodes: 1,
      activeNodes: 1,
      capabilities: ['federation:status', 'maw:hey'],
    });
    expect(await json(capabilities)).toEqual({
      nodes: 1,
      capabilities: ['federation:status', 'maw:hey'],
    });
  });

  test('registers and updates mesh nodes', async () => {
    const fetcher = createFetch();
    const body = {
      id: 'edge-relay',
      name: 'Edge Relay',
      url: 'https://relay.example.test/root/?drop=1',
      capabilities: ['maw:peek', 'mcp:tools'],
      metadata: { tunnel: 'cloudflared' },
    };

    const registered = await fetcher(new Request('http://local/api/federation/mesh/nodes/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }));
    const listed = await fetcher(new Request('http://local/api/federation/mesh/nodes'));

    expect(registered.status).toBe(200);
    expect(await json(registered)).toMatchObject({
      success: true,
      node: {
        id: 'edge-relay',
        name: 'Edge Relay',
        url: 'https://relay.example.test/root',
        capabilities: ['maw:peek', 'mcp:tools'],
      },
    });
    expect(await json(listed)).toMatchObject({
      count: 2,
      nodes: [
        { id: 'edge-relay', metadata: { tunnel: 'cloudflared' } },
        { id: 'local-oracle' },
      ],
    });
  });

  test('rejects invalid mesh node registration', async () => {
    const response = await createFetch()(new Request('http://local/api/federation/mesh/nodes/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: '../bad', url: 'https://relay.example.test' }),
    }));

    expect(response.status).toBe(400);
    expect(await json(response)).toMatchObject({ success: false, error: expect.stringContaining('mesh node id') });
  });
});
