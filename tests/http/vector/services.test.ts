import { expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createApiVersionedFetch } from '../../../src/middleware/api-version.ts';
import { createVectorServicesApiEndpoint } from '../../../src/routes/vector/services.ts';
import type { HealthStatus, RegisteredVectorService, VectorServiceRegistry } from '../../../src/vector/registry.ts';

class FakeRegistry implements VectorServiceRegistry {
  services = new Map<string, RegisteredVectorService>([
    ['lancedb', { name: 'lancedb', type: 'builtin' }],
  ]);

  async register(service: RegisteredVectorService) {
    if (service.type === 'proxy' && !service.endpoint) throw new Error('proxy service requires endpoint');
    this.services.set(service.name, service);
    return service;
  }

  async discover() {
    return [...this.services.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  async unregister(name: string) {
    return this.services.delete(name);
  }

  async healthCheck() {
    const health = new Map<string, HealthStatus>();
    for (const service of this.services.values()) {
      health.set(service.name, { status: service.type === 'proxy' ? 'up' : 'up', checkedAt: '2026-06-16T00:00:00.000Z' });
    }
    return health;
  }
}

function createFetch(registry = new FakeRegistry()) {
  const app = new Elysia({ prefix: '/api' }).use(createVectorServicesApiEndpoint(registry));
  return createApiVersionedFetch((request) => app.handle(request));
}

async function json(res: Response) {
  return JSON.parse(await res.text());
}

test('vector service registry API registers, tests, lists, and removes proxy services', async () => {
  const fetcher = createFetch();
  const register = await fetcher(new Request('http://local/api/v1/vector/services/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'turbovec', type: 'proxy', endpoint: 'http://127.0.0.1:8082', capabilities: { protocol: 'vector-proxy-v1' } }),
  }));
  expect(register.status).toBe(200);
  expect(await json(register)).toMatchObject({ success: true, service: { name: 'turbovec', type: 'proxy' } });

  const testRes = await fetcher(new Request('http://local/api/v1/vector/services/turbovec/test', { method: 'POST' }));
  expect(await json(testRes)).toMatchObject({ name: 'turbovec', status: 'up', success: true });

  const list = await fetcher(new Request('http://local/api/v1/vector/services'));
  const body = await json(list);
  expect(body.count).toBe(2);
  expect(body.services.map((item: { name: string }) => item.name)).toEqual(['lancedb', 'turbovec']);

  const removed = await fetcher(new Request('http://local/api/v1/vector/services/turbovec', { method: 'DELETE' }));
  expect(await json(removed)).toEqual({ success: true, removed: 'turbovec' });
});

test('vector service registry API rejects proxy registration without endpoint', async () => {
  const res = await createFetch()(new Request('http://local/api/v1/vector/services/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'bad', type: 'proxy' }),
  }));

  expect(res.status).toBe(400);
  expect(await json(res)).toMatchObject({ success: false, error: 'proxy service requires endpoint' });
});
