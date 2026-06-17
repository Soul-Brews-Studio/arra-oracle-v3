import { Elysia } from 'elysia';
import { REPO_ROOT } from '../../config.ts';
import { db, sqlite } from '../../db/index.ts';
import { handleRead } from '../../tools/read.ts';
import type { ToolContext } from '../../tools/types.ts';
import { readQuery } from './model.ts';

const repoRoot = () => process.env.ORACLE_REPO_ROOT || REPO_ROOT;

export const readRoute = new Elysia().get(
  '/api/read',
  async ({ query, set }) => {
    const file = query.file;
    const id = query.id;
    if (!file && !id) {
      set.status = 400;
      return { error: 'Provide file or id parameter' };
    }
    const ctx = { db, sqlite, repoRoot: repoRoot() } as Pick<
      ToolContext,
      'db' | 'sqlite' | 'repoRoot'
    >;
    const result = await handleRead(ctx as ToolContext, {
      file: file || undefined,
      id: id || undefined,
    });
    const text = result.content[0]?.text || '{}';
    if (result.isError) {
      set.status = 404;
      return JSON.parse(text);
    }
    return JSON.parse(text);
  },
  {
    query: readQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'hidden' },
      summary: 'Read a file or doc by id',
    },
  },
);
