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

  test('rejects malformed percent-encoded local registry plugin ids', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/api/canvas/plugins/%E0%A4%A'),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await response.json()).toEqual({ error: 'invalid canvas plugin id' });
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

  test('non-page methods return a marked 405 with allowed methods', async () => {
    const response = await handleCanvasRequest(
      new Request('https://canvas.buildwithoracle.com/planets', { method: 'POST' }),
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
    expect(response.headers.get('x-oracle-canvas-worker')).toBe('canvas.buildwithoracle.com');
  });
});
