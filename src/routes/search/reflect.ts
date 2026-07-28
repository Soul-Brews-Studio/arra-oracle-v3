/**
 * GET /api/reflect — oracle's current self-reflection.
 */

import { Elysia } from 'elysia';
import { handleReflect } from '../../server/handlers.ts';

export const reflectEndpoint = new Elysia().get('/reflect', () => handleReflect(), {
  detail: {
    tags: ['search'],
    menu: { group: 'main', path: '/playground', order: 30 },
    summary: 'Oracle self-reflection snapshot',
  },
});
