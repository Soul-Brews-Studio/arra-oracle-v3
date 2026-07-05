import { Elysia, t } from 'elysia';

import { db } from '../../db/index.ts';
import { listConcepts } from '../../tools/concepts.ts';
import type { OracleConceptsInput } from '../../tools/types.ts';

const ConceptsQuery = t.Object({
  limit: t.Optional(t.String()),
  type: t.Optional(t.String()),
});

function parseLimit(value: string | undefined): number | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function toConceptsInput(query: { limit?: string; type?: string }): OracleConceptsInput {
  const limit = parseLimit(query.limit);
  const type = ['principle', 'pattern', 'learning', 'retro', 'all'].includes(query.type ?? '')
    ? query.type as OracleConceptsInput['type']
    : 'all';
  return { limit, type };
}

export const conceptsRoutes = new Elysia({ prefix: '/api' }).get('/concepts', ({ query }) => (
  listConcepts(db, toConceptsInput(query))
), {
  query: ConceptsQuery,
  detail: {
    tags: ['search'],
    menu: { group: 'tools', order: 45 },
    summary: 'List concept tags with document counts',
  },
});
