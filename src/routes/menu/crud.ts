import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, menuItems } from '../../db/index.ts';
import { ScopeSchema } from './model.ts';
import { AccessSchema, GroupSchema, toResponse, type MenuRow } from './admin-model.ts';

function idParam(value: string): number | null {
  const id = Number(value);
  return Number.isFinite(id) ? id : null;
}

function insertMenuItem(body: MenuCreateBody) {
  const now = new Date();
  return db
    .insert(menuItems)
    .values({
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
}

function updatePatch(body: MenuUpdateBody): Partial<MenuRow> {
  const patch: Partial<MenuRow> = { updatedAt: new Date(), touchedAt: new Date() };
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
  return patch;
}

const CreateBody = t.Object({
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
});

const UpdateBody = t.Partial(CreateBody);
type MenuCreateBody = typeof CreateBody.static;
type MenuUpdateBody = typeof UpdateBody.static;

export function createMenuCrudRoutes() {
  return new Elysia()
    .post('/menu', ({ body, set }) => {
      try {
        set.status = 201;
        return toResponse(insertMenuItem(body));
      } catch (err) {
        set.status = 409;
        return { error: (err as Error).message };
      }
    }, { body: CreateBody, detail: { tags: ['menu'], summary: 'Create a menu item' } })
    .put('/menu/:id', ({ params, body, set }) => {
      const id = idParam(params.id);
      if (id == null) {
        set.status = 400;
        return { error: 'invalid id' };
      }
      const updated = db.update(menuItems).set(updatePatch(body)).where(eq(menuItems.id, id)).returning().get();
      if (!updated) {
        set.status = 404;
        return { error: 'not found' };
      }
      return toResponse(updated);
    }, { params: t.Object({ id: t.String() }), body: UpdateBody, detail: { tags: ['menu'], summary: 'Update a menu item' } })
    .delete('/menu/:id', ({ params, set }) => {
      const id = idParam(params.id);
      if (id == null) {
        set.status = 400;
        return { error: 'invalid id' };
      }
      const updated = db
        .update(menuItems)
        .set({ enabled: false, touchedAt: new Date(), updatedAt: new Date() })
        .where(eq(menuItems.id, id))
        .returning()
        .get();
      if (!updated) {
        set.status = 404;
        return { error: 'not found' };
      }
      return { id, deleted: 'soft' as const };
    }, { params: t.Object({ id: t.String() }), detail: { tags: ['menu'], summary: 'Soft-delete a menu item' } });
}
