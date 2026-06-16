import { afterAll, beforeAll, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../smoke/_helpers.ts';

const RESPONSE_TIME_RE = /^\d+\.\dms$/;

let server: SmokeServer | null = null;

beforeAll(async () => {
  server = await startSmokeServer({ name: 'middleware-order' });
});

afterAll(async () => {
  await server?.stop();
});

test('HTTP middleware emits ordered response and preflight headers', async () => {
  expect(server).not.toBeNull();
  const baseUrl = server!.baseUrl;

  const health = await fetch(`${baseUrl}/api/v1/health`, {
    headers: { origin: 'https://studio.example' },
  });

  expect(health.status).toBe(200);
  expect(health.headers.get('X-Request-Id')).toBeTruthy();
  expect(health.headers.get('X-Response-Time')).toMatch(RESPONSE_TIME_RE);
  expect(health.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(health.headers.get('X-Frame-Options')).toBe('DENY');
  expect(health.headers.get('X-XSS-Protection')).toBe('0');

  const preflight = await fetch(`${baseUrl}/api/v1/health`, {
    method: 'OPTIONS',
    headers: {
      origin: 'https://studio.example',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'content-type',
    },
  });

  expect(preflight.status).toBe(204);
  expect(preflight.headers.get('Access-Control-Allow-Origin')).toBe('*');
  expect(preflight.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  expect(preflight.headers.get('Access-Control-Allow-Headers')).toBe('content-type');
  expect(preflight.headers.get('Access-Control-Max-Age')).toBe('86400');
});
