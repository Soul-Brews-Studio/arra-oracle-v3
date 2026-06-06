import { Elysia } from 'elysia';

import { peerInfoRoute } from './info.ts';
import { peerIdentityRoute } from './identity.ts';
import { peerListRoute } from './peers.ts';

export const peerRoutes = new Elysia()
  .use(peerInfoRoute)
  .use(peerIdentityRoute)
  .use(peerListRoute);
