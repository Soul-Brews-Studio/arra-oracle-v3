/**
 * Tests for the menu_items seeder + DB-backed /api/menu endpoint.
 *
 * Covers:
 *   - seedMenuItems inserts route-declared items
 *   - seedMenuItems is idempotent (re-run → same state)
 *   - user edits (touchedAt != null) survive re-seed
 *   - readApiMenuItemsFromDb returns seeded rows
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, menuItems } from '../../../src/db/index.ts';
import {
  seedMenuItems,
  collectRouteMenuRows,
} from '../../../src/db/seeders/menu-seeder.ts';
import { readApiMenuItemsFromDb } from '../../../src/routes/menu/menu.ts';

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

describe('collectRouteMenuRows', () => {
  test('maps api paths to studio paths + menu meta', () => {
    const rows = collectRouteMenuRows([sampleSource()]);
    expect(rows).toEqual([
      { path: '/search', label: 'Search', groupKey: 'main', position: 10, access: 'public', icon: null, studio: null },
      { path: '/traces', label: 'Traces', groupKey: 'main', position: 40, access: 'public', icon: null, studio: null },
      { path: '/map', label: 'Map', groupKey: 'tools', position: 20, access: 'public', icon: null, studio: null },
    ]);
  });

  test('skips routes without detail.menu', () => {
    const sub = new Elysia({ prefix: '/api' })
      .get('/search', () => ({}), {
        detail: { menu: { group: 'main', order: 1 }, summary: 'Search' },
      })
      .get('/health', () => ({}), { detail: { summary: 'Health' } });
    expect(collectRouteMenuRows([sub])).toHaveLength(1);
  });

  test('warns and keeps the first row when route menu paths collide', () => {
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

    try {
      const duplicate = new Elysia({ prefix: '/api' })
        .get('/map', () => ({}), {
          detail: { menu: { group: 'tools', order: 20, label: 'Map' } },
        })
        .get('/map3d', () => ({}), {
          detail: { menu: { group: 'main', order: 30, label: 'Map 3D' } },
        });

      const rows = collectRouteMenuRows([duplicate]);

      expect(rows).toEqual([
        { path: '/map', label: 'Map', groupKey: 'tools', position: 20, access: 'public', icon: null, studio: null },
      ]);
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain('duplicate route menu path "/map"');
      expect(warnings[0]).toContain('keeping /api/map');
      expect(warnings[0]).toContain('skipping /api/map3d');
    } finally {
      console.warn = originalWarn;
    }
  });
});

describe('seedMenuItems', () => {
  beforeEach(() => {
    clearMenu();
  });

  test('inserts new rows on first run', () => {
    const result = seedMenuItems([sampleSource()]);
    expect(result).toEqual({ inserted: 3, updated: 0, preserved: 0 });

    const rows = db.select().from(menuItems).all();
    expect(rows).toHaveLength(3);
    const paths = rows.map((r) => r.path).sort();
    expect(paths).toEqual(['/map', '/search', '/traces']);
    for (const row of rows) {
      expect(row.source).toBe('route');
      expect(row.touchedAt).toBeNull();
      expect(row.enabled).toBe(true);
    }
  });

  test('is idempotent — second run makes no changes', () => {
    seedMenuItems([sampleSource()]);
    const result = seedMenuItems([sampleSource()]);
    expect(result).toEqual({ inserted: 0, updated: 0, preserved: 0 });
    expect(db.select().from(menuItems).all()).toHaveLength(3);
  });

  test('updates untouched route rows when route metadata changes', () => {
    seedMenuItems([sampleSource()]);

    const changed = new Elysia({ prefix: '/api' })
      .get('/search', () => ({}), {
        detail: { menu: { group: 'tools', order: 99, label: 'Find' }, summary: 'Search' },
      });
    const result = seedMenuItems([changed]);
    expect(result.updated).toBe(1);

    const row = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/search'))
      .get();
    expect(row?.label).toBe('Find');
    expect(row?.groupKey).toBe('tools');
    expect(row?.position).toBe(99);
  });

  test('preserves user-edited rows (touchedAt != null) across re-seed', () => {
    seedMenuItems([sampleSource()]);

    const now = new Date();
    db.update(menuItems)
      .set({ label: 'My Search', touchedAt: now, updatedAt: now })
      .where(eq(menuItems.path, '/search'))
      .run();

    const changed = new Elysia({ prefix: '/api' })
      .get('/search', () => ({}), {
        detail: { menu: { group: 'main', order: 10, label: 'Route Search' }, summary: 'Search' },
      });
    const result = seedMenuItems([changed]);
    expect(result.preserved).toBe(1);
    expect(result.updated).toBe(0);

    const row = db
      .select()
      .from(menuItems)
      .where(eq(menuItems.path, '/search'))
      .get();
    expect(row?.label).toBe('My Search');
  });
});

describe('readApiMenuItemsFromDb', () => {
  beforeEach(() => {
    clearMenu();
  });

  test('returns seeded rows as MenuItems with source=api', () => {
    seedMenuItems([sampleSource()]);
    const items = readApiMenuItemsFromDb();
    expect(items).toHaveLength(3);
    for (const item of items) expect(item.source).toBe('api');
    const search = items.find((i) => i.path === '/search');
    expect(search).toMatchObject({ label: 'Search', group: 'main', order: 10 });
  });

  test('skips disabled rows', () => {
    seedMenuItems([sampleSource()]);
    db.update(menuItems).set({ enabled: false }).where(eq(menuItems.path, '/map')).run();
    const items = readApiMenuItemsFromDb();
    expect(items.find((i) => i.path === '/map')).toBeUndefined();
  });

  test('exposes populated studio column in /api/menu response', () => {
    seedMenuItems([sampleSource()]);
    db.update(menuItems)
      .set({ studio: 'studio.buildwithoracle.com' })
      .where(eq(menuItems.path, '/search'))
      .run();

    const items = readApiMenuItemsFromDb();
    const search = items.find((i) => i.path === '/search');
    expect(search?.studio).toBe('studio.buildwithoracle.com');
    const map = items.find((i) => i.path === '/map');
    expect(map?.studio).toBeUndefined();
  });
});
