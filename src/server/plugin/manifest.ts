import type { ServerPlugin } from './types.ts';

const TIERS = new Set(['core', 'standard', 'extra']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL']);

export function validateServerPlugin(plugin: ServerPlugin): void {
  if (!plugin.name || !/^[a-z0-9-]+$/.test(plugin.name)) {
    throw new Error(`server plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(plugin.name)}`);
  }
  if (!TIERS.has(plugin.tier)) {
    throw new Error(`server plugin "${plugin.name}" has invalid tier: ${JSON.stringify(plugin.tier)}`);
  }
  if (plugin.start !== undefined && typeof plugin.start !== 'function') {
    throw new Error(`server plugin "${plugin.name}" start must be a function`);
  }
  if (plugin.stop !== undefined && typeof plugin.stop !== 'function') {
    throw new Error(`server plugin "${plugin.name}" stop must be a function`);
  }
  if (plugin.api) {
    if (!plugin.api.path || typeof plugin.api.path !== 'string' || !plugin.api.path.startsWith('/')) {
      throw new Error(`server plugin "${plugin.name}" api.path must be an absolute path`);
    }
    for (const method of plugin.api.methods ?? []) {
      if (typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase())) {
        throw new Error(`server plugin "${plugin.name}" api.methods contains invalid method: ${JSON.stringify(method)}`);
      }
    }
  }
}

export function parseDisabledPlugins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export const parseEnabledPlugins = parseDisabledPlugins;
