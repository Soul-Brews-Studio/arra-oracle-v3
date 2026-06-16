import { Elysia, t } from 'elysia';

import { REPO_ROOT } from '../../config.ts';
import { runVerify } from '../../tools/verify.ts';
import type { OracleVerifyInput } from '../../tools/types.ts';

const VerifyQuery = t.Object({
  check: t.Optional(t.String()),
  type: t.Optional(t.String()),
});

const VerifyBody = t.Object({
  check: t.Optional(t.Boolean()),
  type: t.Optional(t.String()),
});

function parseBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value === 'false') return false;
  if (value === 'true') return true;
  return undefined;
}

function parseType(value: string | undefined): OracleVerifyInput['type'] {
  return ['principle', 'pattern', 'learning', 'retro', 'all'].includes(value ?? '')
    ? value as OracleVerifyInput['type']
    : 'all';
}

function queryToInput(query: { check?: string; type?: string }): OracleVerifyInput {
  return {
    check: parseBoolean(query.check),
    type: parseType(query.type),
  };
}

function bodyToInput(body: { check?: boolean; type?: string }): OracleVerifyInput {
  return {
    check: body.check,
    type: parseType(body.type),
  };
}

export const verifyRoutes = new Elysia({ prefix: '/api' })
  .get('/verify', async ({ query }) => runVerify(queryToInput(query), REPO_ROOT), {
    query: VerifyQuery,
    detail: {
      tags: ['search'],
      menu: { group: 'tools', order: 46 },
      summary: 'Verify knowledge base disk files against the DB index',
    },
  })
  .post('/verify', async ({ body }) => runVerify(bodyToInput(body), REPO_ROOT), {
    body: VerifyBody,
    detail: {
      tags: ['search'],
      summary: 'Verify knowledge base and optionally flag orphaned DB entries',
    },
  });
