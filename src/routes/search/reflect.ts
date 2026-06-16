/**
 * GET /api/reflect — oracle's current self-reflection.
 */

import { Elysia } from 'elysia';
import { handleReflect } from '../../server/handlers.ts';
import { handleTenantReflect } from './tenant-search.ts';

export const reflectEndpoint = new Elysia().get('/reflect', () => handleTenantReflect() ?? handleReflect(), {
  detail: {
    tags: ['search'],
    menu: { group: 'main', path: '/playground', order: 30 },
    summary: 'Oracle self-reflection snapshot',
  },
});
