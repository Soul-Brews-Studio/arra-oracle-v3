import { Elysia, t } from 'elysia';
import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { menuRowToItem } from './list-paginated.ts';
import { menuVisibleWhere } from '../../menu/tenant.ts';

function searchTerm(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function escapeLikeTerm(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function searchMenuRows(q: string) {
  if (!q) return [];
  const pattern = `%${escapeLikeTerm(q)}%`;
  return db
    .select()
    .from(menuItems)
    .where(
      menuVisibleWhere(and(
        eq(menuItems.enabled, true),
        isNull(menuItems.deletedAt),
        or(
          sql`${menuItems.label} LIKE ${pattern} ESCAPE '\\'`,
          sql`${menuItems.path} LIKE ${pattern} ESCAPE '\\'`,
        ),
      )),
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
