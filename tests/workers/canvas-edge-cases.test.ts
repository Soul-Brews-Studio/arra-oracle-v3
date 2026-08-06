import { afterEach, describe, expect, test } from 'bun:test';
import { handleCanvasRequest } from '../../src/workers/canvas/index.ts';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('canvas worker edge cases', () => {
  test('returns a marked 502 JSON response when upstream API fetch fails', async () => {
    globalThis.fetch = (async () => {
      throw new Error('network unavailable');
    }) as typeof fetch;

    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/health'),
    );

    expect(response.status).toBe(502);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-oracle-canvas-worker')).toBe('canvas.buildwithoracle.com');
    expect(await response.json()).toEqual({ error: 'api proxy failed' });
  });

  test('falls back to the default API base when env base URL is invalid', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Response.json({ ok: true });
    }) as typeof fetch;

    await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/health?probe=1'),
      { ORACLE_API_BASE: 'not a url' },
    );

    expect(seen).toEqual(['https://studio.buildwithoracle.com/api/health?probe=1']);
  });

  test('falls back to the default API base for non-http env protocols', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return Response.json({ ok: true });
    }) as typeof fetch;

    await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/health'),
      { ORACLE_API_BASE: 'file:///tmp/oracle.sock' },
    );

    expect(seen).toEqual(['https://studio.buildwithoracle.com/api/health']);
  });

  test('sanitizes configured API base before exposing it to health and HTML', async () => {
    const env = { ORACLE_API_BASE: ' https://user:pass@oracle.example.test/root/?token=secret#frag ' };
    const health = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/__health'),
      env,
    );
    const body = await health.json() as { apiBase: string };
    const page = await handleCanvasRequest(new Request('https://canvas.buildwithoracle.com/wave'), env);
    const html = await page.text();

    expect(body.apiBase).toBe('https://oracle.example.test/root');
    expect(html).toContain('data-api-base="https://oracle.example.test/root"');
    expect(html).not.toContain('user:pass');
    expect(html).not.toContain('token=secret');
  });

  test('strips client host headers and omits bodies for HEAD API proxy requests', async () => {
    const seen: Array<{ url: string; method: string; host: string | null; body: BodyInit | null | undefined }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({
        url: String(input),
        method: init?.method ?? 'GET',
        host: new Headers(init?.headers).get('host'),
        body: init?.body,
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/health', {
        method: 'HEAD',
        headers: { host: 'spoofed.example', 'x-api-key': 'token' },
      }),
      { ORACLE_API_BASE: 'https://oracle.example.test' },
    );

    expect(response.status).toBe(204);
    expect(seen).toEqual([{ url: 'https://oracle.example.test/api/health', method: 'HEAD', host: null, body: undefined }]);
  });

  test('rejects malformed percent-encoded local registry plugin ids', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/canvas/plugins/%E0%A4%A'),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ error: 'invalid canvas plugin id' });
  });

  test('returns local registry 404s for unknown canvas plugin ids', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/plugins/canvas/missing-plugin'),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'canvas plugin not found', id: 'missing-plugin' });
  });

  test('escapes unknown plugin text before rendering fallback notices', async () => {
    const raw = '<img src=x onerror="alert(1)">';
    const response = await handleCanvasRequest(
      new Request(`https://canvas.buildwithoracle.com/?plugin=${encodeURIComponent(raw)}`),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain(raw);
    expect(html).toContain('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;');
    expect(html).toContain('loaded Wave instead');
  });

  test('HEAD page requests return HTML headers without a body', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/planets', { method: 'HEAD' }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('x-oracle-canvas-worker')).toBe('canvas.buildwithoracle.com');
    expect(await response.text()).toBe('');
  });

  test('non-page methods return a marked 405 with allowed methods', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/planets', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(response.headers.get('x-oracle-canvas-worker')).toBe('canvas.buildwithoracle.com');
  });
});
