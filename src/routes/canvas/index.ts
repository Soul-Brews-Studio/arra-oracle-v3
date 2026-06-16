import { Elysia, t } from 'elysia';
import { findCanvasPlugin, listCanvasPlugins, type CanvasPluginKind } from '../../canvas/plugins.ts';

const kinds = new Set<CanvasPluginKind>(['three', 'react']);

function parseKind(value: unknown): CanvasPluginKind | undefined {
  return typeof value === 'string' && kinds.has(value as CanvasPluginKind) ? value as CanvasPluginKind : undefined;
}

function registry(kind?: CanvasPluginKind) {
  const plugins = listCanvasPlugins(kind);
  return {
    plugins,
    count: plugins.length,
    kind: kind ?? 'all',
    standalone: {
      host: 'canvas.buildwithoracle.com',
      defaultPlugin: 'wave',
      serveCommand: 'bun run src/cli/index.ts canvas-serve --port 47779',
    },
  };
}

export const canvasRoutes = new Elysia({ name: 'canvas-routes' })
  .get('/api/canvas/plugins', ({ query }) => registry(parseKind(query.kind)), {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['canvas'], summary: 'List canvas plugin registry entries' },
  })
  .get('/api/canvas/plugins/:id', ({ params, set }) => {
    const plugin = findCanvasPlugin(params.id);
    if (!plugin) {
      set.status = 404;
      return { error: 'canvas plugin not found', id: params.id };
    }
    return { plugin };
  }, {
    params: t.Object({ id: t.String({ minLength: 1 }) }),
    detail: { tags: ['canvas'], summary: 'Get one canvas plugin registry entry' },
  })
  .get('/api/canvas/registry', ({ query }) => registry(parseKind(query.kind)), {
    query: t.Object({ kind: t.Optional(t.String()) }),
    detail: { tags: ['canvas'], summary: 'Canvas standalone registry manifest' },
  });
