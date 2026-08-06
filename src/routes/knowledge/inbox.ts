/**
 * GET /api/inbox — list handoff files with preview + pagination.
 */

import { Elysia } from 'elysia';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { tenantDataPath } from '../../middleware/tenant.ts';
import { InboxQuery } from './model.ts';
import { listHandoffFiles, parsePageInt } from '../../knowledge/inbox.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;
const inboxDir = () => tenantDataPath(path.join(repoRoot(), 'ψ/inbox'));

export const inboxEndpoint = new Elysia().get(
  '/inbox',
  ({ query }) => {
    const limit = parsePageInt(query.limit, 10, 1, 100);
    const offset = parsePageInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
    const type = query.type ?? 'all';

    const results = type === 'all' || type === 'handoff'
      ? listHandoffFiles(path.join(inboxDir(), 'handoff'), repoRoot())
      : [];

    const total = results.length;
    const paginated = results.slice(offset, offset + limit);

    return { files: paginated, total, limit, offset };
  },
  {
    query: InboxQuery,
    detail: {
      tags: ['knowledge'],
      menu: { group: 'hidden' },
      summary: 'List inbox handoff files',
    },
  },
);
