import { Elysia, t } from 'elysia';
import { generateToken } from './utils.ts';

export const issueRoute = new Elysia().post('/issue', ({ body, set }) => {
  const secret = process.env.ORACLE_VAULT_SECRET;
  if (!secret) {
    set.status = 500;
    return { error: 'ORACLE_VAULT_SECRET is not configured' };
  }

  const { agent, scope } = body;
  const result = generateToken(agent, scope, secret);

  return result;
}, {
  body: t.Object({
    agent: t.String(),
    scope: t.String(),
  }),
  detail: {
    tags: ['credentials'],
    summary: 'Issue a signed credential token',
  },
});
