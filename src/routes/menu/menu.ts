/**
 * GET /api/menu — returns studio navigation, seeded from `detail.menu` on
 * mounted routes and persisted in the `menu_items` table.
 *
 * Flow:
 *   1. Boot-time seeder (src/db/seeders/menu-seeder.ts) upserts route-declared
 *      items into DB, preserving user-edited rows (`touchedAt != null`).
 *   2. This endpoint reads `menu_items` via Drizzle, merges frontend pages,
 *      gist extras, and custom items — preserving /api/menu response shape.
 */

import { Elysia, t } from 'elysia';
import { MenuItemSchema, ScopeSchema, type MenuItem, type Scope } from './model.ts';
import { getMenuConfig, getMenuSource, reloadMenuConfig } from '../../menu/config.ts';
import { listCustomMenuItems } from '../../menu/custom-store.ts';
import { buildMenuItems, readApiMenuItemsFromDb } from './menu-items.ts';

export type MenuExtras = {
  items?: MenuItem[];
  disable?: Iterable<string>;
};

const MenuSourceSchema = t.Object({
  url: t.Nullable(t.String()),
  hash: t.Nullable(t.String()),
  loaded_at: t.Nullable(t.Number()),
  status: t.Union([
    t.Literal('ok'),
    t.Literal('stale'),
    t.Literal('error'),
    t.Literal('none'),
  ]),
});

export function createMenuEndpoint(pluginItems: MenuItem[] = []) {
  return new Elysia()
    .get(
      '/menu',
      async ({ query }) => {
        const { items, disable } = await getMenuConfig();
        const host = typeof query.host === 'string' && query.host.length > 0 ? query.host : undefined;
        const validScopes = ['main', 'sub', 'both'] as const;
        const scope = validScopes.includes(query.scope as Scope) ? (query.scope as Scope) : undefined;
        return {
          items: buildMenuItems(
            readApiMenuItemsFromDb(host, scope),
            { items, disable },
            listCustomMenuItems(),
            pluginItems,
          ),
        };
      },
      {
        query: t.Object({
          host: t.Optional(t.String()),
          scope: t.Optional(ScopeSchema),
        }),
        detail: {
          tags: ['menu'],
          menu: { group: 'hidden' },
          summary: 'Aggregated studio navigation from menu_items table',
        },
      },
    )
    .get('/menu/source', () => getMenuSource(), {
      response: MenuSourceSchema,
      detail: {
        tags: ['menu'],
        menu: { group: 'hidden' },
        summary: 'Current gist source: url, revision hash, loaded_at, status',
      },
    })
    .post(
      '/menu/reload',
      async () => {
        await reloadMenuConfig();
        return getMenuSource();
      },
      {
        response: MenuSourceSchema,
        detail: {
          tags: ['menu'],
          menu: { group: 'hidden' },
          summary: 'Force refetch of gist menu source, bypassing cache',
        },
      },
    );
}

export { MenuItemSchema };
export {
  API_TO_STUDIO,
  buildMenuItems,
  hostMatches,
  menuItemsFromRoutes,
  readApiMenuItemsFromDb,
  scopeMatches,
} from './menu-items.ts';
export { menuItemsFromUnifiedPlugins } from './unified-plugin-menu.ts';
