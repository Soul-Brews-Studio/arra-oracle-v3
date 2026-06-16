import { afterAll, beforeAll, expect, test } from 'bun:test';
import { logSmoke, startSmokeServer, type SmokeServer } from './_helpers.ts';

let server: SmokeServer;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'server-health' });
});

afterAll(async () => {
  await server.stop();
});

test('live server health endpoint reports liveness metadata', async () => {
  const res = await fetch(`${server.baseUrl}/api/health`);
  expect(res.status).toBe(200);
  const body = await res.json() as { status: string; server: string; version: string; port: number };
  expect(body.status).toBe('ok');
  expect(body.server).toMatch(/arra-oracle/i);
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(body.port).toBe(Number(new URL(server.baseUrl).port));
  logSmoke('server-health-endpoint', { status: body.status, port: body.port });
});
