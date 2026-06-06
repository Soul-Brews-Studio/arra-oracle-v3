import { Elysia } from 'elysia';
import { identityDocument } from '../../peer/identity.ts';
export const peerIdentityRoutes = new Elysia({ prefix: '/api' }).get('/identity', () => identityDocument(), { detail: { tags: ['federation'], summary: 'Stable federation identity' } });
