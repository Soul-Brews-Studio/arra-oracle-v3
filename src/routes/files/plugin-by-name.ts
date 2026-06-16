/** Legacy flat /api/plugins/:name — serves wasm bytes from PLUGINS_DIR
 * directly. Canonical dual-layout resolver lives in routes-elysia/plugins. */
import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { PLUGINS_DIR } from '../../config.ts';
import { tenantScopedPluginDir } from '../plugins/tenant.ts';
import { pluginParams } from './model.ts';

const currentPluginsDir = () => tenantScopedPluginDir(
  process.env.ORACLE_DATA_DIR ? path.join(process.env.ORACLE_DATA_DIR, 'plugins') : PLUGINS_DIR,
);


export const pluginByNameRoute = new Elysia().get(
  '/api/plugins/:name',
  ({ params, set }) => {
    const file = params.name.endsWith('.wasm')
      ? params.name
      : `${params.name}.wasm`;
    const filePath = path.join(currentPluginsDir(), file);
    if (!fs.existsSync(filePath)) {
      set.status = 404;
      return { error: 'Plugin not found' };
    }
    const buf = fs.readFileSync(filePath);
    return new Response(buf, {
      headers: { 'Content-Type': 'application/wasm' },
    });
  },
  {
    params: pluginParams,
    detail: {
      tags: ['plugins'],
      menu: { group: 'hidden' },
      summary: 'Legacy flat plugin wasm fetch',
    },
  },
);
