import { Elysia, t } from 'elysia';
import { verifyToken } from './utils.ts';

export const verifyRoute = new Elysia().get('/verify', ({ query, set }) => {
  const secret = process.env.ORACLE_VAULT_SECRET;
  if (!secret) {
    set.status = 500;
    return { error: 'ORACLE_VAULT_SECRET is not configured' };
  }

  const { token } = query;
  const result = verifyToken(token, secret);

  if (!result.valid) {
    return {
      valid: false,
      agent: null,
      scope: null,
      expires_at: null,
    };
  }

  return {
    valid: true,
    agent: result.agent ?? null,
    scope: result.scope ?? null,
    expires_at: result.expires_at ?? null,
  };
}, {
  query: t.Object({
    token: t.String(),
  }),
  detail: {
    tags: ['credentials'],
    summary: 'Verify a signed credential token',
  },
});
