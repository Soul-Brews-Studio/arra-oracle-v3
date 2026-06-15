import { Elysia, t } from 'elysia';
import { asc, count, eq } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { getMenuConfig } from '../../menu/config.ts';
import { listCustomMenuItems } from '../../menu/custom-store.ts';
import { buildMenuItems, readApiMenuItemsFromDb } from './menu-items.ts';
import { ScopeSchema, type MenuItem, type Scope } from './model.ts';

type MenuRow = typeof menuItems.$inferSelect;

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function queryValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(queryValue(value) ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function paginatedQuery(query: Record<string, unknown>): boolean {
  return queryValue(query.page) !== undefined || queryValue(query.limit) !== undefined;
}

function pageParams(query: Record<string, unknown>) {
  const page = positiveInt(query.page, DEFAULT_PAGE);
  const pageSize = Math.min(positiveInt(query.limit, DEFAULT_LIMIT), MAX_LIMIT);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function parseQuery(raw: string | null): Record<string, string> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    const query: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'string') query[key] = value;
    }
    return Object.keys(query).length ? query : undefined;
  } catch {
    return undefined;
  }
}

function toMenuItem(row: MenuRow): MenuItem {
  const item: MenuItem = {
    id: String(row.id),
    parentId: row.parentId == null ? null : String(row.parentId),
    path: row.path,
    label: row.label,
    group: ['main', 'tools', 'admin', 'hidden'].includes(row.groupKey)
      ? row.groupKey as MenuItem['group']
      : 'hidden',
    order: row.position,
    source: row.source === 'plugin' ? 'plugin' : 'api',
  };

  if (row.icon) item.icon = row.icon;
  if (row.access === 'public' || row.access === 'auth') item.access = row.access;
  if (row.hidden) item.hidden = true;
  if (row.studio) item.studio = row.studio;
  if (row.scope !== 'main') item.scope = row.scope as Scope;
  const parsedQuery = parseQuery(row.query);
  if (parsedQuery) item.query = parsedQuery;
  return item;
}

function readPaginatedMenuItems(pageSize: number, offset: number) {
  const where = eq(menuItems.enabled, true);
  const total = Number(
    db.select({ total: count() }).from(menuItems).where(where).get()?.total ?? 0,
  );
  const rows = db
    .select()
    .from(menuItems)
    .where(where)
    .orderBy(asc(menuItems.position), asc(menuItems.id))
    .limit(pageSize)
    .offset(offset)
    .all();
  return { rows, total };
}

function paginatedMenuResponse(query: Record<string, unknown>) {
  const { page, pageSize, offset } = pageParams(query);
  const { rows, total } = readPaginatedMenuItems(pageSize, offset);
  return {
    data: rows.map(toMenuItem),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
}

export function createMenuListEndpoint(pluginItems: MenuItem[] = []) {
  return new Elysia().get(
    '/menu',
    async ({ query }) => {
      if (paginatedQuery(query)) return paginatedMenuResponse(query);

      const { items, disable } = await getMenuConfig();
      const host = queryValue(query.host);
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
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['menu'],
        menu: { group: 'hidden' },
        summary: 'Aggregated studio navigation or paginated menu_items rows',
      },
    },
  );
}
