import { Elysia } from 'elysia';
import { listPeerStatuses } from '../../peer/peer-query.ts';
export const peerListRoutes = new Elysia({ prefix: '/api' }).get('/peers', async () => ({ peers: await listPeerStatuses() }), { detail: { tags: ['federation'], summary: 'Probe configured peers with TOFU pins' } });
