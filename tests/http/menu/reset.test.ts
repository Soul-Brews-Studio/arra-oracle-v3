/**
 * Menu admin — POST /api/menu/reset/:id.
 *
 * Resetting a route-sourced row clears touchedAt so the next boot
 * seed run re-applies the current route metadata (label, position,
 * group, access, icon).
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

function routeSource(label = 'Search', order = 10) {
  return new Elysia({ prefix: '/api' }).get('/search', () => ({}), {
    detail: { menu: { group: 'main', path: '/search', order, label }, summary: 'Search' },
  });
}

async function post(app: Elysia, path: string, body?: unknown) {
  const init: RequestInit = { method: 'POST' };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('POST /api/menu/reset/:id', () => {
  beforeEach(() => clearMenu());

  test('clears touchedAt on a previously user-edited row', async () => {
    seedMenuItems([routeSource()]);
    const row = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/search'))
      .get()!;

    const now = new Date();
    db.update(menuItems)
      .set({ label: 'My Search', touchedAt: now, updatedAt: now })
      .where(eq(menuItems.id, row.id))
      .run();
    const touched = db.select().from(menuItems).where(eq(menuItems.id, row.id)).get()!;
    expect(touched.touchedAt).not.toBeNull();

    const app = createMenuRoutes();
    const { status, json } = await post(app, `/api/menu/reset/${row.id}`);
    expect(status).toBe(200);
    expect(json.touchedAt).toBeNull();

    const after = db.select().from(menuItems).where(eq(menuItems.id, row.id)).get();
    expect(after?.touchedAt).toBeNull();
  });

  test('after reset, re-seeding restores the current route defaults', async () => {
    seedMenuItems([routeSource('Search', 10)]);
    const row = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/search'))
      .get()!;

    const now = new Date();
    db.update(menuItems)
      .set({ label: 'User Rename', position: 77, touchedAt: now, updatedAt: now })
      .where(eq(menuItems.id, row.id))
      .run();

    const preReseed = seedMenuItems([routeSource('Search', 10)]);
    expect(preReseed.preserved).toBe(1);

    const app = createMenuRoutes();
    await post(app, `/api/menu/reset/${row.id}`);

    const postReseed = seedMenuItems([routeSource('Search', 10)]);
    expect(postReseed.updated).toBe(1);

    const after = db.select().from(menuItems).where(eq(menuItems.id, row.id)).get();
    expect(after?.label).toBe('Search');
    expect(after?.position).toBe(10);
  });

  test('400 when target row is not route-sourced', async () => {
    const app = createMenuRoutes();
    const created = await post(app, '/api/menu/items', {
      path: '/custom-reset',
      label: 'C',
    });
    const { status, json } = await post(app, `/api/menu/reset/${created.json.id}`);
    expect(status).toBe(400);
    expect(json.error).toMatch(/route-sourced/);
  });

  test('404 on unknown id', async () => {
    const app = createMenuRoutes();
    const { status } = await post(app, '/api/menu/reset/99999');
    expect(status).toBe(404);
  });
});
