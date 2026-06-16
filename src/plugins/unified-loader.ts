import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Elysia } from 'elysia';
import { normalizeUnifiedPluginManifest, type NormalizedUnifiedPluginManifest, type UnifiedApiRouteManifest, type UnifiedCliSubcommandManifest, type UnifiedMcpToolManifest, type UnifiedMenuManifest } from './unified-manifest.ts';
import { sortPluginsByDependencies } from './dependency-resolver.ts';
import { pluginRegistryFromLoadedPlugins, type LoadedPluginRegistryEntry } from './registry.ts';
import { runPluginWithErrorContainment } from './error-containment.ts';
import { createUnifiedProxyRoute } from './proxy-surface.ts';
import { unifiedPluginServerRoutes, type UnifiedPluginServer } from './unified-server.ts';
import { isContainedPluginPath, resolveContainedPluginEntry } from './path-containment.ts';
import { registerPluginExportFormats } from './export-format-init.ts';
import { defaultUnifiedPluginDirs } from './plugin-dirs.ts';
import { isPluginInvokeFailure, pluginFailureMessage, responseFromPluginResult, withPluginTimeout } from './plugin-result.ts';

const DEFAULT_TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);

type ElysiaApp = Elysia<any, any, any, any, any, any, any>; type JsonRecord = Record<string, unknown>; type LifecycleSource = 'init' | 'destroy';

export interface LoadedUnifiedPlugin {
  manifest: NormalizedUnifiedPluginManifest;
  dir: string;
  entryPath: string;
}

export interface UnifiedLoaderOptions {
  dirs?: string[];
  warn?: (message: string) => void;
  timeoutMs?: number;
}

export type UnifiedPluginStatus = { name: string; status: 'ok' | 'degraded'; error?: string };

export interface UnifiedRuntime {
  pluginCount?: number;
  routes: ElysiaApp[];
  mcpTools: Array<UnifiedMcpToolManifest & { plugin: string }>;
  menu: Array<UnifiedMenuManifest & { plugin: string }>;
  cliSubcommands: Array<UnifiedCliSubcommandManifest & { plugin: string }>;
  servers: UnifiedPluginServer[];
  callMcpTool: (name: string, args?: unknown) => Promise<unknown>;
  pluginStatuses: () => UnifiedPluginStatus[];
  pluginRegistry: () => LoadedPluginRegistryEntry[];
  init: () => Promise<void>;
  stop: () => Promise<void>;
}

interface InvokeContext {
  source: 'api' | 'mcp' | 'cli' | 'server' | LifecycleSource;
  plugin: string;
  args?: unknown[] | JsonRecord;
  request?: Request;
  params?: JsonRecord;
  query?: JsonRecord;
  body?: unknown;
}


function warn(options: UnifiedLoaderOptions, message: string): void {
  options.warn?.(`[unified-plugin] ${message}`);
}

async function readPluginDir(dir: string, options: UnifiedLoaderOptions): Promise<LoadedUnifiedPlugin | null> {
  const path = join(dir, 'plugin.json');
  if (!existsSync(path)) return null;
  try {
    const raw = await Bun.file(path).json();
    const manifest = normalizeUnifiedPluginManifest(raw);
    if (manifest.enabled === false) return null;
    return { manifest, dir, entryPath: resolveContainedPluginEntry(dir, manifest.entry) };
  } catch (error) {
    warn(options, `skipped ${dir}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

export async function discoverUnifiedPluginManifests(
  options: UnifiedLoaderOptions = {},
): Promise<LoadedUnifiedPlugin[]> {
  const found: LoadedUnifiedPlugin[] = [];
  const seen = new Set<string>();
  for (const baseDir of options.dirs ?? defaultUnifiedPluginDirs()) {
    if (!existsSync(baseDir)) continue;
    let entries: Array<{ name: string; isDirectory(): boolean; isSymbolicLink(): boolean }>;
    try {
      entries = readdirSync(baseDir, { withFileTypes: true });
    } catch (error) {
      warn(options, `skipped ${baseDir}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const pluginDir = join(baseDir, entry.name);
      if (!isContainedPluginPath(baseDir, pluginDir)) { warn(options, `skipped ${pluginDir}: plugin directory symlink escapes plugin root`); continue; }
      const loaded = await readPluginDir(pluginDir, options);
      if (!loaded || seen.has(loaded.manifest.name)) continue;
      seen.add(loaded.manifest.name);
      found.push(loaded);
    }
  }
  return found;
}

async function invoke(plugin: LoadedUnifiedPlugin, handler: string | undefined, ctx: InvokeContext, timeoutMs: number) {
  if (!handler) return { ok: true, plugin: plugin.manifest.name, source: ctx.source };
  const result = await runPluginWithErrorContainment({
    plugin: plugin.manifest.name,
    phase: ctx.source === 'init' || ctx.source === 'destroy' ? ctx.source : 'runtime',
  }, async () => {
    const mod = await import(pathToFileURL(plugin.entryPath).href);
    const fn = handler === 'default' ? mod.default : (mod[handler] ?? mod.default);
    if (typeof fn !== 'function') throw new Error(`handler not found: ${handler}`);
    return await withPluginTimeout(() => fn({ ...ctx, config: plugin.manifest.config ?? {} }), timeoutMs);
  });
  return result.ok ? result.value : { ok: false, error: result.error };
}

