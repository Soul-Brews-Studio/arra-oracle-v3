import { Elysia } from 'elysia';
import { federationInfo } from '../../peer/identity.ts';
export const peerInfoRoutes = new Elysia().get('/info', () => federationInfo(), { detail: { tags: ['federation'], summary: 'MAW federation info' } });
