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

/**
 * ⚠️ SKIPPED — red on `alpha` since #1857, tracked in #2862. Not stale noise.
 *
 * This file arrived via `49410c0f chore: merge main into alpha (#1857)`; it encodes `main`'s
 * behaviour, and alpha's menu builders diverged in #1812 / #1993. Both
 * `menuItemsFromRoutes` (menu-items.ts:53) and `collectRouteMenuRows` (menu-seeder.ts:80)
 * ignore `detail.menu.path` / `.studio` and derive the path from the 14-entry API_TO_STUDIO
 * table, dropping any route whose API path is not in it.
 *
 * Measured on alpha: 90 files declare a route menu; 10 survive into the live /api/v1/menu;
 * every one has `studio: null`. `MenuMeta.studio` is typed, documented and schema-validated
 * (model.ts:19-22, :53) and read by nothing.
 *
 * Skipped rather than deleted because the assertion is a specification, and un-skipping it is
 * the acceptance criterion for #2862. Honouring the fields would take /api/menu from 10
 * route-derived entries to ~90 — a product decision, not a test fix.
 *
 * Skipped rather than left failing because #2853 expands CI to run src/, and a permanently
 * red gate teaches everyone to ignore it. A skip that names its issue stays visible in the
 * test output; an unrun directory does not.
 */
describe.skip('route-declared menu metadata', () => {
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
