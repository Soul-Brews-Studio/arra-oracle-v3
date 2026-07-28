/**
 * GET /api/menu — returns studio navigation, seeded from `detail.menu` on
 * mounted routes and persisted in the `menu_items` table.
 *
 * Flow:
 *   1. Boot-time seeder (src/db/seeders/menu-seeder.ts) upserts route-declared
 *      items with `detail.menu.path` into DB, preserving user-edited rows
 *      (`touchedAt != null`).
 *   2. This endpoint reads `menu_items` via Drizzle, merges frontend pages,
 *      gist extras, and custom items — preserving /api/menu response shape.
 */

import { Elysia, t } from 'elysia';
import { asc } from 'drizzle-orm';
import { MenuItemSchema, MenuResponseSchema, ScopeSchema, type MenuItem, type MenuMeta, type Scope } from './model.ts';
import { getFrontendMenuItems } from '../../menu/index.ts';
import { getMenuConfig, getMenuSource, reloadMenuConfig } from '../../menu/config.ts';
import { listCustomMenuItems } from '../../menu/custom-store.ts';
import { getPluginMenuItems } from '../plugins/model.ts';
import { db, menuItems } from '../../db/index.ts';

export type MenuExtras = {
  items?: MenuItem[];
  pluginItems?: MenuItem[];
  disable?: Iterable<string>;
};

type RouteLike = { method?: string; path: string; hooks?: { detail?: unknown } };
type HasRoutes = { routes: RouteLike[] };

const GROUP_RANK: Record<MenuItem['group'], number> = { main: 0, tools: 1, admin: 2, hidden: 3 };

/**
 * Pure scan of Elysia route sources into MenuItems (source='api').
 * A route becomes a menu row only when it declares `detail.menu.path`; this
 * keeps each owning route responsible for its frontend/studio target instead
 * of relying on a central API-prefix translation table.
 * Used by tests and exported for callers that need pre-DB scanning.
 */
export function menuItemsFromRoutes(sources: HasRoutes[]): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    for (const route of src.routes) {
      const detail = (route.hooks?.detail ?? {}) as { menu?: MenuMeta };
      const menu = detail.menu;
      if (!menu || !menu.group) continue;

      if (!menu.path) continue;

      const key = `${menu.group}:${menu.path}:${menu.studio ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const order =
        typeof menu.order === 'number' && Number.isFinite(menu.order) ? menu.order : 999;
      const slug = menu.path.replace(/^\//, '') || 'home';
      const label = menu.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);

      const item: MenuItem = { path: menu.path, label, group: menu.group, order, source: 'api' };
      if (menu.studio) item.studio = menu.studio;
      if (menu.icon) item.icon = menu.icon;
      if (menu.access) item.access = menu.access;
      items.push(item);
    }
  }

  return items;
}

/**
 * Match a stored glob pattern (e.g. `vector.*`) against a concrete host
 * (e.g. `vector.foo.com`). Only `*` is treated as a wildcard; other regex
 * metacharacters are escaped.
 */
export function hostMatches(pattern: string | null | undefined, host: string): boolean {
  if (pattern == null) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(host);
}

/**
 * Does the row's scope match the requested scope filter?
 *
 * - No scope filter -> everything passes (backward compat)
 * - scope='main'   -> rows with scope='main' or scope='both'
 * - scope='sub'    -> rows with scope='sub'  or scope='both'
 */
export function scopeMatches(rowScope: string, filterScope?: Scope): boolean {
  if (filterScope == null) return true;
  if (rowScope === 'both') return true;
  return rowScope === filterScope;
}

/**
 * Read API-sourced menu items from the `menu_items` DB table.
 * Only enabled rows are returned. Source is always 'api' for studio consumers.
 * When `host` is provided, rows are filtered to those with null `host` (shown
 * everywhere) or a glob pattern matching the supplied host.
 * When `scope` is provided, rows are filtered to that scope or 'both'.
 */
export function readApiMenuItemsFromDb(host?: string, scope?: Scope): MenuItem[] {
  const rows = db
    .select()
    .from(menuItems)
    .orderBy(asc(menuItems.position))
    .all();

  const items: MenuItem[] = [];
  for (const row of rows) {
    if (row.enabled === false) continue;
    if (host !== undefined && !hostMatches(row.host, host)) continue;
    if (!scopeMatches(row.scope, scope)) continue;
    const group = (['main', 'tools', 'admin', 'hidden'] as const).includes(
      row.groupKey as MenuItem['group'],
    )
      ? (row.groupKey as MenuItem['group'])
      : 'hidden';
    const item: MenuItem = {
      id: String(row.id),
      parentId: row.parentId == null ? null : String(row.parentId),
      path: row.path,
      label: row.label,
      group,
      order: row.position,
      source: 'api',
    };
    if (row.icon) item.icon = row.icon;
    if (row.access === 'public' || row.access === 'auth') item.access = row.access;
    if (row.hidden) item.hidden = true;
    if (row.studio) item.studio = row.studio;
    if (row.scope !== 'main') item.scope = row.scope as Scope;
    if (row.query) {
      try {
        const parsed = JSON.parse(row.query);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const q: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === 'string') q[k] = v;
          }
          if (Object.keys(q).length > 0) item.query = q;
        }
      } catch {}
    }
    items.push(item);
  }
  return items;
}

/**
 * Merge pre-resolved API items with frontend pages, gist extras, and custom
 * items into the final /api/menu response. First-seen wins on dedupe; disable
 * filters any path.
 */
export function buildMenuItems(
  apiItems: MenuItem[],
  extras?: MenuExtras,
  customItems: MenuItem[] = [],
): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  const disableSet = new Set<string>(extras?.disable ?? []);

  for (const item of apiItems) {
    const key = `${item.group}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  for (const item of getFrontendMenuItems()) {
    const key = `${item.group}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }

  if (extras?.pluginItems) {
    for (const item of extras.pluginItems) {
      const key = `${item.group}:${item.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  if (extras?.items) {
    for (const item of extras.items) {
      const key = `${item.group}:${item.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }

  for (const item of customItems) {
    const key = `${item.group}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ ...item, added: true } as MenuItem);
  }

  const filtered = disableSet.size ? items.filter((i) => !disableSet.has(i.path)) : items;
  filtered.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.order - b.order);
  return filtered;
}

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

export function createMenuEndpoint() {
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
            { items, pluginItems: getPluginMenuItems(), disable },
            listCustomMenuItems(),
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
