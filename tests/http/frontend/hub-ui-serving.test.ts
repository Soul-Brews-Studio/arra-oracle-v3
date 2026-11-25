/** The arra hub UI (#3110) is a Studio route: /hub gets the one Studio shell, and a stray hub.html is never used. */
import { beforeAll, describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSpaMiddleware } from '../../../src/middleware/spa.ts';

let app: Elysia;
const html = (path: string) => app.handle(new Request(`http://local${path}`, { headers: { accept: 'text/html' } }));

beforeAll(() => {
  const distDir = mkdtempSync(join(tmpdir(), 'hub-ui-dist-'));
  writeFileSync(join(distDir, 'index.html'), '<title>Arra</title>');
  writeFileSync(join(distDir, 'hub.html'), '<title>old separate hub app</title>');
  app = new Elysia().use(createSpaMiddleware({ distDir })).get('/api/arra/status', () => ({ ok: true }));
});

describe('hub UI shell', () => {
  test('/hub and /hub/* serve the Studio shell, not a separate hub.html', async () => {
    for (const path of ['/hub', '/hub/', '/hub/nodes']) {
      const body = await (await html(path)).text();
      expect(body).toContain('<title>Arra</title>');
      expect(body).not.toContain('old separate hub app');
    }
  });
  test('other pages keep the same shell', async () => {
    expect(await (await html('/settings')).text()).toContain('<title>Arra</title>');
  });
  test('the API is never shadowed', async () => {
    expect(await (await html('/api/arra/status')).json()).toEqual({ ok: true });
  });
});
