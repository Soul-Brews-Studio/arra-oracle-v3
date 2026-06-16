import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createTenantFetch,
  createTenantMiddleware,
  parseTenantTokens,
  TENANT_HEADER,
  TENANT_TOKEN_HEADER,
  validateTenantToken,
} from '../../../src/middleware/tenant.ts';

describe('tenant auth middleware', () => {
  test('parses JSON and comma tenant token config', () => {
    expect(parseTenantTokens('{"acme":"secret"}')).toEqual({ acme: 'secret' });
    expect(parseTenantTokens('acme=secret, beta=two=parts')).toEqual({ acme: 'secret', beta: 'two=parts' });
  });

  test('validates configured tenant token header', () => {
    const headers = new Headers({ [TENANT_TOKEN_HEADER]: 'secret' });
    expect(() => validateTenantToken(headers, 'acme', { acme: 'secret' })).not.toThrow();
    expect(() => validateTenantToken(headers, 'acme', { acme: 'wrong' })).toThrow('invalid tenant token');
    expect(() => validateTenantToken(new Headers(), 'acme', { acme: 'secret' })).toThrow('tenant token required');
  });

  test('attaches tenantId to Elysia request context', async () => {
    const app = new Elysia()
      .use(createTenantMiddleware())
      .get('/whoami', ({ tenantId }) => ({ tenantId }));

    const res = await app.handle(new Request('http://local/whoami', {
      headers: { [TENANT_HEADER]: 'acme' },
    }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenantId: 'acme' });
    expect(res.headers.get(TENANT_HEADER)).toBe('acme');
  });

  test('rejects invalid tenant token from fetch wrapper', async () => {
    const previous = process.env.ORACLE_TENANT_TOKENS;
    process.env.ORACLE_TENANT_TOKENS = 'acme=secret';
    try {
      const res = await createTenantFetch(() => Response.json({ ok: true }))(new Request('http://local/', {
        headers: { [TENANT_HEADER]: 'acme', [TENANT_TOKEN_HEADER]: 'bad' },
      }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'invalid tenant token' });
    } finally {
      if (previous === undefined) delete process.env.ORACLE_TENANT_TOKENS;
      else process.env.ORACLE_TENANT_TOKENS = previous;
    }
  });
});
