import { Elysia, t } from 'elysia';
import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginKind } from '../../canvas/plugins.ts';

const kinds = new Set<CanvasPluginKind>(['three', 'react']);

function parseKind(value: unknown): CanvasPluginKind | undefined {
  return typeof value === 'string' && kinds.has(value as CanvasPluginKind) ? value as CanvasPluginKind : undefined;
}

export const canvasPluginRegistryRoute = new Elysia()
  .get('/api/plugins/canvas', ({ query }) => {
    const kind = parseKind(query.kind);
    const plugins = listCanvasPlugins(kind);
    return { plugins, count: plugins.length, kind: kind ?? 'all' };
  }, {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['plugins'], summary: 'List bundled canvas plugins' },
  })
  .get('/api/plugins/canvas/:id', ({ params, set }) => {
    const plugin = findCanvasPlugin(params.id);
    if (!plugin) {
      set.status = 404;
      return { error: 'canvas plugin not found', id: params.id };
    }
    return { plugin };
  }, {
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    detail: { tags: ['plugins'], summary: 'Get one bundled canvas plugin' },
  });
