import { Elysia } from 'elysia';
import { handleGraph } from '../../server/handlers.ts';
import { graphQuery } from './model.ts';
import { handleTenantGraph } from './tenant.ts';

export const graphRoute = new Elysia().get(
  '/api/graph',
  ({ query }) => {
    const limit = query.limit ? parseInt(query.limit, 10) : undefined;
    return handleTenantGraph(limit) ?? handleGraph(limit);
  },
  {
    query: graphQuery,
    detail: {
      tags: ['files'],
      menu: { group: 'tools', order: 10 },
      summary: 'Graph visualization data',
    },
  },
);
