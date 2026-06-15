/**
 * TypeBox schemas for /api/menu.
 */

import { t } from 'elysia';
import type { Static } from 'elysia';

export interface MenuMeta {
  group: 'main' | 'tools' | 'admin' | 'hidden';
  order?: number;
  label?: string;
  icon?: string;
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
