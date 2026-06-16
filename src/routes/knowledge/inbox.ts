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

function parsePageInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export const inboxEndpoint = new Elysia().get(
  '/inbox',
  ({ query }) => {
    const limit = parsePageInt(query.limit, 10, 1, 100);
    const offset = parsePageInt(query.offset, 0, 0, Number.MAX_SAFE_INTEGER);
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
          if (!fs.statSync(filePath).isFile()) continue;
          let content = '';
          try { content = fs.readFileSync(filePath, 'utf-8'); } catch { continue; }
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
