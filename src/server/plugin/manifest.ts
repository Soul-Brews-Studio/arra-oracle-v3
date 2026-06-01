import type { ServerPlugin } from './types.ts';

const TIERS = new Set(['core', 'standard', 'extra']);

export function validateServerPlugin(plugin: ServerPlugin): void {
  if (!plugin.name || !/^[a-z0-9-]+$/.test(plugin.name)) {
    throw new Error(`server plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(plugin.name)}`);
  }
  if (!TIERS.has(plugin.tier)) {
    throw new Error(`server plugin "${plugin.name}" has invalid tier: ${JSON.stringify(plugin.tier)}`);
  }
}

export function parseDisabledPlugins(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
