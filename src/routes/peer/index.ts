import { Elysia } from 'elysia';
import { peerInfoRoutes } from './info.ts';
import { peerIdentityRoutes } from './identity.ts';
import { peerListRoutes } from './peers.ts';
import { peerFeedRoutes } from './feed.ts';
import { peerSearchRoutes } from './search.ts';
export const peerRoutes = new Elysia()
  .use(peerInfoRoutes)
  .use(peerIdentityRoutes)
  .use(peerListRoutes)
  .use(peerFeedRoutes)
  .use(peerSearchRoutes);
