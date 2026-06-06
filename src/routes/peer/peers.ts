import { Elysia } from 'elysia';

import { listPeerStatuses } from '../../peer/peer-query.ts';

export const peerListRoute = new Elysia().get('/api/peers', async () => ({
  peers: await listPeerStatuses(),
}), {
  detail: {
    tags: ['peer'],
    menu: { group: 'hidden' },
    summary: 'Probe configured maw federation peers with TOFU pins',
  },
});
