import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  CONTENT_ENCODING_HEADER,
  MIN_COMPRESSIBLE_BYTES,
  acceptedEncoding,
  compressBytes,
  createCompressMiddleware,
  responseBodyBytes,
} from '../../../src/middleware/compress.ts';

const LARGE = 'x'.repeat(MIN_COMPRESSIBLE_BYTES + 1);
const SMALL = 'x'.repeat(MIN_COMPRESSIBLE_BYTES);

function app() {
  return new Elysia()
    .use(createCompressMiddleware())
    .get('/large', () => LARGE)
    .get('/small', () => SMALL)
    .get('/json', () => ({ data: LARGE }))
    .get('/bytes', () => new Uint8Array(MIN_COMPRESSIBLE_BYTES + 2).fill(65))
    .get('/encoded', () => new Response(LARGE, { headers: { [CONTENT_ENCODING_HEADER]: 'br' } }))
    .get('/vary-origin', ({ set }) => {
      set.headers.Vary = 'Origin';
      set.headers['X-List'] = ['a', 'b'];
      return LARGE;
    })
    .get('/vary-encoded', ({ set }) => {
      set.headers.Vary = 'Origin, Accept-Encoding';
      return LARGE;
    })
    .get('/vary-wildcard', ({ set }) => {
      set.headers.Vary = '*';
      return LARGE;
    })
    .get('/empty', ({ set }) => {
      set.status = 204;
      return '';
    })
    .head('/large', () => LARGE);
}

function request(path: string, acceptEncoding = 'gzip') {
  return app().handle(new Request(`http://local${path}`, { headers: { 'Accept-Encoding': acceptEncoding } }));
}

describe('response compression middleware', () => {
  test('gzip-compresses responses larger than 1KB when accepted', async () => {
    const res = await request('/large', 'br, gzip');
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.status).toBe(200);
    expect(res.headers.get(CONTENT_ENCODING_HEADER)).toBe('gzip');
    expect(res.headers.get('Vary')).toContain('Accept-Encoding');
    expect(res.headers.get('Content-Length')).toBe(String(body.byteLength));
    expect(new TextDecoder().decode(Bun.gunzipSync(body))).toBe(LARGE);
  });

  test('deflate-compresses when gzip is unavailable but deflate is accepted', async () => {
    const res = await request('/json', 'deflate');
    const body = new Uint8Array(await res.arrayBuffer());

    expect(res.headers.get(CONTENT_ENCODING_HEADER)).toBe('deflate');
    expect(JSON.parse(new TextDecoder().decode(Bun.inflateSync(body)))).toEqual({ data: LARGE });
  });

  test('keeps small, HEAD, no-content, and already encoded responses uncompressed', async () => {
    const small = await request('/small');
    const head = await app().handle(new Request('http://local/large', { method: 'HEAD', headers: { 'Accept-Encoding': 'gzip' } }));
    const empty = await request('/empty');
    const encoded = await request('/encoded');

    expect(small.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
    expect(await small.text()).toBe(SMALL);
    expect(head.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
    expect(empty.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
    expect(encoded.headers.get(CONTENT_ENCODING_HEADER)).toBe('br');
  });

  test('preserves set headers while maintaining Vary correctly', async () => {
    const origin = await request('/vary-origin');
    const encoded = await request('/vary-encoded');
    const wildcard = await request('/vary-wildcard');

    expect(origin.headers.get('Vary')).toBe('Origin, Accept-Encoding');
    expect(origin.headers.get('X-List')).toBe('a, b');
    expect(encoded.headers.get('Vary')).toBe('Origin, Accept-Encoding');
    expect(wildcard.headers.get('Vary')).toBe('*');
  });

  test('skips compression when Accept-Encoding does not allow gzip or deflate', async () => {
    const missing = await app().handle(new Request('http://local/large'));
    const qZero = await request('/large', 'gzip;q=0, deflate;q=0');
    const unsupported = await request('/large', 'br');

    expect(missing.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
    expect(qZero.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
    expect(unsupported.headers.get(CONTENT_ENCODING_HEADER)).toBeNull();
  });

  test('exposes compression helpers for bytes and Accept-Encoding parsing', async () => {
    const bytes = await responseBodyBytes(new Uint8Array([1, 2, 3]));
    const gzip = compressBytes(bytes, 'gzip');
    const deflate = compressBytes(bytes, 'deflate');

    expect(acceptedEncoding('deflate, gzip;q=0')).toBe('deflate');
    expect(acceptedEncoding('*;q=1')).toBe('gzip');
    expect([...Bun.gunzipSync(gzip)]).toEqual([1, 2, 3]);
    expect([...Bun.inflateSync(deflate)]).toEqual([1, 2, 3]);
  });
});
