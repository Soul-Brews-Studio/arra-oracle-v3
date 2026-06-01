import { Elysia } from 'elysia';
import { scanPlugins } from './model.ts';

export const pluginsListRoute = new Elysia().get('/api/plugins', () => scanPlugins(), {
  detail: {
    tags: ['plugins'],
    menu: { group: 'main', path: '/plugins', order: 70 },
    summary: 'List available plugins',
  },
});
