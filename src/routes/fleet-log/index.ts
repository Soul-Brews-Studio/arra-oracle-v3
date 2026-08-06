/**
 * Fleet Log read routes (Elysia) — /api/fleet-log/search, /api/fleet-log/thread/:key
 *
 * #2871 landed `fleet_messages` + `fleet_ingest_cursor` and the vault ingest; these are the two
 * read routes the frontend has been declaring in `fleetLogMock.ts` while rendering fixtures.
 *
 * Whether an oracle's own correspondence is searchable knowledge was the open question that
 * kept this filed rather than built. #2855 answered it — inbox is knowledge and is indexed —
 * and fleet messages are the same category of data, so they answer it the same way.
 */
import { Elysia } from 'elysia';
import { createFleetLogSearchEndpoint } from './search.ts';
import { createFleetLogThreadEndpoint } from './thread.ts';

export function createFleetLogRoutes() {
  return new Elysia({ prefix: '/api' })
    .use(createFleetLogSearchEndpoint())
    .use(createFleetLogThreadEndpoint());
}
