import { Elysia, t } from 'elysia';
import { peerSearch } from '../../peer/search.ts';
import { isPeerAuthorized, unauthorizedPeerResponse } from '../../peer/peer-auth.ts';

const PeerSearchBody = t.Object({
  query: t.Optional(t.String()),
  q: t.Optional(t.String()),
  limit: t.Optional(t.Union([t.Number(), t.String()])),
});

async function handle({ request, body, set }: any) {
  if (!isPeerAuthorized(request)) {
    set.status = 401;
    return unauthorizedPeerResponse();
  }
  return peerSearch((body ?? {}) as any);
}

export const peerSearchRoutes = new Elysia({ prefix: '/api' })
  .post('/peer/search', handle, {
    body: PeerSearchBody,
    detail: { tags: ['federation'], summary: 'Peer-callable Arra search' },
  })
  .post('/search', handle, {
    body: PeerSearchBody,
    detail: { tags: ['federation'], summary: 'Peer-callable Arra search alias' },
  });
