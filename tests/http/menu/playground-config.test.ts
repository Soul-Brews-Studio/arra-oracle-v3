/**
 * Regression — Playground row (route-sourced, /playground, group='main') must
 * accept the same PATCH operations the /menu editor emits: toggle enabled,
 * rename, move to another group, and reorder via position.
 *
 * Guards against issue #929 Part B symptom: "Playground item cannot be
 * configured — changes fail silently or do not persist."
 *
 * Covers hypotheses 1, 3, 7, 8 from the issue:
 *   H1. PATCH body accepts native `{ enabled: boolean }`
 *   H3. :id param coerces from string to int
 *   H7. Seeder preserves touchedAt!=null on re-run (user edit wins)
 *   H8. All editor-emitted partial bodies are accepted by TypeBox schema
 *
 * Also verifies aggregated `/api/menu` reflects DB mutations — the live nav
 * surface that studio's Header reads.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { db, menuItems } from '../../../src/db/index.ts';
import { seedMenuItems } from '../../../src/db/seeders/menu-seeder.ts';

function clearMenu() {
  db.delete(menuItems).run();
}

function playgroundSource() {
  // Mirrors the real route shape — /api/reflect declares its /playground
  // frontend target directly in detail.menu metadata.
  return new Elysia({ prefix: '/api' })
    .get('/reflect', () => ({}), {
      detail: { menu: { group: 'main', path: '/playground', order: 30 }, summary: 'Playground' },
    });
}

async function call(
  app: Elysia,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: any }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

function getPlayground() {
  return db.select().from(menuItems).where(eq(menuItems.path, '/playground')).get()!;
}

describe('PATCH /api/menu/items/:id — Playground row (issue #929 Part B)', () => {
  beforeEach(() => clearMenu());

  test('toggle enabled=false persists and aggregated /api/menu drops the row', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    expect(row.enabled).toBe(true);
    expect(row.source).toBe('route');

    const app = createMenuRoutes();
    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      enabled: false,
    });
    expect(status).toBe(200);
    expect(json.enabled).toBe(false);
    expect(json.touchedAt).toBeGreaterThan(0);

    expect(getPlayground().enabled).toBe(false);

    const menu = await call(app, 'GET', '/api/menu');
    expect(menu.status).toBe(200);
    expect(menu.json.items.find((i: any) => i.path === '/playground')).toBeUndefined();
  });

  test('toggle enabled=true re-enables and aggregated /api/menu includes the row', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    await call(app, 'PATCH', `/api/menu/items/${row.id}`, { enabled: false });
    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      enabled: true,
    });
    expect(status).toBe(200);
    expect(json.enabled).toBe(true);

    const menu = await call(app, 'GET', '/api/menu');
    expect(menu.json.items.find((i: any) => i.path === '/playground')).toBeDefined();
  });

  test('rename label persists and is visible in aggregated /api/menu', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      label: 'PG Renamed',
    });
    expect(status).toBe(200);
    expect(json.label).toBe('PG Renamed');

    const menu = await call(app, 'GET', '/api/menu');
    const pg = menu.json.items.find((i: any) => i.path === '/playground');
    expect(pg?.label).toBe('PG Renamed');
  });

  test('move to different group persists', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      groupKey: 'tools',
    });
    expect(status).toBe(200);
    expect(json.groupKey).toBe('tools');

    const menu = await call(app, 'GET', '/api/menu');
    const pg = menu.json.items.find((i: any) => i.path === '/playground');
    expect(pg?.group).toBe('tools');
  });

  test('position change persists across fetch', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      position: 5,
    });
    expect(status).toBe(200);
    expect(json.position).toBe(5);

    const list = await call(app, 'GET', '/api/menu/items');
    const pg = list.json.items.find((i: any) => i.path === '/playground');
    expect(pg.position).toBe(5);
  });

  test('native boolean body (not 0/1) is accepted — H1 regression', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    // This is the exact body shape MenuEditor emits (JSON.stringify of a JS
    // boolean → `false`, not `0`). SQLite via Drizzle mode:'boolean' must
    // round-trip without coercion errors.
    const { status } = await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      enabled: false,
    });
    expect(status).toBe(200);
  });

  test('seeder preserves user edit on re-run — H7 regression', async () => {
    seedMenuItems([playgroundSource()]);
    const row = getPlayground();
    const app = createMenuRoutes();

    await call(app, 'PATCH', `/api/menu/items/${row.id}`, {
      label: 'User Edit',
      enabled: false,
      groupKey: 'tools',
    });

    // Second seeder run (simulates server reboot)
    seedMenuItems([playgroundSource()]);

    const after = getPlayground();
    expect(after.label).toBe('User Edit');
    expect(after.enabled).toBe(false);
    expect(after.groupKey).toBe('tools');
  });
});
