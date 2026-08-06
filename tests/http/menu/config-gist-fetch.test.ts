/**
 * /api/menu configuration — gist fetching, retry/fallback, and the source + reload endpoints.
 *
 * Split from a single 322-line file (#2833). Item assembly and URL parsing live in
 * `config.test.ts`. These tests replace `globalThis.fetch`, which is why the setup below
 * restores it in `afterEach` — `--isolate` gives each FILE a fresh global, but not each test.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';
import { createMenuEndpoint } from '../../../src/routes/menu/menu.ts';
import {
  fetchGistMenu,
  invalidateGistCache,
  _clearGistCache,
  _setRetryDelays,
} from '../../../src/menu/gist.ts';
import { _resetMenuSource } from '../../../src/menu/config.ts';

const ORIG_FETCH = globalThis.fetch;
const ORIG_ENV_GIST = process.env.ORACLE_MENU_GIST;

function restoreFetch() {
  globalThis.fetch = ORIG_FETCH;
}

function resetState() {
  _clearGistCache();
  _resetMenuSource();
  _setRetryDelays([1, 1, 1]);
}

describe('fetchGistMenu', () => {
  beforeEach(() => {
    resetState();
  });
  afterEach(() => {
    restoreFetch();
    resetState();
  });

  test('fetches and parses gist JSON, extracts hash from redirect URL', async () => {
    const payload = {
      items: [{ path: '/lab', label: 'Lab', group: 'tools', order: 90, source: 'page' }],
      disable: ['/superseded'],
    };
    let called = '';
    globalThis.fetch = (async (url: string) => {
      called = url;
      const res = new Response(JSON.stringify(payload), { status: 200 });
      Object.defineProperty(res, 'url', {
        value:
          'https://gist.githubusercontent.com/natw/abc123def456/raw/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4/menu.json',
      });
      return res;
    }) as typeof fetch;

    const result = await fetchGistMenu('https://gist.github.com/natw/abc123def456');
    expect(called).toBe('https://gist.githubusercontent.com/natw/abc123def456/raw/');
    expect(result?.data).toEqual(payload);
    expect(result?.hash).toBe('a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4');
    expect(result?.stale).toBe(false);
  });

  test('honors hash pin in URL', async () => {
    let called = '';
    globalThis.fetch = (async (url: string) => {
      called = url;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;
    const url =
      'https://gist.github.com/natw/abc123def456/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4';
    const result = await fetchGistMenu(url);
    expect(called).toBe(
      'https://gist.githubusercontent.com/natw/abc123def456/raw/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4/',
    );
    expect(result?.hash).toBe('a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4');
  });

  test('hash-pinned URL caches indefinitely', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;
    const url =
      'https://gist.github.com/natw/abc123def456/a1b2c3d4e5f67890a1b2c3d4e5f67890a1b2c3d4';
    await fetchGistMenu(url);
    await fetchGistMenu(url);
    await fetchGistMenu(url);
    expect(callCount).toBe(1);
  });

  test('retries 3x then returns null on unreachable (no LKG)', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      throw new Error('ENOTFOUND');
    }) as typeof fetch;
    const result = await fetchGistMenu('https://gist.github.com/natw/deadbeef00');
    expect(result).toBeNull();
    expect(callCount).toBe(4); // 1 initial + 3 retries
  });

  test('falls back to last-known-good on failure with stale flag', async () => {
    const payload = {
      items: [{ path: '/keep', label: 'Keep', group: 'tools', order: 1, source: 'page' }],
    };
    let shouldFail = false;
    globalThis.fetch = (async () => {
      if (shouldFail) throw new Error('ENOTFOUND');
      return new Response(JSON.stringify(payload), { status: 200 });
    }) as typeof fetch;

    const first = await fetchGistMenu('https://gist.github.com/natw/lkg00000000');
    expect(first?.stale).toBe(false);

    invalidateGistCache('https://gist.github.com/natw/lkg00000000');
    shouldFail = true;
    const second = await fetchGistMenu('https://gist.github.com/natw/lkg00000000');
    expect(second?.stale).toBe(true);
    expect(second?.data).toEqual(payload);
  });

  test('non-200 response returns null (after retries)', async () => {
    globalThis.fetch = (async () =>
      new Response('not found', { status: 404 })) as typeof fetch;
    const result = await fetchGistMenu('https://gist.github.com/natw/fourofour0');
    expect(result).toBeNull();
  });

  test('caches unpinned results across calls within TTL', async () => {
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;
    await fetchGistMenu('https://gist.github.com/natw/cache01');
    await fetchGistMenu('https://gist.github.com/natw/cache01');
    expect(callCount).toBe(1);
  });
});

describe('/api/menu/source and /api/menu/reload', () => {
  beforeEach(() => {
    resetState();
    delete process.env.ORACLE_MENU_GIST;
  });
  afterEach(() => {
    restoreFetch();
    resetState();
    if (ORIG_ENV_GIST !== undefined) process.env.ORACLE_MENU_GIST = ORIG_ENV_GIST;
    else delete process.env.ORACLE_MENU_GIST;
  });

  test('source returns status:none when no gist configured', async () => {
    const app = new Elysia({ prefix: '/api' }).use(createMenuEndpoint());
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ url: null, hash: null, loaded_at: null, status: 'none' });
  });

  test('source reports ok + hash after successful fetch', async () => {
    process.env.ORACLE_MENU_GIST = 'https://gist.github.com/natw/sourceok01';
    globalThis.fetch = (async () => {
      const res = new Response(JSON.stringify({ items: [] }), { status: 200 });
      Object.defineProperty(res, 'url', {
        value:
          'https://gist.githubusercontent.com/natw/sourceok01/raw/aaaabbbbccccddddeeeeffff0000111122223333/menu.json',
      });
      return res;
    }) as typeof fetch;

    const app = new Elysia({ prefix: '/api' }).use(createMenuEndpoint());
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    const body = await res.json();
    expect(body.url).toBe('https://gist.github.com/natw/sourceok01');
    expect(body.hash).toBe('aaaabbbbccccddddeeeeffff0000111122223333');
    expect(body.status).toBe('ok');
    expect(typeof body.loaded_at).toBe('number');
  });

  test('source reports error when gist unreachable and no LKG', async () => {
    process.env.ORACLE_MENU_GIST = 'https://gist.github.com/natw/sourcefail1';
    globalThis.fetch = (async () => {
      throw new Error('ENOTFOUND');
    }) as typeof fetch;

    const app = new Elysia({ prefix: '/api' }).use(createMenuEndpoint());
    await app.handle(new Request('http://localhost/api/menu'));
    const res = await app.handle(new Request('http://localhost/api/menu/source'));
    const body = await res.json();
    expect(body.status).toBe('error');
  });

  test('reload forces refetch and returns fresh source', async () => {
    process.env.ORACLE_MENU_GIST = 'https://gist.github.com/natw/reload00001';
    let callCount = 0;
    globalThis.fetch = (async () => {
      callCount += 1;
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    }) as typeof fetch;

    const app = new Elysia({ prefix: '/api' }).use(createMenuEndpoint());
    await app.handle(new Request('http://localhost/api/menu'));
    await app.handle(new Request('http://localhost/api/menu')); // cached
    expect(callCount).toBe(1);

    const reloadRes = await app.handle(
      new Request('http://localhost/api/menu/reload', { method: 'POST' }),
    );
    expect(reloadRes.status).toBe(200);
    const body = await reloadRes.json();
    expect(body.status).toBe('ok');
    expect(callCount).toBe(2);
  });
});
