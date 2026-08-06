import { Elysia, t } from 'elysia';
import { canvasPluginEntry, canvasRegistry, parseCanvasKind } from '../../canvas/registry.ts';

export const canvasPluginRegistryRoute = new Elysia()
  .get('/api/plugins/canvas', ({ query }) => canvasRegistry(parseCanvasKind(query.kind)), {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['plugins'], summary: 'List bundled canvas plugins' },
  })
  .get('/api/plugins/canvas/:id', ({ params, set }) => {
    const entry = canvasPluginEntry(params.id);
    if (!entry) {
      set.status = 404;
      return { error: 'canvas plugin not found', id: params.id };
    }
    return entry;
  }, {
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    detail: { tags: ['plugins'], summary: 'Get one bundled canvas plugin' },
  });
