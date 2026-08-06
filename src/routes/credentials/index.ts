import { Elysia } from 'elysia';
import { issueRoute } from './issue.ts';
import { verifyRoute } from './verify.ts';

export const credentialsRoutes = new Elysia({ prefix: '/api/credentials' })
  .use(issueRoute)
  .use(verifyRoute);
