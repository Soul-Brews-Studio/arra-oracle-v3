import type { MenuItem } from '../../../src/routes/menu/index.ts';
import { createMenuRoutes } from '../../../src/routes/menu/index.ts';
import { db, menuItems } from '../../../src/db/index.ts';

type AppLike = { handle(request: Request): Response | Promise<Response> };
type MenuInsert = typeof menuItems.$inferInsert;

export function clearMenuRows() {
  db.delete(menuItems).run();
}

export function createMenuApp(pluginItems: MenuItem[] = []) {
  return createMenuRoutes(pluginItems);
}

export async function requestJson<T = any>(
  app: AppLike,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'content-type': 'application/json' };
  }
  const res = await app.handle(new Request(`http://localhost${path}`, init));
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

export function insertMenuRow(overrides: Partial<MenuInsert> & Pick<MenuInsert, 'path' | 'label'>) {
  const now = new Date();
  return db
    .insert(menuItems)
    .values({
      path: overrides.path,
      label: overrides.label,
      groupKey: overrides.groupKey ?? 'main',
      parentId: overrides.parentId ?? null,
      position: overrides.position ?? 100,
      enabled: overrides.enabled ?? true,
      access: overrides.access ?? 'public',
      source: overrides.source ?? 'route',
      icon: overrides.icon ?? null,
      host: overrides.host ?? null,
      hidden: overrides.hidden ?? false,
      scope: overrides.scope ?? 'main',
      query: overrides.query ?? null,
      studio: overrides.studio ?? null,
      touchedAt: overrides.touchedAt ?? null,
      createdAt: overrides.createdAt ?? now,
      updatedAt: overrides.updatedAt ?? now,
    })
    .returning()
    .get();
}
