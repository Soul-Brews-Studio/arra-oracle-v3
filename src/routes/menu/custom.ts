/**
 * /api/menu/custom — user-added menu items.
 *
 *   GET    /api/menu/custom           list just the user-added items
 *   POST   /api/menu/custom           add (or replace by path) a custom item
 *   DELETE /api/menu/custom/:path     remove a custom item (path URL-encoded)
 *
 * Custom items also merge into GET /api/menu with source:'page' + added:true.
 */

import { Elysia, t } from 'elysia';
import { MenuItemSchema } from './model.ts';
import {
  addCustomMenuItem,
  listCustomMenuItems,
  removeCustomMenuItem,
} from '../../menu/custom-store.ts';

const GroupSchema = t.Union([
  t.Literal('main'),
  t.Literal('tools'),
  t.Literal('hidden'),
  t.Literal('admin'),
]);

export function createCustomMenuRoutes() {
  return new Elysia()
    .get(
      '/menu/custom',
      () => ({ items: listCustomMenuItems().map((i) => ({ ...i, added: true })) }),
      {
        detail: {
          tags: ['menu'],
          menu: { group: 'hidden' },
          summary: 'List user-added custom menu items',
        },
        response: t.Object({ items: t.Array(MenuItemSchema) }),
      },
    )
    .post(
      '/menu/custom',
      ({ body, set }) => {
        try {
          const result = addCustomMenuItem(body);
          set.status = result.replaced ? 200 : 201;
          return { ...result, item: { ...result.item, added: true } };
        } catch (error) {
          set.status = 400;
          return { error: error instanceof Error ? error.message : String(error) };
        }
      },
      {
        body: t.Object({
          path: t.String({ minLength: 1 }),
          label: t.String({ minLength: 1 }),
          group: t.Optional(GroupSchema),
          order: t.Optional(t.Number()),
          icon: t.Optional(t.String()),
        }),
        detail: {
          tags: ['menu'],
          menu: { group: 'hidden' },
          summary: 'Add or replace a user-added custom menu item',
        },
      },
    )
    .delete(
      '/menu/custom/*',
      ({ params, set }) => {
        const raw = (params as { '*': string })['*'] ?? '';
        const decoded = decodeURIComponent(raw);
        const result = removeCustomMenuItem(decoded);
        if (!result.removed) set.status = 404;
        return result;
      },
      {
        detail: {
          tags: ['menu'],
          menu: { group: 'hidden' },
          summary: 'Remove a user-added custom menu item by path',
        },
      },
    );
}