function apiRoute(plugin: LoadedUnifiedPlugin, route: UnifiedApiRouteManifest, timeoutMs: number): ElysiaApp {
  const app = new Elysia({ name: `unified:${plugin.manifest.name}:api:${route.path}` });
  for (const method of route.methods?.length ? route.methods : ['GET']) {
    (app as any).route(method.toUpperCase(), route.path, async ({ request, params, query, body }: any) => {
      const result = await invoke(plugin, route.handler, {
        source: 'api',
        plugin: plugin.manifest.name,
        args: (body ?? query) as JsonRecord,
        request,
        params,
        query,
        body,
      }, timeoutMs);
      return responseFromPluginResult(result);
    });
  }
  return app;
}

function runtimeFrom(plugins: LoadedUnifiedPlugin[], options: UnifiedLoaderOptions): UnifiedRuntime {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const routes: ElysiaApp[] = [];
  const mcpTools: UnifiedRuntime['mcpTools'] = [];
  const menu: UnifiedRuntime['menu'] = [];
  const cliSubcommands: UnifiedRuntime['cliSubcommands'] = [];
  const servers: UnifiedRuntime['servers'] = [];
  const mcpInvokers = new Map<string, { plugin: LoadedUnifiedPlugin; tool: UnifiedMcpToolManifest }>();
  const initialized = new Set<string>();
  const pluginStatus = new Map<string, UnifiedPluginStatus>();

  for (const plugin of plugins) {
    pluginStatus.set(plugin.manifest.name, { name: plugin.manifest.name, status: 'ok' });
    for (const tool of plugin.manifest.mcpTools) {
      mcpTools.push({ ...tool, plugin: plugin.manifest.name });
      mcpInvokers.set(tool.name, { plugin, tool });
    }
    for (const route of plugin.manifest.apiRoutes) routes.push(apiRoute(plugin, route, timeoutMs));
    for (const proxy of plugin.manifest.proxy) routes.push(createUnifiedProxyRoute(plugin.manifest.name, proxy));
    if (plugin.manifest.server) {
      servers.push({
        ...plugin.manifest.server,
        plugin: plugin.manifest.name,
        dir: plugin.dir,
        routePrefix: `/api/plugins/${plugin.manifest.name}/server`,
      });
    }
    for (const item of plugin.manifest.menu) menu.push({ ...item, plugin: plugin.manifest.name });
    for (const command of plugin.manifest.cliSubcommands) {
      cliSubcommands.push({ ...command, plugin: plugin.manifest.name });
    }
  }
  if (servers.length) routes.push(unifiedPluginServerRoutes(servers));

  const callMcpTool = async (name: string, args?: unknown): Promise<unknown> => {
    const hit = mcpInvokers.get(name);
    if (!hit) return { ok: false, error: `MCP tool not found: ${name}` };
    return invoke(hit.plugin, hit.tool.handler, { source: 'mcp', plugin: hit.plugin.manifest.name, args: [args], body: args }, timeoutMs);
  };
  const invokeLifecycle = async (source: LifecycleSource, plugin: LoadedUnifiedPlugin) => {
    const result = await invoke(plugin, plugin.manifest.lifecycle?.[source], {
      source,
      plugin: plugin.manifest.name,
    }, timeoutMs);
    if (isPluginInvokeFailure(result)) {
      const error = pluginFailureMessage(result.error);
      pluginStatus.set(plugin.manifest.name, { name: plugin.manifest.name, status: 'degraded', error });
      warn(options, `${plugin.manifest.name}.${source} failed: ${error}`);
    } else {
      pluginStatus.set(plugin.manifest.name, { name: plugin.manifest.name, status: 'ok' });
      if (source === 'init') initialized.add(plugin.manifest.name);
    }
  };
  const init = async () => {
    for (const plugin of plugins) {
      if (plugin.manifest.exportFormats.length) {
        const error = await registerPluginExportFormats(plugin, timeoutMs);
        if (error) { pluginStatus.set(plugin.manifest.name, { name: plugin.manifest.name, status: 'degraded', error }); continue; }
      }
      if (!plugin.manifest.lifecycle?.init || initialized.has(plugin.manifest.name)) continue;
      await invokeLifecycle('init', plugin);
    }
  };
  const stop = async () => {
    for (const plugin of [...plugins].reverse()) {
      if (!plugin.manifest.lifecycle?.destroy) continue;
      if (plugin.manifest.lifecycle.init && !initialized.has(plugin.manifest.name)) continue;
      await invokeLifecycle('destroy', plugin);
    }
    initialized.clear();
  };
  const pluginStatuses = () => plugins.map((plugin) => pluginStatus.get(plugin.manifest.name)
    ?? { name: plugin.manifest.name, status: 'ok' as const });
  const pluginRegistry = () => pluginRegistryFromLoadedPlugins(plugins, pluginStatuses());
  return { pluginCount: plugins.length, routes, mcpTools, menu, cliSubcommands, servers, callMcpTool, pluginStatuses, pluginRegistry, init, stop };
}

export async function loadUnifiedPlugins(options: UnifiedLoaderOptions = {}): Promise<UnifiedRuntime> {
  try {
    const plugins = await discoverUnifiedPluginManifests(options);
    return runtimeFrom(sortPluginsByDependencies(plugins, { warn: options.warn }), options);
  } catch (error) {
    warn(options, `loader disabled: ${error instanceof Error ? error.message : String(error)}`);
    return runtimeFrom([], options);
  }
}

export type UnifiedPluginMenuSeedItem = UnifiedMenuManifest & { plugin: string };
export async function seedUnifiedPluginMenuItems(items: UnifiedPluginMenuSeedItem[]): Promise<void> {
  return (await import('./unified-menu-seeder.ts')).seedUnifiedPluginMenuItems(items);
}
export { defaultUnifiedPluginDirs } from './plugin-dirs.ts';
