import { describe, expect, it } from 'bun:test';
import { Elysia } from 'elysia';

import { collectRouteMenuRows } from '../../../db/seeders/menu-seeder.ts';
import { menuItemsFromRoutes } from '../menu.ts';

function routeSource() {
  return new Elysia({ prefix: '/api' })
    .get('/search', () => ({}), {
      detail: {
        menu: {
          group: 'main',
          path: '/search',
          studio: 'studio.buildwithoracle.com',
          order: 10,
          label: 'Search',
        },
      },
    })
    .get('/internal', () => ({}), {
      detail: {
        menu: { group: 'main', order: 999, label: 'Internal' },
      },
    });
}

describe('route-declared menu metadata', () => {
  it('uses detail.menu.path/studio instead of deriving from API path', () => {
    expect(menuItemsFromRoutes([routeSource()])).toEqual([
      {
        path: '/search',
        studio: 'studio.buildwithoracle.com',
        label: 'Search',
        group: 'main',
        order: 10,
        source: 'api',
      },
    ]);
  });

  it('seeds only opt-in route menu rows with explicit frontend path', () => {
    expect(collectRouteMenuRows([routeSource()])).toEqual([
      {
        path: '/search',
        studio: 'studio.buildwithoracle.com',
        label: 'Search',
        groupKey: 'main',
        position: 10,
        access: 'public',
        icon: null,
      },
    ]);
  });
});
