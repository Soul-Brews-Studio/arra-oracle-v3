import { expect, test } from 'bun:test';
import { createHealthRoutes } from '../../../src/routes/health/index.ts';
import { readVectorServerHealth } from '../../../src/routes/health/vector-server.ts';

function baseOptions(vectorServerHealth: () => Promise<any>) {
  return {
    pluginCount: 0,
    uptimeSeconds: () => 1,
    dbPing: () => ({ status: 'connected' as const }),
    vectorHealth: async () => ({ status: 'ok' as const, engines: [], checked_at: '2026-06-17T00:00:00.000Z' }),
    vectorServerHealth,
  };
}

test('GET /api/health includes separate vector-server health when configured', async () => {
  const app = createHealthRoutes(baseOptions(async () => ({
    configured: true,
    status: 'ok',
    url: 'http://127.0.0.1:8081',
    httpStatus: 200,
    protocol: 'vector-proxy-v1',
  })));

  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(res.status).toBe(200);
  expect(body.status).toBe('ok');
  expect(body.vectorServer).toMatchObject({
    configured: true,
    status: 'ok',
    url: 'http://127.0.0.1:8081',
    protocol: 'vector-proxy-v1',
  });
  expect(body.vectorAvailable).toBe(true);
});

test('GET /api/health degrades when configured vector-server is down', async () => {
  const app = createHealthRoutes(baseOptions(async () => ({
    configured: true,
    status: 'down',
    url: 'http://127.0.0.1:8081',
    error: 'unreachable',
  })));

  const res = await app.handle(new Request('http://local/api/health'));
  const body = await res.json() as Record<string, any>;

  expect(body.status).toBe('degraded');
  expect(body.vectorServer).toMatchObject({ status: 'down', error: 'unreachable' });
  expect(body.vectorAvailable).toBe(false);
});

test('readVectorServerHealth probes VECTOR_URL health endpoint', async () => {
  const seen: string[] = [];
  const result = await readVectorServerHealth(async (input) => {
    seen.push(String(input));
    return Response.json({ status: 'ok', protocol: 'vector-proxy-v1', version: '1.0.0' });
  }, { VECTOR_URL: 'http://vector.local:8081/root/' }, ['bun', 'src/server.ts']);

  expect(seen).toEqual(['http://vector.local:8081/health']);
  expect(result).toMatchObject({
    configured: true,
    status: 'ok',
    url: 'http://vector.local:8081/root',
    httpStatus: 200,
    protocol: 'vector-proxy-v1',
  });
});
