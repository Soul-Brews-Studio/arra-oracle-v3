/**
 * Menu admin — POST /api/menu/reorder.
 *
 * Verifies: bulk update applies to all listed rows, each row gets
 * touchedAt=now, and any missing id rolls back the entire batch
 * (Drizzle transaction semantics).
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

function sampleSource() {
  return new Elysia({ prefix: '/api' })
    .get('/search', () => ({}), {
      detail: { menu: { group: 'main', path: '/search', order: 10 }, summary: 'Search' },
    })
    .get('/traces', () => ({}), {
      detail: { menu: { group: 'main', path: '/traces', order: 40 }, summary: 'Traces' },
    })
    .get('/map', () => ({}), {
      detail: { menu: { group: 'tools', path: '/map', order: 20 }, summary: 'Map' },
    });
}

async function post(app: Elysia, path: string, body: unknown) {
  const res = await app.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

describe('POST /api/menu/reorder', () => {
  beforeEach(() => clearMenu());

  test('updates position + parentId for every listed row', async () => {
    seedMenuItems([sampleSource()]);
    const rows = db.select().from(menuItems).all();
    const search = rows.find((r) => r.path === '/search')!;
    const traces = rows.find((r) => r.path === '/traces')!;
    const map = rows.find((r) => r.path === '/map')!;

    const app = createMenuRoutes();
    const { status, json } = await post(app, '/api/menu/reorder', {
      items: [
        { id: search.id, parentId: null, position: 1 },
        { id: traces.id, parentId: search.id, position: 2 },
        { id: map.id, parentId: null, position: 3 },
      ],
    });
    expect(status).toBe(200);
    expect(json.updated).toBe(3);

    const after = db.select().from(menuItems).all();
    const afterSearch = after.find((r) => r.id === search.id)!;
    const afterTraces = after.find((r) => r.id === traces.id)!;
    const afterMap = after.find((r) => r.id === map.id)!;
    expect(afterSearch.position).toBe(1);
    expect(afterTraces.position).toBe(2);
    expect(afterTraces.parentId).toBe(search.id);
    expect(afterMap.position).toBe(3);
  });

  test('sets touchedAt=now on every modified row', async () => {
    seedMenuItems([sampleSource()]);
    const before = db.select().from(menuItems).all();
    expect(before.every((r) => r.touchedAt === null)).toBe(true);

    const app = createMenuRoutes();
    await post(app, '/api/menu/reorder', {
      items: before.map((r, i) => ({ id: r.id, position: i })),
    });

    const after = db.select().from(menuItems).all();
    for (const row of after) {
      expect(row.touchedAt).not.toBeNull();
    }
  });

  test('rolls back the entire batch when any id is missing', async () => {
    seedMenuItems([sampleSource()]);
    const rows = db.select().from(menuItems).all();
    const search = rows.find((r) => r.path === '/search')!;
    const map = rows.find((r) => r.path === '/map')!;

    const app = createMenuRoutes();
    const { status } = await post(app, '/api/menu/reorder', {
      items: [
        { id: search.id, position: 100 },
        { id: 999999, position: 101 },
        { id: map.id, position: 102 },
      ],
    });
    expect(status).toBe(400);

    const afterSearch = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, search.id))
      .get();
    const afterMap = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, map.id))
      .get();
    expect(afterSearch?.position).toBe(10);
    expect(afterMap?.position).toBe(20);
    expect(afterSearch?.touchedAt).toBeNull();
    expect(afterMap?.touchedAt).toBeNull();
  });

  test('accepts an empty items array as a no-op', async () => {
    const app = createMenuRoutes();
    const { status, json } = await post(app, '/api/menu/reorder', { items: [] });
    expect(status).toBe(200);
    expect(json.updated).toBe(0);
  });
});
