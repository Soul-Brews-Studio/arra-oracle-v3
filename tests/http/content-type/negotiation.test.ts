import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  acceptsJson,
  createContentTypeMiddleware,
} from '../../../src/middleware/content-type.ts';

function app() {
  return new Elysia()
    .use(createContentTypeMiddleware())
    .get('/api/ping', () => ({ ok: true }))
    .get('/api/file', () => new Response('wasm', { headers: { 'Content-Type': 'application/wasm' } }));
}

function request(path: string, accept?: string) {
  const headers = accept === undefined ? undefined : { accept };
  return app().handle(new Request(`http://local${path}`, { headers }));
}

describe('content-type negotiation middleware', () => {
  test('allows clients that accept JSON and sets JSON content type', async () => {
    const explicit = await request('/api/ping', 'application/json');
    const wildcard = await request('/api/ping', 'text/html, */*;q=0.8');
    const noHeader = await request('/api/ping');

    expect(explicit.status).toBe(200);
    expect(explicit.headers.get('Content-Type')).toBe('application/json');
    expect(await explicit.json()).toEqual({ ok: true });
    expect(wildcard.status).toBe(200);
    expect(noHeader.status).toBe(200);
  });

  test('returns 406 for unsupported Accept headers', async () => {
    const res = await request('/api/ping', 'text/html, application/xml;q=0.9');

    expect(res.status).toBe(406);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    expect(await res.json()).toEqual({
      error: 'not_acceptable',
      message: 'Only application/json responses are supported.',
      accept: 'text/html, application/xml;q=0.9',
      supported: ['application/json'],
    });
  });

  test('honors q=0 JSON rejection over broader wildcards', () => {
    expect(acceptsJson('application/json;q=0, */*;q=1')).toBe(false);
    expect(acceptsJson('application/*;q=0.5')).toBe(true);
  });

  test('does not overwrite explicit response content types', async () => {
    const res = await request('/api/file', 'application/json');

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/wasm');
  });
});
