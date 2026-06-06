import { Elysia } from 'elysia';
import { peerSearch } from '../../peer/search.ts';
import { isPeerAuthorized, unauthorizedPeerResponse } from '../../peer/peer-auth.ts';
async function handle({ request, body, set }: any) { if (!isPeerAuthorized(request)) { set.status = 401; return unauthorizedPeerResponse(); } return peerSearch((body ?? {}) as any); }
export const peerSearchRoutes = new Elysia({ prefix: '/api' })
  .post('/peer/search', handle, { detail: { tags: ['federation'], summary: 'Peer-callable Arra search' } })
  .post('/search', handle, { detail: { tags: ['federation'], summary: 'Peer-callable Arra search alias' } });
