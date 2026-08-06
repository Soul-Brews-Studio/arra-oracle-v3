import { afterAll, expect, test } from 'bun:test';
import { eq, like } from 'drizzle-orm';
import fs from 'fs';
import path from 'path';
import { db, menuItems, setSetting } from '../../../src/db/index.ts';
import { _resetMenuSource } from '../../../src/menu/config.ts';
import { CUSTOM_MENU_FILE } from '../../../src/menu/custom-store.ts';
import { _clearGistCache } from '../../../src/menu/gist.ts';
import { createTenantFetch, TENANT_HEADER } from '../../../src/middleware/tenant.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';

const ORIGINAL_FETCH = globalThis.fetch;
const app = createMenuRoutes();
const handleTenant = createTenantFetch((request) => app.handle(request));
const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-a-${stamp}`;
const tenantB = `tenant-b-${stamp}`;

function tenantRequest(tenantId: string, pathname: string, init: RequestInit = {}) {
  return handleTenant(new Request(`http://local${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', [TENANT_HEADER]: tenantId, ...(init.headers ?? {}) },
  }));
}

async function json<T = any>(response: Response): Promise<T> {
  const text = await response.text();
  return text ? JSON.parse(text) as T : null as T;
}

async function postMenuItem(tenantId: string, slug: string) {
  const response = await tenantRequest(tenantId, '/api/menu/items', {
    method: 'POST',
    body: JSON.stringify({ path: `/${slug}`, label: slug, groupKey: 'tools' }),
  });
  expect(response.status).toBe(201);
  return json<{ id: number; path: string }>(response);
}

afterAll(() => {
  db.delete(menuItems).where(like(menuItems.path, `%${stamp}%`)).run();
  setSetting(`tenant:${tenantA}:menu_gist_url`, null);
  setSetting(`tenant:${tenantB}:menu_gist_url`, null);
  _clearGistCache();
  _resetMenuSource();
  globalThis.fetch = ORIGINAL_FETCH;
  for (const tenantId of [tenantA, tenantB]) {
    const tenantDir = path.join(path.dirname(CUSTOM_MENU_FILE), 'tenants', tenantId);
    if (fs.existsSync(tenantDir)) fs.rmSync(tenantDir, { recursive: true });
  }
});

function stubGistFetch() {
  globalThis.fetch = (async () => {
    const response = new Response(JSON.stringify({ items: [] }), { status: 200 });
    Object.defineProperty(response, 'url', {
      value: 'https://gist.githubusercontent.com/natw/abcdef01/raw/feedface/menu.json',
    });
    return response;
  }) as typeof fetch;
}

test('menu DB routes list only rows visible to the active tenant', async () => {
  const itemA = await postMenuItem(tenantA, `tenant-a-menu-${stamp}`);
  const itemB = await postMenuItem(tenantB, `tenant-b-menu-${stamp}`);

  const storedA = db.select().from(menuItems).where(eq(menuItems.id, itemA.id)).get();
  expect(storedA?.tenantId).toBe(tenantA);

  const list = await json<{ items: Array<{ path: string }> }>(
    await tenantRequest(tenantA, '/api/menu/items'),
  );
  const paths = list.items.map((item) => item.path);
  expect(paths).toContain(itemA.path);
  expect(paths).not.toContain(itemB.path);

  const search = await json<{ data: Array<{ path: string }> }>(
    await tenantRequest(tenantA, `/api/menu/search?q=${encodeURIComponent(stamp)}`),
  );
  const searchPaths = search.data.map((item) => item.path);
  expect(searchPaths).toContain(itemA.path);
  expect(searchPaths).not.toContain(itemB.path);

  const denied = await tenantRequest(tenantA, `/api/menu/items/${itemB.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ label: 'cross tenant edit' }),
  });
  expect(denied.status).toBe(404);
});

test('file-backed custom menu items use tenant-specific files', async () => {
  const pathA = `/tenant-a-custom-${stamp}`;
  const pathB = `/tenant-b-custom-${stamp}`;

  expect((await tenantRequest(tenantA, '/api/menu/custom', {
    method: 'POST',
    body: JSON.stringify({ path: pathA, label: `A ${stamp}` }),
  })).status).toBe(201);
  expect((await tenantRequest(tenantB, '/api/menu/custom', {
    method: 'POST',
    body: JSON.stringify({ path: pathB, label: `B ${stamp}` }),
  })).status).toBe(201);

  const list = await json<{ items: Array<{ path: string }> }>(
    await tenantRequest(tenantA, '/api/menu/custom'),
  );
  const customPaths = list.items.map((item) => item.path);
  expect(customPaths).toContain(pathA);
  expect(customPaths).not.toContain(pathB);

  const tenantFile = path.join(path.dirname(CUSTOM_MENU_FILE), 'tenants', tenantA, 'custom-menu.json');
  expect(fs.existsSync(tenantFile)).toBe(true);
});

test('menu source settings stay tenant-specific', async () => {
  stubGistFetch();
  const urlA = 'https://gist.github.com/natw/abcdef01';
  const urlB = 'https://gist.github.com/natw/abcdef02';

  expect((await tenantRequest(tenantA, '/api/menu/source', {
    method: 'POST',
    body: JSON.stringify({ url: urlA }),
  })).status).toBe(200);
  expect((await tenantRequest(tenantB, '/api/menu/source', {
    method: 'POST',
    body: JSON.stringify({ url: urlB }),
  })).status).toBe(200);

  const sourceA = await json<{ url: string | null }>(
    await tenantRequest(tenantA, '/api/menu/source'),
  );
  const sourceB = await json<{ url: string | null }>(
    await tenantRequest(tenantB, '/api/menu/source'),
  );

  expect(sourceA.url).toBe(urlA);
  expect(sourceB.url).toBe(urlB);
});
