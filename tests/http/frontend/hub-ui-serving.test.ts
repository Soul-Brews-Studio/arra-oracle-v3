/** The arra hub UI (#3110) is a second app: /hub and /hub/* get hub.html, everything else keeps index.html. */
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
  writeFileSync(join(distDir, 'hub.html'), '<title>arra hub</title>');
  app = new Elysia().use(createSpaMiddleware({ distDir })).get('/api/arra/status', () => ({ ok: true }));
});

describe('hub UI shell', () => {
  test('/hub and /hub/nodes serve hub.html', async () => {
    for (const path of ['/hub', '/hub/', '/hub/nodes']) expect(await (await html(path)).text()).toContain('arra hub');
  });
  test('other pages keep the dashboard shell', async () => {
    expect(await (await html('/settings')).text()).toContain('<title>Arra</title>');
    expect(await (await html('/hubs')).text()).toContain('<title>Arra</title>');
  });
  test('the API is never shadowed', async () => {
    expect(await (await html('/api/arra/status')).json()).toEqual({ ok: true });
  });
});
