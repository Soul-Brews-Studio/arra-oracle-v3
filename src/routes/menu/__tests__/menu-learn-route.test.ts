import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { menuItemsFromRoutes } from '../menu.ts';

describe('learn route menu mapping', () => {
  test('maps /api/learn route metadata to the /learn frontend page', () => {
    const routes = new Elysia({ prefix: '/api' }).get('/learn', () => ({}), {
      detail: { menu: { group: 'main', label: 'Learn', order: 35 } },
    });
    expect(menuItemsFromRoutes([routes])).toEqual([
      { path: '/learn', label: 'Learn', group: 'main', order: 35, source: 'api' },
    ]);
  });
});
