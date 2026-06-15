import { Elysia } from 'elysia';
import { readFileSync } from 'fs';
import { pluginNameParams, resolveWasmPath, sanitizePluginName } from './model.ts';

export const pluginGetByNameRoute = new Elysia().get(
  '/api/plugins/:name',
  ({ params, set }) => {
    const name = sanitizePluginName(params.name);
    if (!name) {
      set.status = 400;
      return { error: 'invalid plugin name' };
    }
    const wasmPath = resolveWasmPath(name);
    if (!wasmPath) {
      set.status = 404;
      return { error: 'plugin not found', name };
    }
    const bytes = readFileSync(wasmPath);
    return new Response(bytes, {
      headers: { 'content-type': 'application/wasm' },
    });
  },
  {
    params: pluginNameParams,
    detail: {
      tags: ['plugins'],
      menu: { group: 'hidden' },
      summary: 'Fetch plugin wasm bytes',
    },
  },
);
