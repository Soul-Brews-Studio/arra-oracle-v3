/**
 * GET /api/list — paginated document listing with optional type/asOf filters.
 */

import { Elysia } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { filterResultsAsOf, parseAsOf } from '../../search/bitemporal.ts';
import { handleList } from '../../server/handlers.ts';
import { asOfResponse } from './asof.ts';
import { ListQuery } from './model.ts';
import { parseOffset, parsePositiveInt } from './query.ts';
import { handleTenantList } from './tenant-search.ts';

export const listEndpoint = new Elysia().get(
  '/list',
  ({ query, set }) => {
    const asOf = parseAsOf(query.asOf);
    if (!asOf.ok) {
      set.status = 400;
      return { error: asOf.error };
    }
    const type = query.type ?? 'all';
    const limit = parsePositiveInt(query.limit, 10, 1000);
    const offset = parseOffset(query.offset);
    const group = query.group !== 'false';
    const tenantResult = handleTenantList(type, limit, offset, group, asOf.value);
    const result = tenantResult ?? handleList(type, limit, offset, group);
    if (asOf.value && !tenantResult) {
      result.results = filterResultsAsOf(
        sqlite,
        result.results as unknown as Array<Record<string, unknown>>,
        asOf.value,
      ) as unknown as typeof result.results;
      result.total = result.results.length;
    }
    return { ...result, ...asOfResponse(asOf.value) };
  },
  {
    query: ListQuery,
    detail: {
      tags: ['search'],
      menu: { group: 'main', path: '/feed', order: 20 },
      summary: 'List oracle documents with optional asOf valid-time filtering',
    },
  },
);
