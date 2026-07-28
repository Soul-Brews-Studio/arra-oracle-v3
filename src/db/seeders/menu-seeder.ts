/**
 * Menu seeder — syncs route-declared menu items into the `menu_items` table.
 *
 * Called at server boot (src/server.ts) and idempotent. For each route with
 * `detail.menu.path`, upserts by (path, studio):
 *   - Path not in DB           → INSERT with source='route', touchedAt=null
 *   - In DB, source='route'+untouched → UPDATE label/group/position from route
 *   - touchedAt != null        → PRESERVE (user edit wins); log drift
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite';
import * as schema from '../schema.ts';
import { db as defaultDb } from '../index.ts';
import type { MenuMeta } from '../../routes/menu/model.ts';

export type RouteLike = { method?: string; path: string; hooks?: { detail?: unknown } };
export type HasRoutes = { routes: RouteLike[] };

export interface RouteMenuRow {
  path: string;        // studio path (e.g. /search)
  label: string;
  groupKey: string;
  position: number;
  access: string;
  icon?: string | null;
  studio?: string | null; // host subdomain (e.g. feed.buildwithoracle.com); null = legacy studio.*
}

export function collectRouteMenuRows(sources: HasRoutes[]): RouteMenuRow[] {
  const rows: RouteMenuRow[] = [];
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

      const slug = menu.path.replace(/^\//, '') || 'home';
      const label = menu.label ?? slug.charAt(0).toUpperCase() + slug.slice(1);
      const order =
        typeof menu.order === 'number' && Number.isFinite(menu.order) ? menu.order : 999;

      rows.push({
        path: menu.path,
        label,
        groupKey: menu.group,
        position: order,
        access: menu.access ?? 'public',
        icon: menu.icon ?? null,
        studio: menu.studio ?? null,
      });
    }
  }

  return rows;
}

/**
 * #958: submenu reparenting. Migration 0011 owns parent-row creation and
 * data-migration on existing installs; the seeder only reconciles known
 * children on every boot so route-seeded rows drop under the right parent.
 */
const CHILD_PARENTS: Record<string, string> = {
  '/playground': '#tools',
  '/plugins': '#tools',
  '/evolution': '#tools',
  '/pulse': '#tools',
  '/map': '#canvas',
};

export interface SeedResult {
  inserted: number;
  updated: number;
  preserved: number;
}

export function seedMenuItems(
  sources: HasRoutes[],
  db: BunSQLiteDatabase<typeof schema> = defaultDb,
  now: Date = new Date(),
): SeedResult {
  const rows = collectRouteMenuRows(sources);
  let inserted = 0;
  let updated = 0;
  let preserved = 0;

  db.transaction((tx) => {
    for (const row of rows) {
      const existing = tx
        .select()
        .from(schema.menuItems)
        .where(
          and(
            eq(schema.menuItems.path, row.path),
            row.studio == null
              ? isNull(schema.menuItems.studio)
              : eq(schema.menuItems.studio, row.studio),
          ),
        )
        .get();

      if (!existing) {
        tx.insert(schema.menuItems)
          .values({
            path: row.path,
            label: row.label,
            groupKey: row.groupKey,
            position: row.position,
            access: row.access,
            source: 'route',
            icon: row.icon ?? null,
            studio: row.studio ?? null,
            enabled: true,
            touchedAt: null,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        inserted += 1;
        continue;
      }

      if (existing.source === 'route' && existing.touchedAt == null) {
        const changed =
          existing.label !== row.label ||
          existing.groupKey !== row.groupKey ||
          existing.position !== row.position ||
          existing.access !== row.access ||
          existing.icon !== (row.icon ?? null);
        if (changed) {
          tx.update(schema.menuItems)
            .set({
              label: row.label,
              groupKey: row.groupKey,
              position: row.position,
              access: row.access,
              icon: row.icon ?? null,
              updatedAt: now,
            })
            .where(eq(schema.menuItems.id, existing.id))
            .run();
          updated += 1;
        }
        continue;
      }

      preserved += 1;
    }

    for (const [childPath, parentPath] of Object.entries(CHILD_PARENTS)) {
      const parent = tx
        .select()
        .from(schema.menuItems)
        .where(and(eq(schema.menuItems.path, parentPath), isNull(schema.menuItems.studio)))
        .get();
      if (!parent) continue;
      const child = tx
        .select()
        .from(schema.menuItems)
        .where(and(eq(schema.menuItems.path, childPath), isNull(schema.menuItems.studio)))
        .get();
      if (!child || child.parentId === parent.id) continue;
      tx.update(schema.menuItems)
        .set({ parentId: parent.id, updatedAt: now })
        .where(eq(schema.menuItems.id, child.id))
        .run();
    }
  });

  return { inserted, updated, preserved };
}
