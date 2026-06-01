/**
 * Unit tests for /api/menu — aggregates nav tags off mounted Elysia routes.
 *
 * Post-migration: items live in the `menu_items` table; the endpoint reads
 * DB. Tests seed via `seedMenuItems` after clearing the table for isolation.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Elysia } from 'elysia';
import {
  createMenuRoutes,
  buildMenuItems,
  menuItemsFromRoutes,
  type MenuItem,
} from '../../../src/routes/menu/index.ts';
import { db, menuItems } from '../../../src/db/index.ts';
import { seedMenuItems } from '../../../src/db/seeders/menu-seeder.ts';

function clearMenu() {
  db.delete(menuItems).run();
}

function fakeApiModule() {
  return new Elysia({ prefix: '/api' })
    .get('/search', () => ({}), {
      detail: { tags: ['search'], menu: { group: 'main', path: '/search', order: 10 }, summary: 'Search' },
    })
    .get('/list', () => ({}), {
      detail: {
        tags: ['search'],
        menu: { group: 'main', path: '/feed', order: 20 },
        summary: 'List oracle documents',
      },
    })
    .get('/map', () => ({}), {
      detail: { tags: ['map'], menu: { group: 'tools', path: '/map', order: 20 }, summary: 'Map 2D' },
    })
    .get('/map3d', () => ({}), {
      detail: { tags: ['map'], menu: { group: 'tools', path: '/map', order: 30 }, summary: 'Map 3D' },
    })
    .get('/settings', () => ({}), {
      detail: { tags: ['settings'], menu: { group: 'hidden' }, summary: 'Settings' },
    })
    .get('/untagged', () => ({}), {
      detail: { tags: ['internal'], summary: 'Internal' },
    });
}

describe('/api/menu', () => {
  beforeEach(() => {
    clearMenu();
  });

  test('groups routes into main / tools / hidden', async () => {
    seedMenuItems([fakeApiModule()]);
    const app = createMenuRoutes();
    const res = await app.handle(new Request('http://localhost/api/menu'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: MenuItem[] };
    const apiItems = body.items.filter((i) => i.source === 'api');
    const groups = new Map<string, MenuItem[]>();
    for (const item of apiItems) {
      const arr = groups.get(item.group) ?? [];
      arr.push(item);
      groups.set(item.group, arr);
    }
    const main = groups.get('main') ?? [];
    const tools = groups.get('tools') ?? [];
    const hidden = groups.get('hidden') ?? [];
    expect(main.map((i) => i.path)).toEqual(['/search', '/feed']);
    expect(tools.map((i) => i.path)).toEqual(['/map']);
    expect(hidden.length).toBe(0);
  });

  test('respects menu.order and studio path dedupe', () => {
    const items = menuItemsFromRoutes([fakeApiModule()]);
    const main = items.filter((i) => i.group === 'main');
    const tools = items.filter((i) => i.group === 'tools');
    expect(main[0]).toMatchObject({ path: '/search', label: 'Search', order: 10, source: 'api' });
    expect(main[1]).toMatchObject({ path: '/feed', label: 'Feed', order: 20 });
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ path: '/map', order: 20 });
  });

  test('routes without menu.path or menu metadata are skipped', () => {
    const sub = new Elysia({ prefix: '/api' })
      .get('/unknown', () => ({}), {
        detail: { menu: { group: 'main', order: 1 }, summary: 'Unknown' },
      })
      .get('/plain', () => ({}), {
        detail: { tags: [], summary: 'plain' },
      });
    const items = menuItemsFromRoutes([sub]);
    expect(items).toHaveLength(0);
  });

  test('menu endpoint self-marks as hidden via detail.menu', () => {
    const app = createMenuRoutes();
    const menuRoute = app.routes.find((r) => r.path === '/api/menu');
    expect(menuRoute).toBeDefined();
    const detail = (menuRoute!.hooks as { detail?: { tags?: string[]; menu?: { group?: string } } })
      .detail;
    expect(detail?.tags).toContain('menu');
    expect(detail?.menu?.group).toBe('hidden');
  });
});
