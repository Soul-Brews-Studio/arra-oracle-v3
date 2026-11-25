/** /api/arra/graph (memory graph) and /api/arra/ontology (Ossie document or schema graph) — #3110 graph view. */

import { Elysia, t } from 'elysia';
import { sqlite } from '../../db/index.ts';
import { buildGraph } from '../../arra/graph.ts';
import { arraOntology, ontologyGraph } from '../../arra/ontology.ts';
import { failed } from './guard.ts';

export function createArraGraphRoutes() {
  return new Elysia()
    .get('/graph', ({ query, set }) => {
      try { return { ok: true, ...buildGraph(sqlite, { source: query.source || undefined, limit: query.limit ? Number(query.limit) : undefined }) }; }
      catch (error) { return failed(set, error); }
    }, {
      query: t.Object({ source: t.Optional(t.String()), limit: t.Optional(t.String()) }),
      detail: { tags: ['arra'], summary: 'Memory graph: documents, concepts, sources, vaults, nodes, RETIRED rows' },
    })
    .get('/ontology', ({ query }) => {
      if (query.format === 'graph') return { ok: true, ...ontologyGraph() };
      // A raw Response skips the server's {success, data} envelope: the body must be the Ossie document itself.
      return new Response(`${JSON.stringify(arraOntology(), null, 2)}\n`, { headers: { 'content-type': 'application/json; charset=utf-8' } });
    }, {
      query: t.Object({ format: t.Optional(t.Union([t.Literal('ossie'), t.Literal('graph')])) }),
      detail: { tags: ['arra'], summary: 'arra memory ontology: an Apache Ossie ontology document (format=ossie, default) or its schema graph (format=graph)' },
    });
}
