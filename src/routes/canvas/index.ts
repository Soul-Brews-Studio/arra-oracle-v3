import { Elysia, t } from 'elysia';
import { canvasPluginEntry, canvasRegistry, parseCanvasKind } from '../../canvas/registry.ts';

export const canvasRoutes = new Elysia({ name: 'canvas-routes' })
  .get('/api/canvas/plugins', ({ query }) => canvasRegistry(parseCanvasKind(query.kind)), {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['canvas'], summary: 'List canvas plugin registry entries' },
  })
  .get('/api/canvas/plugins/:id', ({ params, set }) => {
    const entry = canvasPluginEntry(params.id);
    if (!entry) {
      set.status = 404;
      return { error: 'canvas plugin not found', id: params.id };
    }
    return entry;
  }, {
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    detail: { tags: ['canvas'], summary: 'Get one canvas plugin registry entry' },
  })
  .get('/api/canvas/registry', ({ query }) => canvasRegistry(parseCanvasKind(query.kind)), {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['canvas'], summary: 'Canvas standalone registry manifest' },
  });
