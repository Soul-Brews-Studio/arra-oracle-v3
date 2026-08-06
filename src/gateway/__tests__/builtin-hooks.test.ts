import { describe, it, expect, beforeAll } from 'bun:test';
import { loadHooks, runHooks, type GatewayContext } from '../hooks.ts';

// Side-effect imports register the hooks into the global registry.
import '../hooks/auth-guard.ts';
import '../hooks/fts5-fallback.ts';

function makeCtx(
  url: string,
  init: RequestInit = {},
  hookOptions: Record<string, unknown> = {},
): GatewayContext {
  return {
    request: new Request(url, init),
    meta: { hook_options: hookOptions },
  };
}

describe('auth-guard hook', () => {
  let runRequest: (ctx: GatewayContext) => Promise<Response | void>;
  beforeAll(() => {
    const pipeline = loadHooks({ onRequest: ['auth-guard'] });
    runRequest = (ctx) => runHooks(pipeline.onRequest, ctx);
  });

  it('rejects when the configured header is missing', async () => {
    const ctx = makeCtx('http://localhost/api/search', {}, {
      'auth-guard': { header: 'x-oracle-token' },
    });
    const res = await runRequest(ctx);
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(401);
    const body = await (res as Response).json();
    expect(body.reason).toContain('missing');
  });

  it('rejects when expected token does not match', async () => {
    const ctx = makeCtx(
      'http://localhost/api/search',
      { headers: { 'x-oracle-token': 'wrong' } },
      { 'auth-guard': { header: 'x-oracle-token', expected: 'secret' } },
    );
    const res = await runRequest(ctx);
    expect((res as Response).status).toBe(401);
    const body = await (res as Response).json();
    expect(body.reason).toContain('invalid');
  });

  it('allows when expected token matches', async () => {
    const ctx = makeCtx(
      'http://localhost/api/search',
      { headers: { 'x-oracle-token': 'secret' } },
      { 'auth-guard': { header: 'x-oracle-token', expected: 'secret' } },
    );
    const res = await runRequest(ctx);
    expect(res).toBeUndefined();
  });

  it('allows when any non-empty token is acceptable (no expected)', async () => {
    const ctx = makeCtx(
      'http://localhost/api/search',
      { headers: { 'x-oracle-token': 'anything' } },
      { 'auth-guard': { header: 'x-oracle-token' } },
    );
    const res = await runRequest(ctx);
    expect(res).toBeUndefined();
  });

  it('bypasses check for allowlisted paths', async () => {
    const ctx = makeCtx('http://localhost/api/health', {}, {
      'auth-guard': { header: 'x-oracle-token', allowlist: ['/api/health'] },
    });
    const res = await runRequest(ctx);
    expect(res).toBeUndefined();
  });

  it('allowlist matches prefix (e.g. /api/gateway/status under /api/gateway)', async () => {
    const ctx = makeCtx('http://localhost/api/gateway/status', {}, {
      'auth-guard': { header: 'x-oracle-token', allowlist: ['/api/gateway'] },
    });
    const res = await runRequest(ctx);
    expect(res).toBeUndefined();
  });

  it('ignores blank allowlist entries instead of bypassing every path', async () => {
    const ctx = makeCtx('http://localhost/api/search', {}, {
      'auth-guard': { header: 'x-oracle-token', allowlist: ['', '   ', '/api/health/'] },
    });
    const res = await runRequest(ctx);
    expect((res as Response).status).toBe(401);
  });

  it('trims configured header names and falls back from malformed names', async () => {
    const trimmed = makeCtx(
      'http://localhost/api/search',
      { headers: { 'x-oracle-token': 'secret' } },
      { 'auth-guard': { header: ' x-oracle-token ', expected: 'secret' } },
    );
    expect(await runRequest(trimmed)).toBeUndefined();

    const malformed = makeCtx(
      'http://localhost/api/search',
      { headers: { 'x-oracle-token': 'secret' } },
      { 'auth-guard': { header: 'bad header', expected: 'secret' } },
    );
    expect(await runRequest(malformed)).toBeUndefined();
  });

  it('defaults to header x-oracle-token when none specified', async () => {
    const ctx = makeCtx('http://localhost/api/search', {}, { 'auth-guard': {} });
    const res = await runRequest(ctx);
    expect((res as Response).status).toBe(401);
    const body = await (res as Response).json();
    expect(body.reason).toContain('x-oracle-token');
  });
});

describe('fts5-fallback hook', () => {
  let runError: (ctx: GatewayContext) => Promise<Response | void>;
  beforeAll(() => {
    const pipeline = loadHooks({ onError: ['fts5-fallback'] });
    runError = (ctx) => runHooks(pipeline.onError, ctx);
  });

  it('sets ctx.meta.fallback_to_local = true on proxy error', async () => {
    const ctx = makeCtx('http://localhost/api/search');
    ctx.error = new Error('connection refused');
    const res = await runError(ctx);
    expect(res).toBeUndefined(); // void return — gateway falls through
    expect(ctx.meta.fallback_to_local).toBe(true);
  });

  it('does not synthesize a Response (lets local routes handle)', async () => {
    const ctx = makeCtx('http://localhost/api/similar?id=42');
    ctx.error = new Error('timeout');
    const res = await runError(ctx);
    expect(res).toBeUndefined();
  });
});
