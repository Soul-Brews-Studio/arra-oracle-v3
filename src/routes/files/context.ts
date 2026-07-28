import { Elysia } from 'elysia';
import { handleContext } from '../../server/context.ts';
import { contextQuery } from './model.ts';

export const contextRoute = new Elysia().get(
  '/api/context',
  ({ query }) => handleContext(query.cwd),
  {
    query: contextQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'tools', path: '/evolution', order: 40 },
      summary: 'Context for a working directory',
    },
  },
);
