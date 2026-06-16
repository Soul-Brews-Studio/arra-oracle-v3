/**
 * GET /api/inbox — list handoff files with preview + pagination.
 */

import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../config.ts';
import { tenantDataPath } from '../../middleware/tenant.ts';
import { InboxQuery } from './model.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;
const relativePath = (filePath: string) => path.relative(repoRoot(), filePath).split(path.sep).join('/');
const inboxDir = () => tenantDataPath(path.join(repoRoot(), 'ψ/inbox'));

export const inboxEndpoint = new Elysia().get(
  '/inbox',
  ({ query }) => {
    const limit = parseInt(query.limit ?? '10');
    const offset = parseInt(query.offset ?? '0');
    const type = query.type ?? 'all';

    const results: Array<{ filename: string; path: string; created: string; preview: string; type: string }> = [];

    if (type === 'all' || type === 'handoff') {
      const handoffDir = path.join(inboxDir(), 'handoff');
      if (fs.existsSync(handoffDir)) {
        const files = fs.readdirSync(handoffDir)
          .filter(f => f.endsWith('.md'))
          .sort()
          .reverse();

        for (const file of files) {
          const filePath = path.join(handoffDir, file);
          const content = fs.readFileSync(filePath, 'utf-8');
          const dateMatch = file.match(/^(\d{4}-\d{2}-\d{2})_(\d{2}-\d{2})/);
          const created = dateMatch
            ? `${dateMatch[1]}T${dateMatch[2].replace('-', ':')}:00`
            : 'unknown';

          results.push({
            filename: file,
            path: relativePath(filePath),
            created,
            preview: content.substring(0, 500),
            type: 'handoff',
          });
        }
      }
    }

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
