import { Elysia } from 'elysia';
import { getPeerFeed } from '../../peer/feed.ts';
import { isPeerAuthorized, unauthorizedPeerResponse } from '../../peer/peer-auth.ts';
export const peerFeedRoutes = new Elysia({ prefix: '/api' }).get('/peer/feed', async ({ request, query, set }) => { if (!isPeerAuthorized(request)) { set.status = 401; return unauthorizedPeerResponse(); } return getPeerFeed(query.limit); }, { detail: { tags: ['federation'], summary: 'Peer-readable federation feed' } });
