/**
 * /api/menu/source — setting, clearing, and the boot-read order.
 *
 * Split from a single 393-line file (#2833), per CLAUDE.md's "nested, one behavior per file".
 * Override mode, reset-all and the official-source endpoint live in
 * `gist-source-override.test.ts`.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { createMenuEndpoint } from '../../../src/routes/menu/menu.ts';
import { createMenuSourceAdminRoutes } from '../../../src/routes/menu/admin-source.ts';
import { setSetting, getSetting } from '../../../src/db/index.ts';
import { _resetMenuSource, getMenuConfig } from '../../../src/menu/config.ts';
import { MENU_GIST_SETTING_KEY } from '../../../src/menu/source-store.ts';
import { _clearGistCache, _setRetryDelays } from '../../../src/menu/gist.ts';

function buildApp() {
  return new Elysia({ prefix: '/api' })
    .use(createMenuEndpoint())
    .use(createMenuSourceAdminRoutes());
}

const ORIG_FETCH = globalThis.fetch;
const ORIG_ENV_GIST = process.env.ORACLE_MENU_GIST;
const ORIG_ENV_GIST_URL = process.env.ORACLE_MENU_GIST_URL;

function restoreFetch() {
  globalThis.fetch = ORIG_FETCH;
}

function resetAll() {
  _clearGistCache();
  _resetMenuSource();
  _setRetryDelays([1, 1, 1]);
  setSetting(MENU_GIST_SETTING_KEY, null);
  delete process.env.ORACLE_MENU_GIST;
  delete process.env.ORACLE_MENU_GIST_URL;
}

function restoreEnv() {
  if (ORIG_ENV_GIST !== undefined) process.env.ORACLE_MENU_GIST = ORIG_ENV_GIST;
  else delete process.env.ORACLE_MENU_GIST;
  if (ORIG_ENV_GIST_URL !== undefined) process.env.ORACLE_MENU_GIST_URL = ORIG_ENV_GIST_URL;
  else delete process.env.ORACLE_MENU_GIST_URL;
}

describe('POST /api/menu/source', () => {
  beforeEach(() => {
    resetAll();
  });
  afterEach(() => {
    restoreFetch();
    resetAll();
    restoreEnv();
  });

  test('persists gist URL via settings and returns source', async () => {
    globalThis.fetch = (async () => {
      const res = new Response(JSON.stringify({ items: [] }), { status: 200 });
      Object.defineProperty(res, 'url', {
        value:
          'https://gist.githubusercontent.com/natw/abcdef01/raw/aaaabbbbccccddddeeeeffff0000111122223333/menu.json',
      });
      return res;
    }) as typeof fetch;

    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/menu/source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://gist.github.com/natw/abcdef01' }),
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe('merge');
    expect(body.source.url).toBe('https://gist.github.com/natw/abcdef01');
    expect(body.source.status).toBe('ok');
    expect(body.source.hash).toBe('aaaabbbbccccddddeeeeffff0000111122223333');
    expect(getSetting(MENU_GIST_SETTING_KEY)).toBe(
      'https://gist.github.com/natw/abcdef01',
    );
  });

  test('rejects invalid URL with 400', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/menu/source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: 'https://not-a-gist.example.com/foo' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid gist URL/i);
    expect(getSetting(MENU_GIST_SETTING_KEY)).toBeNull();
  });

  test('rejects empty URL with 400', async () => {
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/menu/source', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: '   ' }),
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/required/i);
  });
});

describe('DELETE /api/menu/source', () => {
  beforeEach(() => {
    resetAll();
  });
  afterEach(() => {
    restoreFetch();
    resetAll();
    restoreEnv();
  });

  test('clears gist URL from settings and returns status:none', async () => {
    setSetting(MENU_GIST_SETTING_KEY, 'https://gist.github.com/natw/deadbeef01');
    const app = buildApp();
    const res = await app.handle(
      new Request('http://localhost/api/menu/source', { method: 'DELETE' }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('none');
    expect(body.url).toBeNull();
    expect(getSetting(MENU_GIST_SETTING_KEY)).toBeNull();
  });
});

describe('GET /api/menu/source boot-read order', () => {
  beforeEach(() => {
    resetAll();
  });
  afterEach(() => {
    restoreFetch();
    resetAll();
    restoreEnv();
  });

  test('settings row takes precedence over env var', async () => {
    setSetting(MENU_GIST_SETTING_KEY, 'https://gist.github.com/natw/dbaadbaa01');
    process.env.ORACLE_MENU_GIST_URL = 'https://gist.github.com/natw/efeffe0001';

    let capturedUrl = '';
    globalThis.fetch = (async (url: string) => {
      capturedUrl = url;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    const app = buildApp();
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    const body = await res.json();
    expect(body.url).toBe('https://gist.github.com/natw/dbaadbaa01');
    expect(capturedUrl).toContain('dbaadbaa01');
  });

  test('falls back to ORACLE_MENU_GIST_URL when settings empty', async () => {
    process.env.ORACLE_MENU_GIST_URL = 'https://gist.github.com/natw/ebfa11bac01';

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;

    const app = buildApp();
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    const body = await res.json();
    expect(body.url).toBe('https://gist.github.com/natw/ebfa11bac01');
  });

  test('falls back to legacy ORACLE_MENU_GIST when others empty', async () => {
    process.env.ORACLE_MENU_GIST = 'https://gist.github.com/natw/1e6ac1e0001';

    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), { status: 200 })) as typeof fetch;

    const app = buildApp();
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    const body = await res.json();
    expect(body.url).toBe('https://gist.github.com/natw/1e6ac1e0001');
  });

  test('getMenuConfig with no sources returns empty items and status:none', async () => {
    const result = await getMenuConfig();
    expect(result.items).toEqual([]);
  });
});

