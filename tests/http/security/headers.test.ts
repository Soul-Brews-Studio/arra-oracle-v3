import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { createSecurityHeadersMiddleware, isHstsEnabled } from '../../../src/middleware/security-headers.ts';

const previousHsts = process.env.ARRA_HSTS;

function restoreHsts() {
  if (previousHsts === undefined) delete process.env.ARRA_HSTS;
  else process.env.ARRA_HSTS = previousHsts;
}

afterEach(restoreHsts);

function app() {
  return new Elysia()
    .use(createSecurityHeadersMiddleware())
    .get('/ok', () => ({ ok: true }))
    .get('/boom', () => {
      throw new Error('boom');
    });
}

function request(path: string) {
  return app().handle(new Request(`http://local${path}`));
}

function expectBaseSecurityHeaders(res: Response) {
  expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(res.headers.get('X-Frame-Options')).toBe('DENY');
  expect(res.headers.get('X-XSS-Protection')).toBe('0');
}

describe('security headers middleware', () => {
  test('sets baseline browser security headers by default', async () => {
    delete process.env.ARRA_HSTS;

    const res = await request('/ok');

    expect(res.status).toBe(200);
    expectBaseSecurityHeaders(res);
    expect(res.headers.get('Strict-Transport-Security')).toBeNull();
  });

  test('sets HSTS only when ARRA_HSTS is true', async () => {
    process.env.ARRA_HSTS = ' true ';

    const res = await request('/ok');

    expect(res.status).toBe(200);
    expectBaseSecurityHeaders(res);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });

  test('applies security headers to error responses', async () => {
    process.env.ARRA_HSTS = 'true';

    const res = await request('/boom');

    expect(res.status).toBe(500);
    expectBaseSecurityHeaders(res);
    expect(res.headers.get('Strict-Transport-Security')).toBe('max-age=31536000; includeSubDomains');
  });

  test('parses only true-like HSTS values as enabled', () => {
    expect(isHstsEnabled('TRUE')).toBe(true);
    expect(isHstsEnabled('false')).toBe(false);
    expect(isHstsEnabled(undefined)).toBe(false);
  });
});
