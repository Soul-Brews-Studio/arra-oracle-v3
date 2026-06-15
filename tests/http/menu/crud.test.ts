/**
 * Menu admin CRUD — tree, list, create, patch, delete.
 *
 * Covers the full lifecycle of custom + route-sourced rows, including the
 * soft-vs-hard delete split and the touchedAt=now invariant on edits.
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
      detail: { menu: { group: 'main', order: 10 }, summary: 'Search' },
    })
    .get('/traces', () => ({}), {
      detail: { menu: { group: 'main', order: 40 }, summary: 'Traces' },
    })
    .get('/map', () => ({}), {
      detail: { menu: { group: 'tools', order: 20 }, summary: 'Map' },
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

describe('GET /api/menu/tree', () => {
  beforeEach(() => clearMenu());

  test('returns all rows nested by parent_id', async () => {
    seedMenuItems([sampleSource()]);
    const app = createMenuRoutes();

    const rows = db.select().from(menuItems).all();
    const search = rows.find((r) => r.path === '/search')!;
    db.update(menuItems)
      .set({ parentId: search.id })
      .where(eq(menuItems.path, '/traces'))
      .run();

    const { status, json } = await call(app, 'GET', '/api/menu/tree');
    expect(status).toBe(200);
    const root = json.items.find((i: any) => i.path === '/search');
    expect(root).toBeDefined();
    expect(root.children.map((c: any) => c.path)).toContain('/traces');
  });
});

describe('GET /api/menu/items', () => {
  beforeEach(() => clearMenu());

  test('lists every DB field incl. touchedAt / source / enabled', async () => {
    seedMenuItems([sampleSource()]);
    const app = createMenuRoutes();
    const { status, json } = await call(app, 'GET', '/api/menu/items');
    expect(status).toBe(200);
    expect(json.items).toHaveLength(3);
    const search = json.items.find((i: any) => i.path === '/search');
    expect(search).toMatchObject({
      label: 'Search',
      groupKey: 'main',
      position: 10,
      enabled: true,
      source: 'route',
      touchedAt: null,
    });
  });
});

describe('POST /api/menu/items (create custom)', () => {
  beforeEach(() => clearMenu());

  test('creates a custom row with source=custom and touchedAt set', async () => {
    const app = createMenuRoutes();
    const { status, json } = await call(app, 'POST', '/api/menu/items', {
      path: '/my-page',
      label: 'My Page',
      groupKey: 'tools',
      position: 50,
    });
    expect(status).toBe(201);
    expect(json.source).toBe('custom');
    expect(json.path).toBe('/my-page');
    expect(json.touchedAt).toBeGreaterThan(0);

    const row = db.select().from(menuItems).where(eq(menuItems.path, '/my-page')).get();
    expect(row?.source).toBe('custom');
    expect(row?.touchedAt).not.toBeNull();
  });

  test('returns 409 on duplicate path', async () => {
    const app = createMenuRoutes();
    await call(app, 'POST', '/api/menu/items', { path: '/dup', label: 'Dup' });
    const dup = await call(app, 'POST', '/api/menu/items', { path: '/dup', label: 'Dup 2' });
    expect(dup.status).toBe(409);
  });
});

describe('PATCH /api/menu/items/:id', () => {
  beforeEach(() => clearMenu());

  test('edits fields and sets touchedAt=now', async () => {
    seedMenuItems([sampleSource()]);
    const before = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/search'))
      .get()!;
    expect(before.touchedAt).toBeNull();

    const app = createMenuRoutes();
    const { status, json } = await call(app, 'PATCH', `/api/menu/items/${before.id}`, {
      label: 'Find',
      position: 5,
    });
    expect(status).toBe(200);
    expect(json.label).toBe('Find');
    expect(json.position).toBe(5);
    expect(json.touchedAt).toBeGreaterThan(0);
  });

  test('404 on unknown id', async () => {
    const app = createMenuRoutes();
    const { status } = await call(app, 'PATCH', '/api/menu/items/99999', { label: 'x' });
    expect(status).toBe(404);
  });
});

describe('DELETE /api/menu/items/:id', () => {
  beforeEach(() => clearMenu());

  test('soft-deletes route-sourced rows (enabled=false)', async () => {
    seedMenuItems([sampleSource()]);
    const row = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/map'))
      .get()!;

    const app = createMenuRoutes();
    const { status, json } = await call(app, 'DELETE', `/api/menu/items/${row.id}`);
    expect(status).toBe(200);
    expect(json.deleted).toBe('soft');

    const after = db.select().from(menuItems).where(eq(menuItems.id, row.id)).get();
    expect(after?.enabled).toBe(false);
  });

  test('hard-deletes custom rows', async () => {
    const app = createMenuRoutes();
    const created = await call(app, 'POST', '/api/menu/items', {
      path: '/custom-x',
      label: 'X',
    });
    const { status, json } = await call(app, 'DELETE', `/api/menu/items/${created.json.id}`);
    expect(status).toBe(200);
    expect(json.deleted).toBe('hard');
    const after = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.id, created.json.id))
      .get();
    expect(after).toBeUndefined();
  });

  test('404 on unknown id', async () => {
    const app = createMenuRoutes();
    const { status } = await call(app, 'DELETE', '/api/menu/items/99999');
    expect(status).toBe(404);
  });
});

describe('POST/PUT/DELETE /api/menu', () => {
  beforeEach(() => clearMenu());

  test('creates, updates, then soft-deletes a menu row', async () => {
    const app = createMenuRoutes();
    const created = await call(app, 'POST', '/api/menu', {
      path: '/crud-alias',
      label: 'CRUD Alias',
      groupKey: 'tools',
    });
    expect(created.status).toBe(201);
    expect(created.json).toMatchObject({ path: '/crud-alias', source: 'custom' });

    const updated = await call(app, 'PUT', `/api/menu/${created.json.id}`, {
      label: 'CRUD Updated',
      position: 7,
    });
    expect(updated.status).toBe(200);
    expect(updated.json).toMatchObject({ label: 'CRUD Updated', position: 7 });

    const deleted = await call(app, 'DELETE', `/api/menu/${created.json.id}`);
    expect(deleted.status).toBe(200);
    expect(deleted.json.deleted).toBe('soft');
    const row = db.select().from(menuItems).where(eq(menuItems.id, created.json.id)).get();
    expect(row?.enabled).toBe(false);
  });
});
