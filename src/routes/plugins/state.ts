import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Elysia, t } from 'elysia';
import { sanitizePluginName } from './model.ts';
import { tenantScopedPluginDirs } from './tenant.ts';

const DEFAULT_PLUGIN_DIRS = [join(homedir(), '.arra', 'plugins'), join(homedir(), '.oracle', 'plugins')];

type PluginManifest = {
  name?: string;
  enabled?: boolean;
  [key: string]: unknown;
};

function pluginDirs(): string[] {
  const configured = process.env.ARRA_PLUGIN_DIRS?.split(':').map((item) => item.trim()).filter(Boolean);
  return tenantScopedPluginDirs(configured?.length ? configured : DEFAULT_PLUGIN_DIRS);
}

function readJson(path: string): PluginManifest | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PluginManifest;
  } catch {
    return null;
  }
}

function manifestPathFor(name: string): string | null {
  const safe = sanitizePluginName(name);
  if (!safe) return null;
  for (const base of pluginDirs()) {
    const direct = join(base, safe, 'plugin.json');
    if (existsSync(direct)) return direct;
  }
  for (const base of pluginDirs()) {
    if (!existsSync(base)) continue;
    try {
      for (const entry of readdirSync(base)) {
        const dir = join(base, entry);
        if (!statSync(dir).isDirectory()) continue;
        const path = join(dir, 'plugin.json');
        if (!existsSync(path)) continue;
        const manifest = readJson(path);
        if (manifest?.name && sanitizePluginName(manifest.name) === safe) return path;
      }
    } catch {
      // best-effort fallback only
    }
  }
  return null;
}

export function readPluginEnabled(name: string): boolean | undefined {
  const path = manifestPathFor(name);
  if (!path) return undefined;
  const manifest = readJson(path);
  if (!manifest) return undefined;
  return manifest.enabled !== false;
}

export function writePluginEnabled(name: string, enabled: boolean) {
  const path = manifestPathFor(name);
  if (!path) return null;
  const manifest = readJson(path);
  if (!manifest) return null;
  const next = { ...manifest, enabled };
  writeFileSync(path, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return { path, name: manifest.name ?? sanitizePluginName(name), enabled };
}

export const pluginStateRoute = new Elysia().patch(
  '/api/plugins/:name/state',
  ({ params, body, set }) => {
    const result = writePluginEnabled(params.name, body.enabled);
    if (!result) {
      set.status = 404;
      return { error: 'plugin manifest not found', name: sanitizePluginName(params.name) };
    }
    return {
      ok: true,
      plugin: result.name,
      enabled: result.enabled,
      requiresRestart: true,
      message: 'Plugin manifest updated; restart/reload required for runtime surfaces to change.',
    };
  },
  {
    params: t.Object({ name: t.String({ minLength: 1 }) }),
    body: t.Object({ enabled: t.Boolean() }),
    detail: { tags: ['plugins'], summary: 'Enable or disable an installed plugin manifest' },
  },
);
