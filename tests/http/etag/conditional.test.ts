import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  ETAG_HEADER,
  IF_NONE_MATCH_HEADER,
  createEtagMiddleware,
  etagForBody,
  ifNoneMatchMatches,
} from '../../../src/middleware/etag.ts';

function app() {
  return new Elysia()
    .use(createEtagMiddleware())
    .get('/json', () => ({ ok: true }))
    .get('/text', () => new Response('hello', { headers: { 'Content-Type': 'text/plain' } }))
    .get('/bytes', () => new Uint8Array([1, 2, 3]))
    .get('/empty', () => null)
    .get('/missing', ({ set }) => {
      set.status = 404;
      return { error: 'missing' };
    })
    .get('/no-content', ({ set }) => {
      set.status = 204;
      return '';
    })
    .get('/explicit', () => new Response('custom', { headers: { [ETAG_HEADER]: '"custom"' } }))
    .get('/set-explicit', ({ set }) => {
      set.headers[ETAG_HEADER] = '"set-custom"';
      return { ok: true };
    })
    .post('/json', () => ({ ok: true }));
}

async function request(path: string, init?: RequestInit) {
  return app().handle(new Request(`http://local${path}`, init));
}

describe('ETag conditional GET middleware', () => {
  test('generates an ETag from JSON GET response bodies', async () => {
    const res = await request('/json');

    expect(res.status).toBe(200);
    expect(res.headers.get(ETAG_HEADER)).toBe(await etagForBody({ ok: true }));
    expect(await res.json()).toEqual({ ok: true });
  });

  test('returns 304 Not Modified when If-None-Match matches', async () => {
    const first = await request('/json');
    const etag = first.headers.get(ETAG_HEADER) ?? '';
    const second = await request('/json', { headers: { [IF_NONE_MATCH_HEADER]: etag } });

    expect(second.status).toBe(304);
    expect(second.headers.get(ETAG_HEADER)).toBe(etag);
    expect(await second.text()).toBe('');
  });

  test('matches weak, wildcard, and multi-value If-None-Match headers', async () => {
    const etag = await etagForBody({ ok: true });
    const weak = await request('/json', { headers: { 'If-None-Match': `W/${etag}` } });
    const multi = await request('/json', { headers: { 'If-None-Match': `"other", ${etag}` } });
    const wildcard = await request('/json', { headers: { 'If-None-Match': '*' } });

    expect(ifNoneMatchMatches(null, etag)).toBe(false);
    expect(weak.status).toBe(304);
    expect(multi.status).toBe(304);
    expect(wildcard.status).toBe(304);
  });

  test('hashes raw Response, bytes, and empty bodies without replacing them', async () => {
    const text = await request('/text');
    const bytes = await request('/bytes');
    const empty = await request('/empty');

    expect(text.headers.get(ETAG_HEADER)).toBe(await etagForBody(new Response('hello')));
    expect(await text.text()).toBe('hello');
    expect(bytes.headers.get(ETAG_HEADER)).toBe(await etagForBody(new Uint8Array([1, 2, 3])));
    expect([...new Uint8Array(await bytes.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(empty.headers.get(ETAG_HEADER)).toBe(await etagForBody(null));
  });

  test('does not tag non-GET, non-success, no-content, or explicit ETag responses', async () => {
    const post = await request('/json', { method: 'POST' });
    const missing = await request('/missing');
    const noContent = await request('/no-content');
    const explicit = await request('/explicit');
    const setExplicit = await request('/set-explicit');

    expect(post.headers.get(ETAG_HEADER)).toBeNull();
    expect(missing.headers.get(ETAG_HEADER)).toBeNull();
    expect(noContent.headers.get(ETAG_HEADER)).toBeNull();
    expect(explicit.headers.get(ETAG_HEADER)).toBe('"custom"');
    expect(setExplicit.headers.get(ETAG_HEADER)).toBe('"set-custom"');
  });
});
