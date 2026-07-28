/**
 * TypeBox schemas for /api/menu.
 */

import { t } from 'elysia';
import type { Static } from 'elysia';

export interface MenuMeta {
  group: 'main' | 'tools' | 'admin' | 'hidden';
  /**
   * Studio/frontend path to expose in /api/menu. Route-declared menu items are
   * opt-in: omit `path` for API endpoints that should not create nav rows.
   */
  path?: string;
  order?: number;
  label?: string;
  icon?: string;
  /**
   * Optional studio host for cross-studio menu entries, e.g.
   * `canvas.buildwithoracle.com`. Null/undefined means the current studio.
   */
  studio?: string | null;
  access?: 'public' | 'auth';
}

declare module 'elysia' {
  interface DocumentDecoration {
    menu?: MenuMeta;
  }
}

export const ScopeSchema = t.Union([
  t.Literal('main'),
  t.Literal('sub'),
  t.Literal('both'),
]);

export type Scope = Static<typeof ScopeSchema>;

export const MenuItemSchema = t.Object({
  id: t.Optional(t.String()),
  parentId: t.Optional(t.Nullable(t.String())),
  path: t.String(),
  label: t.String(),
  group: t.Union([
    t.Literal('main'),
    t.Literal('tools'),
    t.Literal('hidden'),
    t.Literal('admin'),
  ]),
  order: t.Number(),
  icon: t.Optional(t.String()),
  studio: t.Optional(t.Nullable(t.String())),
  access: t.Optional(t.Union([t.Literal('public'), t.Literal('auth')])),
  source: t.Union([
    t.Literal('api'),
    t.Literal('page'),
    t.Literal('plugin'),
  ]),
  sourceName: t.Optional(t.String()),
  added: t.Optional(t.Boolean()),
  hidden: t.Optional(t.Boolean()),
  scope: t.Optional(ScopeSchema),
  query: t.Optional(t.Record(t.String(), t.String())),
});

export type MenuItem = Static<typeof MenuItemSchema>;

export const MenuResponseSchema = t.Object({
  items: t.Array(MenuItemSchema),
});

export type MenuResponse = Static<typeof MenuResponseSchema>;
