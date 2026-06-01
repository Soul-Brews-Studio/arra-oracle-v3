/**
 * Menu Routes (Elysia) — composes /api/menu.
 *
 * The endpoint reads navigation from the `menu_items` DB table (seeded at
 * boot from route `detail.menu` metadata by src/db/seeders/menu-seeder.ts).
 */

import { Elysia } from 'elysia';
import { createMenuEndpoint } from './menu.ts';
import { createCustomMenuRoutes } from './custom.ts';
import { createMenuAdminRoutes } from './admin.ts';
import { createMenuOrderRoutes } from './admin-order.ts';
import { createMenuSourceAdminRoutes } from './admin-source.ts';

export function createMenuRoutes() {
  return new Elysia({ prefix: '/api' })
    .use(createMenuEndpoint())
    .use(createCustomMenuRoutes())
    .use(createMenuAdminRoutes())
    .use(createMenuOrderRoutes())
    .use(createMenuSourceAdminRoutes());
}

export {
  buildMenuItems,
  menuItemsFromRoutes,
  readApiMenuItemsFromDb,
  scopeMatches,
} from './menu.ts';
export type { MenuItem, MenuResponse, Scope } from './model.ts';
