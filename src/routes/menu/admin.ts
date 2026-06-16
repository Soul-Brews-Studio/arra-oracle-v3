/**
 * Menu admin endpoints — tree, list, CRUD, reorder, reset.
 * All writes go through Drizzle ORM. User edits set touchedAt=now so the
 * boot seeder preserves them on the next run.
 */

import { Elysia, t } from 'elysia';
import { eq, asc } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { ScopeSchema } from './model.ts';
import { softDeleteWhere } from '../../storage/soft-delete.ts';
import { AccessSchema, GroupSchema, buildTree, toResponse, type MenuRow } from './admin-model.ts';
import { menuOwnedWhere, menuTenantIdForWrite, menuVisibleWhere } from '../../menu/tenant.ts';

export function createMenuAdminRoutes() {
  return new Elysia()
    .get(
      '/menu/tree',
      () => {
        const rows = db
          .select()
          .from(menuItems)
          .where(menuVisibleWhere())
          .orderBy(asc(menuItems.position))
          .all();
        return { items: buildTree(rows) };
      },
      {
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 900 },
          summary: 'Menu items as nested tree by parent_id',
        },
      },
    )
    .get(
      '/menu/items',
      () => {
        const rows = db
          .select()
          .from(menuItems)
          .where(menuVisibleWhere())
          .orderBy(asc(menuItems.groupKey), asc(menuItems.position))
          .all();
        return { items: rows.map(toResponse) };
      },
      {
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 901 },
          summary: 'Admin list of all menu_items rows (all DB fields)',
        },
      },
    )
    .post(
      '/menu/items',
      ({ body, set }) => {
        const now = new Date();
        try {
          const inserted = db
            .insert(menuItems)
            .values({
              tenantId: menuTenantIdForWrite(),
              path: body.path,
              label: body.label,
              groupKey: body.groupKey ?? 'main',
              parentId: body.parentId ?? null,
              position: body.position ?? 999,
              enabled: body.enabled ?? true,
              access: body.access ?? 'public',
              source: 'custom',
              icon: body.icon ?? null,
              host: body.host ?? null,
              hidden: body.hidden ?? false,
              scope: body.scope ?? 'main',
              query: body.query ? JSON.stringify(body.query) : null,
              touchedAt: now,
              createdAt: now,
              updatedAt: now,
            })
            .returning()
            .get();
          set.status = 201;
          return toResponse(inserted);
        } catch (err) {
          set.status = 409;
          return { error: (err as Error).message };
        }
      },
      {
        body: t.Object({
          path: t.String({ minLength: 1 }),
          label: t.String({ minLength: 1 }),
          groupKey: t.Optional(GroupSchema),
          parentId: t.Optional(t.Nullable(t.Number())),
          position: t.Optional(t.Number()),
          enabled: t.Optional(t.Boolean()),
          access: t.Optional(AccessSchema),
          icon: t.Optional(t.String()),
          host: t.Optional(t.Nullable(t.String())),
          hidden: t.Optional(t.Boolean()),
          scope: t.Optional(ScopeSchema),
          query: t.Optional(t.Nullable(t.Record(t.String(), t.String()))),
        }),
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 902 },
          summary: 'Create a custom menu item (source=custom)',
        },
      },
    )
    .patch(
      '/menu/items/:id',
      ({ params, body, set }) => {
        const id = Number(params.id);
        if (!Number.isFinite(id)) {
          set.status = 400;
          return { error: 'invalid id' };
        }
        const now = new Date();
        const patch: Partial<MenuRow> = { updatedAt: now, touchedAt: now };
        if (body.label !== undefined) patch.label = body.label;
        if (body.groupKey !== undefined) patch.groupKey = body.groupKey;
        if (body.parentId !== undefined) patch.parentId = body.parentId;
        if (body.position !== undefined) patch.position = body.position;
        if (body.enabled !== undefined) patch.enabled = body.enabled;
        if (body.access !== undefined) patch.access = body.access;
        if (body.icon !== undefined) patch.icon = body.icon;
        if (body.host !== undefined) patch.host = body.host;
        if (body.hidden !== undefined) patch.hidden = body.hidden;
        if (body.scope !== undefined) patch.scope = body.scope;
        if (body.query !== undefined) patch.query = body.query == null ? null : JSON.stringify(body.query);

        const updated = db
          .update(menuItems)
          .set(patch)
          .where(menuOwnedWhere(eq(menuItems.id, id)))
          .returning()
          .get();
        if (!updated) {
          set.status = 404;
          return { error: 'not found' };
        }
        return toResponse(updated);
      },
      {
        params: t.Object({ id: t.String() }),
        body: t.Object({
          label: t.Optional(t.String({ minLength: 1 })),
          groupKey: t.Optional(GroupSchema),
          parentId: t.Optional(t.Nullable(t.Number())),
          position: t.Optional(t.Number()),
          enabled: t.Optional(t.Boolean()),
          access: t.Optional(AccessSchema),
          icon: t.Optional(t.Nullable(t.String())),
          host: t.Optional(t.Nullable(t.String())),
          hidden: t.Optional(t.Boolean()),
          scope: t.Optional(ScopeSchema),
          query: t.Optional(t.Nullable(t.Record(t.String(), t.String()))),
        }),
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 903 },
          summary: 'Edit a menu item (sets touchedAt=now)',
        },
      },
    )
    .delete(
      '/menu/items/:id',
      ({ params, set }) => {
        const id = Number(params.id);
        if (!Number.isFinite(id)) {
          set.status = 400;
          return { error: 'invalid id' };
        }
        const row = db.select().from(menuItems).where(menuOwnedWhere(eq(menuItems.id, id))).get();
        if (!row) {
          set.status = 404;
          return { error: 'not found' };
        }
        if (row.source === 'custom') {
          db.delete(menuItems).where(menuOwnedWhere(eq(menuItems.id, id))).run();
          return { id, deleted: 'hard' as const };
        }
        const deletedAt = new Date();
        softDeleteWhere(db, menuItems, menuOwnedWhere(eq(menuItems.id, id))!, {
          deletedAt,
          set: { enabled: false, touchedAt: deletedAt },
        });
        return { id, deleted: 'soft' as const };
      },
      {
        params: t.Object({ id: t.String() }),
        detail: {
          tags: ['menu'],
          menu: { group: 'admin', order: 904 },
          summary: 'Hard-delete custom items; timestamp soft-delete route rows',
        },
      },
    );
}

export { buildTree, toResponse };
