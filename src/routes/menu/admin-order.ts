/**
 * Menu admin — bulk reorder + reset.
 * Reorder wraps all updates in a Drizzle transaction so any missing id
 * rolls back the whole batch.
 */

import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { menuOwnedWhere } from '../../menu/tenant.ts';
import { isMenuId, parseMenuIdParam } from './ids.ts';

export function createMenuOrderRoutes() {
  return new Elysia()
    .post(
      '/menu/reorder',
      ({ body, set }) => {
        const now = new Date();
        try {
          const ids = db.transaction((tx) => {
            const touched: number[] = [];
            for (const item of body.items) {
              if (!isMenuId(item.id)) throw new Error('invalid id');
              if (item.parentId != null && !isMenuId(item.parentId)) {
                throw new Error('invalid parentId');
              }
              const row = tx
                .update(menuItems)
                .set({
                  parentId: item.parentId ?? null,
                  position: item.position,
                  touchedAt: now,
                  updatedAt: now,
                })
                .where(menuOwnedWhere(eq(menuItems.id, item.id)))
                .returning({ id: menuItems.id })
                .get();
              if (!row) {
                throw new Error(`menu item ${item.id} not found`);
              }
              touched.push(row.id);
            }
            return touched;
          });
          return { updated: ids.length, ids };
        } catch (err) {
          set.status = 400;
          return { error: (err as Error).message };
        }
      },
      {
        body: t.Object({
          items: t.Array(
            t.Object({
              id: t.Number(),
              parentId: t.Optional(t.Nullable(t.Number())),
              position: t.Number(),
            }),
          ),
        }),
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 905 },
          summary: 'Bulk reorder in a transaction; any missing id rolls back the batch',
        },
      },
    )
    .post(
      '/menu/reset/:id',
      ({ params, set }) => {
        const id = parseMenuIdParam(params.id);
        if (id == null) {
          set.status = 400;
          return { error: 'invalid id' };
        }
        const row = db.select().from(menuItems).where(menuOwnedWhere(eq(menuItems.id, id))).get();
        if (!row) {
          set.status = 404;
          return { error: 'not found' };
        }
        if (row.source !== 'route') {
          set.status = 400;
          return { error: 'only route-sourced items can be reset' };
        }
        const now = new Date();
        const updated = db
          .update(menuItems)
          .set({ touchedAt: null, updatedAt: now })
          .where(menuOwnedWhere(eq(menuItems.id, id)))
          .returning()
          .get();
        return {
          id: updated!.id,
          path: updated!.path,
          touchedAt: updated!.touchedAt,
        };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 906 },
          summary: 'Clear touchedAt so next boot seed re-applies route defaults',
        },
      },
    );
}
