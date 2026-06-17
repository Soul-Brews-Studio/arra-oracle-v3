import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  API_VERSION_HEADER,
  apiRequestPath,
  createApiVersionedFetch,
} from '../../../src/middleware/api-version.ts';
import {
  createCorsMiddleware,
  createPrivateNetworkPreflightMiddleware,
  parseCorsOrigins,
} from '../../../src/middleware/cors.ts';

const STUDIO = 'https://studio.example';

describe('api version middleware redirects and rewrites edge paths', () => {
  test('legacy API redirect is permanent, preserves query, and skips the app', async () => {
    let calls = 0;
    const fetcher = createApiVersionedFetch(() => {
      calls += 1;
      return new Response('unexpected');
    });

    const res = await fetcher(new Request('http://local/api/search?q=oracle&next=%2Fapi%2Fdocs'));

    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('http://local/api/v1/search?q=oracle&next=%2Fapi%2Fdocs');
    expect(res.headers.get(API_VERSION_HEADER)).toBe('v1');
    expect(calls).toBe(0);
  });

  test('versioned request rewrites internally while preserving the public path', async () => {
    const app = new Elysia().get('/api/search', ({ request }) => ({
      routePath: new URL(request.url).pathname,
      publicPath: apiRequestPath(request),
    }));
    const res = await createApiVersionedFetch((request) => app.handle(request))(
      new Request('http://local/api/v1/search?probe=1'),
    );
    const body = await res.json() as { routePath: string; publicPath: string };

    expect(res.status).toBe(200);
    expect(res.headers.get(API_VERSION_HEADER)).toBe('v1');
    expect(body).toEqual({ routePath: '/api/search', publicPath: '/api/v1/search' });
  });

  test('health subpaths stay unredirected for infrastructure probes', async () => {
    const app = new Elysia().get('/api/health/deep', () => ({ status: 'ok' }));
    const res = await createApiVersionedFetch((request) => app.handle(request))(
      new Request('http://local/api/health/deep'),
    );

    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});

describe('cors middleware header edge cases', () => {
  test('preflight de-duplicates requested headers case-insensitively', async () => {
    const app = new Elysia()
      .use(createCorsMiddleware(parseCorsOrigins(STUDIO)))
      .post('/api/ping', () => ({ ok: true }));

    const res = await app.handle(new Request('http://local/api/ping', {
      method: 'OPTIONS',
      headers: {
        origin: STUDIO,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'Authorization, authorization, Content-Type',
      },
    }));

    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STUDIO);
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('authorization,content-type');
  });

  test('cors appends Origin to existing Vary without duplicating it', async () => {
    const app = new Elysia()
      .use(createCorsMiddleware(parseCorsOrigins(STUDIO)))
      .get('/api/ping', ({ set }) => {
        set.headers.Vary = 'Accept-Encoding, Origin';
        return { ok: true };
      });

    const res = await app.handle(new Request('http://local/api/ping', {
      headers: { origin: STUDIO },
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Vary')).toBe('Accept-Encoding, Origin');
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(STUDIO);
  });
});

describe('private-network preflight edge cases', () => {
  test('grants PNA only when origin, method, and requested headers are allowed', async () => {
    const app = new Elysia()
      .use(createPrivateNetworkPreflightMiddleware(parseCorsOrigins(STUDIO)))
      .get('/api/ping', () => ({ ok: true }));

    const allowed = await app.handle(pnaPreflight({
      method: 'GET',
      requestedHeaders: 'Authorization, X-Correlation-Id',
    }));
    const unsafeHeader = await app.handle(pnaPreflight({
      method: 'GET',
      requestedHeaders: 'Authorization, X-Unsafe',
    }));
    const unsafeMethod = await app.handle(pnaPreflight({ method: 'TRACE' }));

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(STUDIO);
    expect(allowed.headers.get('Access-Control-Allow-Private-Network')).toBe('true');
    expect(allowed.headers.get('Access-Control-Allow-Headers')).toBe('authorization,x-correlation-id');
    expect(unsafeHeader.headers.get('Access-Control-Allow-Private-Network')).toBeNull();
    expect(unsafeHeader.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(unsafeMethod.headers.get('Access-Control-Allow-Private-Network')).toBeNull();
  });
});

function pnaPreflight(options: { method: string; requestedHeaders?: string }) {
  const headers: Record<string, string> = {
    origin: STUDIO,
    'access-control-request-method': options.method,
    'access-control-request-private-network': 'true',
  };
  if (options.requestedHeaders) {
    headers['access-control-request-headers'] = options.requestedHeaders;
  }
  return new Request('http://localhost:47778/api/ping', { method: 'OPTIONS', headers });
}
