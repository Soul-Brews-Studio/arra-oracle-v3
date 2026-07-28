import { Elysia, t } from 'elysia';
import { listCanvasPluginMetadata } from '../../canvas/index.ts';
import { scanPlugins } from './model.ts';

const PluginListQuery = t.Object({
  kind: t.Optional(t.String()),
});

export const pluginsListRoute = new Elysia().get('/api/plugins', ({ query }) => {
  if (query.kind === 'canvas') return listCanvasPluginMetadata();
  return scanPlugins();
}, {
  query: PluginListQuery,
  detail: {
    tags: ['plugins'],
    menu: { group: 'main', path: '/plugins', order: 70 },
    summary: 'List available plugins or canvas plugin metadata',
  },
});
