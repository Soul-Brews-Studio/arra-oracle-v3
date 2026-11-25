/** GET /api/arra/spaces — the Studio header's space switcher (#3110). Owner only. */
import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { listSpaces } from '../../arra/space.ts';
import { failed } from './guard.ts';

export function createArraSpacesRoutes() {
  return new Elysia().get('/spaces', ({ set }) => {
    try { return { ok: true, spaces: listSpaces(sqlite) }; }
    catch (error) { return failed(set, error); }
  }, { detail: { tags: ['arra'], summary: 'Spaces to switch between: this machine, the hub it owns, hubs it joined (with doc counts)' } });
}
