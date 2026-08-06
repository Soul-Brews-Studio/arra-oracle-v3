/**
 * Every endpoint the root advertises must actually answer.
 *
 * `GET /` returns an `endpoints` map — it is the product's front door, read by `maw arra` and
 * by the #2820 enrichment. Measured against the live server before this test existed:
 *
 * ```
 * /api/docs        308   → only works if the client follows redirects
 * /api/docs/json   308   → same
 * /api/v1          404   → advertised as "api", and dead even when followed
 * ```
 *
 * A map of endpoints where one entry 404s and two need redirect-following is the same
 * declared-but-not-true defect as #2822 (levers that turn nothing), #2831 (docs describing
 * behaviour that did not exist) and #2862 (typed fields nothing reads). It is worse here
 * because this map is what a client reads *in order to discover the API*.
 *
 * This test derives its cases from the running server rather than a hardcoded list, so adding
 * an endpoint to the map automatically puts it under the same obligation.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startOwnedServer, type LiveServer } from '../_live-server.ts';

const PORT = 47793;
let server: LiveServer;
let endpoints: Record<string, string> = {};

beforeAll(async () => {
  server = await startOwnedServer(PORT, 'root-endpoints');
  const body = (await (await fetch(`${server.baseUrl}/`)).json()) as {
    endpoints?: Record<string, string>;
    data?: { endpoints?: Record<string, string> };
  };
  endpoints = body.endpoints ?? body.data?.endpoints ?? {};
}, 60_000);

afterAll(() => {
  server?.stop();
});

/** `/mcp` is bearer-gated: 401 is it working correctly, not a missing route. */
const AUTH_GATED = new Set(['/mcp']);

describe('the root endpoint map is honest', () => {
  test('the map is present and non-trivial', () => {
    expect(Object.keys(endpoints).length).toBeGreaterThanOrEqual(5);
  });

  test('no advertised endpoint 404s', async () => {
    const dead: string[] = [];
    for (const [name, route] of Object.entries(endpoints)) {
      const res = await fetch(`${server.baseUrl}${route}`, { redirect: 'manual' });
      if (res.status === 404) dead.push(`${name} → ${route} (404)`);
    }
    // `/api/v1` was advertised as `api` and returned 404.
    expect(dead).toEqual([]);
  });

  test('no advertised endpoint requires following a redirect', async () => {
    // A client that does not follow redirects — `curl` without -L, and plenty of library
    // defaults — gets nothing. Advertise the destination, not the forwarding address.
    const redirecting: string[] = [];
    for (const [name, route] of Object.entries(endpoints)) {
      const res = await fetch(`${server.baseUrl}${route}`, { redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) {
        redirecting.push(`${name} → ${route} (${res.status} → ${res.headers.get('location')})`);
      }
    }
    expect(redirecting).toEqual([]);
  });

  test('every advertised endpoint responds successfully, or 401 if it is auth-gated', async () => {
    const bad: string[] = [];
    for (const [name, route] of Object.entries(endpoints)) {
      const res = await fetch(`${server.baseUrl}${route}`, { redirect: 'manual' });
      const acceptable = res.ok || (AUTH_GATED.has(route) && res.status === 401);
      if (!acceptable) bad.push(`${name} → ${route} (${res.status})`);
    }
    expect(bad).toEqual([]);
  });
});

describe('the advertised API root answers', () => {
  test('GET /api/v1 returns its own endpoint list', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1`);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { data?: { endpoints?: Record<string, string> }; endpoints?: Record<string, string> };
    const listed = body.endpoints ?? body.data?.endpoints ?? {};
    expect(Object.keys(listed).length).toBeGreaterThan(0);
  });

  test('the endpoints it lists also answer', async () => {
    const res = await fetch(`${server.baseUrl}/api/v1`);
    const body = (await res.json()) as { data?: { endpoints?: Record<string, string> }; endpoints?: Record<string, string> };
    const listed = body.endpoints ?? body.data?.endpoints ?? {};
    const bad: string[] = [];
    for (const [name, route] of Object.entries(listed)) {
      const probe = await fetch(`${server.baseUrl}${route}`, { redirect: 'manual' });
      if (!probe.ok) bad.push(`${name} → ${route} (${probe.status})`);
    }
    expect(bad).toEqual([]);
  });
});
