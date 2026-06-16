import { Elysia, t } from 'elysia';
import { getPeerFeed } from '../../peer/feed.ts';
import { isPeerAuthorized, unauthorizedPeerResponse } from '../../peer/peer-auth.ts';

const PeerFeedQuery = t.Object({ limit: t.Optional(t.String()) });

export const peerFeedRoutes = new Elysia({ prefix: '/api' }).get('/peer/feed', async ({ request, query, set }) => {
  if (!isPeerAuthorized(request)) {
    set.status = 401;
    return unauthorizedPeerResponse();
  }
  return getPeerFeed(query.limit);
}, {
  query: PeerFeedQuery,
  detail: { tags: ['federation'], summary: 'Peer-readable federation feed' },
});
