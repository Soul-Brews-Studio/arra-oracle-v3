/** Legacy flat /api/plugins/:name — serves wasm bytes from PLUGINS_DIR
 * directly. Canonical dual-layout resolver lives in routes-elysia/plugins. */
import { Elysia } from 'elysia';
import fs from 'fs';
import path from 'path';
import { PLUGINS_DIR } from '../../config.ts';
import { tenantScopedPluginDir } from '../plugins/tenant.ts';
import { pluginParams } from './model.ts';
import { pathWithinRoot, safePluginWasmFileName } from './path-security.ts';

const currentPluginsDir = () => tenantScopedPluginDir(
  process.env.ORACLE_DATA_DIR ? path.join(process.env.ORACLE_DATA_DIR, 'plugins') : PLUGINS_DIR,
);


export const pluginByNameRoute = new Elysia().get(
  '/api/plugins/:name',
  ({ params, set }) => {
    const file = safePluginWasmFileName(params.name);
    if (!file) {
      set.status = 400;
      return { error: 'Invalid plugin name' };
    }
    const pluginsDir = currentPluginsDir();
    const filePath = path.join(pluginsDir, file);
    if (!fs.existsSync(filePath)) {
      set.status = 404;
      return { error: 'Plugin not found' };
    }
    try {
      const realPluginsDir = fs.realpathSync(pluginsDir);
      const realFilePath = fs.realpathSync(filePath);
      if (!pathWithinRoot(realPluginsDir, realFilePath)) {
        set.status = 404;
        return { error: 'Plugin not found' };
      }
    } catch {
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
