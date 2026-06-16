import { asc, isNull } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { getFrontendMenuItems } from '../../menu/index.ts';
import { getPluginMenuItems } from '../plugins/model.ts';
import type { MenuExtras } from './menu.ts';
import type { MenuItem, MenuMeta, Scope } from './model.ts';

export const API_TO_STUDIO: ReadonlyArray<readonly [string, string]> = [
  ['/api/supersede', '/superseded'],
  ['/api/search', '/search'],
  ['/api/list', '/feed'],
  ['/api/reflect', '/playground'],
  ['/api/threads', '/'],
  ['/api/learn', '/learn'],
  ['/api/traces', '/traces'],
  ['/api/schedule', '/schedule'],
  ['/api/plugins', '/plugins'],
  ['/api/graph', '/map'],
  ['/api/map3d', '/map'],
  ['/api/map', '/map'],
  ['/api/context', '/evolution'],
  ['/api/stats', '/pulse'],
];

const GROUP_RANK: Record<MenuItem['group'], number> = {
  main: 0,
  tools: 1,
  admin: 2,
  hidden: 3,
};

function studioPathFor(apiPath: string): string | null {
  for (const [prefix, studio] of API_TO_STUDIO) {
    if (apiPath === prefix || apiPath.startsWith(prefix + '/')) return studio;
  }
  return null;
}

type RouteLike = { method?: string; path: string; hooks?: { detail?: unknown } };
type HasRoutes = { routes: RouteLike[] };

export function menuItemsFromRoutes(sources: HasRoutes[]): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();

  for (const src of sources) {
    for (const route of src.routes) {
      const detail = (route.hooks?.detail ?? {}) as { menu?: MenuMeta };
      const menu = detail.menu;
      if (!menu?.group) continue;

      const studio = studioPathFor(route.path);
      if (!studio) continue;

      const key = `${menu.group}:${studio}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const order =
        typeof menu.order === 'number' && Number.isFinite(menu.order) ? menu.order : 999;
      const slug = studio.replace(/^\//, '') || 'home';
      const label = menu.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);
      items.push({ path: studio, label, group: menu.group, order, source: 'api' });
    }
  }

  return items;
}

export function hostMatches(pattern: string | null | undefined, host: string): boolean {
  if (pattern == null) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(host);
}

export function scopeMatches(rowScope: string, filterScope?: Scope): boolean {
  if (filterScope == null) return true;
  if (rowScope === 'both') return true;
  return rowScope === filterScope;
}

export function readApiMenuItemsFromDb(host?: string, scope?: Scope): MenuItem[] {
  const rows = db
    .select()
    .from(menuItems)
    .where(isNull(menuItems.deletedAt))
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
      source: row.source === 'plugin' ? 'plugin' : 'api',
    };

    if (row.icon) item.icon = row.icon;
    if (row.access === 'public' || row.access === 'auth') item.access = row.access;
    if (row.hidden) item.hidden = true;
    if (row.studio) item.studio = row.studio;
    if (row.scope !== 'main') item.scope = row.scope as Scope;
    setQuery(item, row.query);
    items.push(item);
  }
  return items;
}

function setQuery(item: MenuItem, query: string | null) {
  if (!query) return;
  try {
    const parsed = JSON.parse(query);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;

    const q: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') q[key] = value;
    }
    if (Object.keys(q).length > 0) item.query = q;
  } catch {}
}

export function buildMenuItems(
  apiItems: MenuItem[],
  extras?: MenuExtras,
  customItems: MenuItem[] = [],
  pluginItems: MenuItem[] = [],
): MenuItem[] {
  const items: MenuItem[] = [];
  const seen = new Set<string>();
  const disableSet = new Set<string>(extras?.disable ?? []);
  const [persistedPluginItems, persistedApiItems] = partitionPluginItems(apiItems);

  appendUnique(items, seen, persistedApiItems);
  appendUnique(items, seen, pluginItems);
  appendUnique(items, seen, getFrontendMenuItems());
  if (extras?.items) appendUnique(items, seen, extras.items);
  appendUnique(items, seen, customItems.map((item) => ({ ...item, added: true }) as MenuItem));
  appendUnique(items, seen, persistedPluginItems);
  appendUnique(items, seen, getPluginMenuItems());

  const filtered = disableSet.size ? items.filter((i) => !disableSet.has(i.path)) : items;
  filtered.sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || a.order - b.order);
  return filtered;
}

function partitionPluginItems(items: MenuItem[]): [MenuItem[], MenuItem[]] {
  const plugins: MenuItem[] = [];
  const api: MenuItem[] = [];
  for (const item of items) (item.source === 'plugin' ? plugins : api).push(item);
  return [plugins, api];
}

function appendUnique(items: MenuItem[], seen: Set<string>, source: MenuItem[]) {
  for (const item of source) {
    const key = `${item.group}:${item.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
  }
}
