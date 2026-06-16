import { Elysia } from 'elysia';
import { handleContext } from '../../server/context.ts';
import { contextQuery } from './model.ts';
import { projectAllowedForTenant } from './tenant.ts';

export const contextRoute = new Elysia().get(
  '/api/context',
  ({ query, set }) => {
    const result = handleContext(query.cwd);
    if ('ghqPath' in result && !projectAllowedForTenant(result.ghqPath)) {
      set.status = 404;
      return { error: 'Project not found' };
    }
    return result;
  },
  {
    query: contextQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'tools', path: '/evolution', order: 40 },
      summary: 'Context for a working directory',
    },
  },
);
