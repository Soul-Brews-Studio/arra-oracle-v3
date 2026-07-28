import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Elysia } from 'elysia';

import type {
  ElysiaApp,
  ServerPlugin,
  ServerPluginApiManifest,
  ServerPluginLifecycleContext,
  ServerPluginTier,
} from './types.ts';

const USER_PLUGIN_DIR = join(homedir(), '.arra', 'plugins');
const BUNDLED_PLUGIN_DIR = join(import.meta.dir, '../../../cli/src/plugins');
const TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);
const TIERS = new Set(['core', 'standard', 'extra']);
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL']);

interface UnifiedManifestLifecycle {
  start?: boolean;
  stop?: boolean;
}

interface UnifiedManifest {
  name: string;
  version: string;
  entry: string;
  sdk: string;
  tier?: ServerPluginTier;
  enabled?: boolean;
  seedMenu?: boolean;
  api?: ServerPluginApiManifest;
  lifecycle?: UnifiedManifestLifecycle;
}

interface LoadedUnifiedManifestPlugin {
  manifest: UnifiedManifest;
  dir: string;
  entryPath: string;
}

export interface UnifiedManifestPluginOptions {
  bundledDir?: string;
  userDir?: string;
}

type UnifiedInvokeContext = {
  source: 'api' | 'lifecycle';
  args: string[];
  request?: Request;
  params?: Record<string, string>;
  query?: Record<string, unknown>;
  body?: unknown;
  lifecycle?: 'start' | 'stop';
  server?: ServerPluginLifecycleContext;
};

type UnifiedInvokeResult = {
  ok: boolean;
  output?: string;
  body?: unknown;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseManifest(raw: unknown): UnifiedManifest {
  if (!isRecord(raw)) throw new Error('manifest must be a JSON object');
  return raw as unknown as UnifiedManifest;
}

function validateUnifiedManifest(m: UnifiedManifest): void {
  if (!m.name || !/^[a-z0-9-]+$/.test(m.name)) {
    throw new Error(`manifest.name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(m.name)}`);
  }
  if (!m.version || !/^\d+\.\d+\.\d+/.test(m.version)) {
    throw new Error(`manifest.version must be semver, got: ${JSON.stringify(m.version)}`);
  }
  if (!m.entry || typeof m.entry !== 'string') {
    throw new Error('manifest.entry must be a string path');
  }
  if (!m.sdk || typeof m.sdk !== 'string') {
    throw new Error('manifest.sdk must be a semver range string');
  }
  if (m.tier !== undefined && !TIERS.has(m.tier)) {
    throw new Error(`manifest.tier must be core, standard, or extra; got: ${JSON.stringify(m.tier)}`);
  }
  if (m.enabled !== undefined && typeof m.enabled !== 'boolean') {
    throw new Error('manifest.enabled must be a boolean');
  }
  if (m.seedMenu !== undefined && typeof m.seedMenu !== 'boolean') {
    throw new Error('manifest.seedMenu must be a boolean');
  }
  if (m.api) {
    if (!m.api.path || typeof m.api.path !== 'string' || !m.api.path.startsWith('/')) {
      throw new Error('manifest.api.path must be an absolute path');
    }
    for (const method of m.api.methods ?? []) {
      if (typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase())) {
        throw new Error(`manifest.api.methods contains invalid method: ${JSON.stringify(method)}`);
      }
    }
  }
  if (m.lifecycle) {
    if (m.lifecycle.start !== undefined && typeof m.lifecycle.start !== 'boolean') {
      throw new Error('manifest.lifecycle.start must be a boolean');
    }
    if (m.lifecycle.stop !== undefined && typeof m.lifecycle.stop !== 'boolean') {
      throw new Error('manifest.lifecycle.stop must be a boolean');
    }
  }
}

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
