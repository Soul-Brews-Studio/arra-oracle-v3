/**
 * The backend must serve the built React app — and must not shadow the API doing it.
 *
 * CLAUDE.md documented single-process production mode, but nothing implemented it:
 * `/settings`, `/plugins` and `/status` all 404'd with `frontend/dist/index.html`
 * present on disk. See #2831.
 *
 * The delicate part is `/`: it is the JSON root endpoint that `maw arra` and the
 * #2820 enrichment read. Serving the SPA there unconditionally would break them, so
 * the middleware content-negotiates. These tests pin BOTH sides of that.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  contentTypeFor,
  createSpaMiddleware,
  isReservedPath,
  safeAssetPath,
  wantsHtml,
} from '../../../src/middleware/spa.ts';

const INDEX_HTML = '<!doctype html><title>Arra</title><div id="root"></div>';
const ASSET_JS = 'export const built = true;';

let distDir = '';
let app: Elysia;

function get(path: string, accept?: string) {
  return app.handle(
    new Request(`http://local${path}`, accept ? { headers: { accept } } : undefined),
  );
}

beforeAll(() => {
  distDir = mkdtempSync(join(tmpdir(), 'spa-dist-'));
  writeFileSync(join(distDir, 'index.html'), INDEX_HTML);
  mkdirSync(join(distDir, 'assets'));
  writeFileSync(join(distDir, 'assets', 'app.js'), ASSET_JS);

  app = new Elysia()
    .use(createSpaMiddleware({ distDir }))
    .get('/', () => ({ server: 'arra-oracle-v3', status: 'ok' }))
    .get('/api/v1/health', () => ({ status: 'ok' }))
    .all('*', ({ set }) => {
      set.status = 404;
      return { error: 'Not Found' };
    });
});

afterAll(() => {
  // Leave the temp dir for inspection rather than deleting — nothing is deleted.
});

describe('SPA serving', () => {
  test('a browser deep link gets the app shell instead of 404', async () => {
    const res = await get('/settings', 'text/html,application/xhtml+xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('<div id="root">');
  });

  test('a nested deep link also gets the shell', async () => {
    const res = await get('/tools/config', 'text/html');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<div id="root">');
  });

  test('build assets are served regardless of Accept', async () => {
    const res = await get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(await res.text()).toBe(ASSET_JS);
  });
});

describe('SPA must not shadow the API', () => {
  test('/ still returns JSON for non-browser clients', async () => {
    const res = await get('/');
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toMatchObject({ server: 'arra-oracle-v3' });
  });

  test('/ returns JSON even when the client sends */*', async () => {
    const res = await get('/', '*/*');
    expect(await res.json()).toMatchObject({ server: 'arra-oracle-v3' });
  });

  test('a browser visiting / gets the app, not the JSON root', async () => {
    const res = await get('/', 'text/html,*/*;q=0.8');
    expect(await res.text()).toContain('<div id="root">');
  });

  test('an unknown API path still 404s as JSON, never as HTML', async () => {
    // Serving HTML here would turn a routing bug into a parse error at the caller.
    const res = await get('/api/v1/does-not-exist', 'text/html');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'Not Found' });
  });

  test('a known API route is untouched by the middleware', async () => {
    const res = await get('/api/v1/health', 'text/html');
    expect(await res.json()).toMatchObject({ status: 'ok' });
  });

  test('POST is never intercepted', async () => {
    const res = await app.handle(
      new Request('http://local/settings', { method: 'POST', headers: { accept: 'text/html' } }),
    );
    expect(res.status).toBe(404);
  });
});

describe('helpers', () => {
  test('only an explicit text/html preference counts as a browser', () => {
    expect(wantsHtml(new Request('http://x/', { headers: { accept: 'text/html' } }))).toBe(true);
    expect(wantsHtml(new Request('http://x/', { headers: { accept: '*/*' } }))).toBe(false);
    expect(wantsHtml(new Request('http://x/', { headers: { accept: 'application/json' } }))).toBe(false);
    expect(wantsHtml(new Request('http://x/'))).toBe(false);
  });

  test('reserved prefixes are excluded, lookalikes are not', () => {
    expect(isReservedPath('/api')).toBe(true);
    expect(isReservedPath('/api/v1/health')).toBe(true);
    expect(isReservedPath('/mcp')).toBe(true);
    expect(isReservedPath('/simple')).toBe(true);
    expect(isReservedPath('/settings')).toBe(false);
    expect(isReservedPath('/apixyz')).toBe(false);
  });

  test('path traversal is contained inside the dist directory', () => {
    // The security property is CONTAINMENT, not rejection. `normalize` collapses
    // leading `..` on an absolute path, so a traversal attempt lands on a path
    // inside dist that simply does not exist — the request then falls through.
    // An earlier revision of this test asserted `toBeNull()` and went red; the
    // probe was wrong, not the code.
    for (const attempt of [
      '/../../etc/passwd',
      '/assets/%2e%2e%2f%2e%2e%2fetc/passwd',
      '/assets/../../../../etc/passwd',
    ]) {
      const resolved = safeAssetPath('/tmp/dist', attempt);
      expect(resolved).not.toBeNull();
      expect(resolved!.startsWith('/tmp/dist/')).toBe(true);
      expect(resolved).not.toBe('/etc/passwd');
    }
    expect(safeAssetPath('/tmp/dist', '/assets/app.js')).toBe('/tmp/dist/assets/app.js');
    // A NUL byte is rejected outright rather than contained.
    expect(safeAssetPath('/tmp/dist', '/assets/app.js\0.png')).toBeNull();
  });

  test('a traversal attempt does not serve a file from outside dist', async () => {
    // End-to-end proof of the property above, through the real middleware.
    const res = await get('/assets/../../../../etc/passwd', 'text/html');
    const body = await res.text();
    expect(body).not.toContain('root:');
    expect(body).toContain('<div id="root">'); // fell through to the app shell
  });

  test('content types cover the build output', () => {
    expect(contentTypeFor('/a.js')).toContain('text/javascript');
    expect(contentTypeFor('/a.css')).toContain('text/css');
    expect(contentTypeFor('/a.woff2')).toBe('font/woff2');
    expect(contentTypeFor('/noext')).toBe('application/octet-stream');
  });
});
