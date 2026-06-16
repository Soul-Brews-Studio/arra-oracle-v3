import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Elysia } from 'elysia';

import {
  BUNDLED_PLUGIN_DIR,
  TIMEOUT_MS,
  USER_PLUGIN_DIR,
  parseManifest,
  validateUnifiedManifest,
  type LoadedUnifiedManifestPlugin,
  type UnifiedInvokeContext,
  type UnifiedInvokeResult,
  type UnifiedManifestPluginOptions,
} from './unified-types.ts';
import type {
  ElysiaApp,
  ServerPlugin,
} from './types.ts';

async function loadPluginDir(dir: string): Promise<LoadedUnifiedManifestPlugin | null> {
  const manifestPath = join(dir, 'plugin.json');
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = parseManifest(await Bun.file(manifestPath).json());
    validateUnifiedManifest(manifest);
    if (!manifest.api && !manifest.lifecycle) return null;
    return { manifest, dir, entryPath: resolve(dir, manifest.entry) };
  } catch (error) {
    console.warn(`[server-plugin] skipped unified manifest plugin at ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function discoverUnifiedManifestPlugins(
  options: UnifiedManifestPluginOptions = {},
): Promise<LoadedUnifiedManifestPlugin[]> {
  const plugins: LoadedUnifiedManifestPlugin[] = [];
  const seen = new Set<string>();
  const scanDirs: Array<[string, string]> = [
    ['user', options.userDir ?? USER_PLUGIN_DIR],
    ['bundled', options.bundledDir ?? BUNDLED_PLUGIN_DIR],
  ];

  for (const [, baseDir] of scanDirs) {
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const loaded = await loadPluginDir(join(baseDir, entry.name));
      if (!loaded || seen.has(loaded.manifest.name)) continue;
      seen.add(loaded.manifest.name);
      plugins.push(loaded);
    }
  }

  return plugins;
}

async function invokeUnifiedPlugin(
  plugin: LoadedUnifiedManifestPlugin,
  context: UnifiedInvokeContext,
): Promise<UnifiedInvokeResult> {
  const mod = await import(pathToFileURL(plugin.entryPath).href);
  const handler = mod.default;
  if (typeof handler !== 'function') {
    return { ok: false, error: `plugin ${plugin.manifest.name}: default export must be a function` };
  }

  return await Promise.race([
    handler(context) as Promise<UnifiedInvokeResult>,
    new Promise<UnifiedInvokeResult>((_, reject) =>
      setTimeout(() => reject(new Error(`plugin ${plugin.manifest.name} timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS),
    ),
  ]) ?? { ok: true };
}

function responseFromResult(result: UnifiedInvokeResult): Response | Record<string, unknown> | unknown {
  if (!result.ok) {
    return Response.json(
      { ok: false, error: result.error ?? 'plugin failed' },
      { status: result.status ?? 500, headers: result.headers },
    );
  }
  if (result.body !== undefined) return result.body;
  if (result.output !== undefined) return { ok: true, output: result.output };
  return { ok: true };
}

function apiRoutes(plugin: LoadedUnifiedManifestPlugin): ElysiaApp | undefined {
  const api = plugin.manifest.api;
  if (!api) return undefined;
  const methods = (api.methods?.length ? api.methods : ['GET']).map((method) => method.toUpperCase());
  const app = new Elysia();

  for (const method of methods) {
    (app as any).route(method, '/', async ({ request, params, query, body }: any) => {
      try {
        const result = await invokeUnifiedPlugin(plugin, {
          source: 'api',
          args: [],
          request,
          params,
          query,
          body,
        });
        return responseFromResult(result);
      } catch (error) {
        return Response.json(
          { ok: false, error: error instanceof Error ? error.message : String(error) },
          { status: 500 },
        );
      }
    });
  }

  return app;
}

export function createUnifiedManifestServerPlugin(plugin: LoadedUnifiedManifestPlugin): ServerPlugin {
  const routes = apiRoutes(plugin);
  const lifecycle = plugin.manifest.lifecycle;
  return {
    name: plugin.manifest.name,
    tier: plugin.manifest.tier ?? 'extra',
    enabled: plugin.manifest.enabled,
    seedMenu: plugin.manifest.seedMenu ?? true,
    api: plugin.manifest.api,
    routes: routes ? () => routes : undefined,
    start: lifecycle?.start
      ? async (server) => {
          const result = await invokeUnifiedPlugin(plugin, {
            source: 'lifecycle',
            args: ['start'],
            lifecycle: 'start',
            server,
          });
          if (!result.ok) throw new Error(result.error ?? `plugin ${plugin.manifest.name} start failed`);
        }
      : undefined,
    stop: lifecycle?.stop
      ? async (server) => {
          const result = await invokeUnifiedPlugin(plugin, {
            source: 'lifecycle',
            args: ['stop'],
            lifecycle: 'stop',
            server,
          });
          if (!result.ok) throw new Error(result.error ?? `plugin ${plugin.manifest.name} stop failed`);
        }
      : undefined,
  };
}

export async function createUnifiedManifestServerPlugins(
  options: UnifiedManifestPluginOptions = {},
): Promise<ServerPlugin[]> {
  const plugins = await discoverUnifiedManifestPlugins(options);
  return plugins.map(createUnifiedManifestServerPlugin);
}
