import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull, like, or } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { menuRowToItem } from './list-paginated.ts';

function searchTerm(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function searchMenuRows(q: string) {
  if (!q) return [];
  const pattern = `%${q}%`;
  return db
    .select()
    .from(menuItems)
    .where(
      and(
        eq(menuItems.enabled, true),
        isNull(menuItems.deletedAt),
        or(like(menuItems.label, pattern), like(menuItems.path, pattern)),
      ),
    )
    .orderBy(asc(menuItems.position), asc(menuItems.id))
    .all();
}

export function createMenuSearchEndpoint() {
  return new Elysia().get(
    '/menu/search',
    ({ query }) => {
      const q = searchTerm(query.q);
      const data = searchMenuRows(q).map(menuRowToItem);
      return { data, q, total: data.length };
    },
    {
      query: t.Object({ q: t.Optional(t.String()) }),
      detail: {
        tags: ['menu'],
        menu: { group: 'hidden' },
        summary: 'Search menu_items by label or path',
      },
    },
  );
}
