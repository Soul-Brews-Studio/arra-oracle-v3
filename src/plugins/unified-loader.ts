import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Elysia } from 'elysia';

import {
  normalizeUnifiedPluginManifest,
  type NormalizedUnifiedPluginManifest,
  type UnifiedApiRouteManifest,
  type UnifiedCliSubcommandManifest,
  type UnifiedMcpToolManifest,
  type UnifiedMenuManifest,
  type UnifiedServerManifest,
} from './unified-manifest.ts';
import { createUnifiedProxyRoute } from './proxy-surface.ts';

const DEFAULT_TIMEOUT_MS = Number(process.env.ARRA_PLUGIN_TIMEOUT_MS ?? 5000);
const DEFAULT_DIRS = [join(homedir(), '.arra', 'plugins'), join(homedir(), '.oracle', 'plugins')];

type ElysiaApp = Elysia<any, any, any, any, any, any, any>;
type JsonRecord = Record<string, unknown>;

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

export interface UnifiedRuntime {
  routes: ElysiaApp[];
  mcpTools: Array<UnifiedMcpToolManifest & { plugin: string }>;
  menu: Array<UnifiedMenuManifest & { plugin: string }>;
  cliSubcommands: Array<UnifiedCliSubcommandManifest & { plugin: string }>;
  servers: Array<UnifiedServerManifest & { plugin: string }>;
  callMcpTool: (name: string, args?: unknown) => Promise<unknown>;
  stop: () => Promise<void>;
}

interface InvokeContext {
  source: 'api' | 'mcp' | 'cli' | 'server';
  plugin: string;
  args?: unknown[];
  request?: Request;
  params?: JsonRecord;
  query?: JsonRecord;
  body?: unknown;
}

interface InvokeResult {
  ok?: boolean;
  body?: unknown;
  output?: string;
  status?: number;
  headers?: Record<string, string>;
  error?: string;
}

function uniqueDirs(dirs: string[]): string[] {
  return [...new Set(dirs.filter(Boolean))];
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
    return { manifest, dir, entryPath: resolve(dir, manifest.entry) };
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
  for (const baseDir of uniqueDirs(options.dirs ?? DEFAULT_DIRS)) {
    if (!existsSync(baseDir)) continue;
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
      const loaded = await readPluginDir(join(baseDir, entry.name), options);
      if (!loaded || seen.has(loaded.manifest.name)) continue;
      seen.add(loaded.manifest.name);
      found.push(loaded);
    }
  }
  return found;
}

async function invoke(plugin: LoadedUnifiedPlugin, handler: string | undefined, ctx: InvokeContext, timeoutMs: number) {
  if (!handler) return { ok: true, plugin: plugin.manifest.name, source: ctx.source };
  try {
    const mod = await import(pathToFileURL(plugin.entryPath).href);
    const fn = handler === 'default' ? mod.default : (mod[handler] ?? mod.default);
    if (typeof fn !== 'function') return { ok: false, error: `handler not found: ${handler}` };
    return await Promise.race([
      Promise.resolve(fn(ctx)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('handler timed out')), timeoutMs)),
    ]);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function responseFrom(result: unknown): unknown {
  if (result instanceof Response) return result;
  const record = (result && typeof result === 'object') ? result as InvokeResult : null;
  if (!record) return result ?? { ok: true };
  if (record.ok === false) {
    return Response.json(
      { ok: false, error: record.error ?? 'plugin failed' },
      { status: record.status ?? 500, headers: record.headers },
    );
  }
  if (record.body !== undefined) return record.body;
  if (record.output !== undefined) return { ok: true, output: record.output };
  return record;
}

function apiRoute(plugin: LoadedUnifiedPlugin, route: UnifiedApiRouteManifest, timeoutMs: number): ElysiaApp {
  const app = new Elysia({ name: `unified:${plugin.manifest.name}:api:${route.path}` });
  for (const method of route.methods?.length ? route.methods : ['GET']) {
    (app as any).route(method.toUpperCase(), route.path, async ({ request, params, query, body }: any) => {
      const result = await invoke(plugin, route.handler, {
        source: 'api',
        plugin: plugin.manifest.name,
        request,
        params,
        query,
        body,
      }, timeoutMs);
      return responseFrom(result);
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

  for (const plugin of plugins) {
    for (const tool of plugin.manifest.mcpTools) {
      mcpTools.push({ ...tool, plugin: plugin.manifest.name });
      mcpInvokers.set(tool.name, { plugin, tool });
    }
    for (const route of plugin.manifest.apiRoutes) routes.push(apiRoute(plugin, route, timeoutMs));
    for (const proxy of plugin.manifest.proxy) routes.push(createUnifiedProxyRoute(plugin.manifest.name, proxy));
    if (plugin.manifest.server) servers.push({ ...plugin.manifest.server, plugin: plugin.manifest.name });
    for (const item of plugin.manifest.menu) menu.push({ ...item, plugin: plugin.manifest.name });
    for (const command of plugin.manifest.cliSubcommands) {
      cliSubcommands.push({ ...command, plugin: plugin.manifest.name });
    }
  }

  const callMcpTool = async (name: string, args?: unknown): Promise<unknown> => {
    const hit = mcpInvokers.get(name);
    if (!hit) return { ok: false, error: `MCP tool not found: ${name}` };
    return invoke(hit.plugin, hit.tool.handler, { source: 'mcp', plugin: hit.plugin.manifest.name, args: [args], body: args }, timeoutMs);
  };
  return { routes, mcpTools, menu, cliSubcommands, servers, callMcpTool, stop: async () => {} };
}

export async function loadUnifiedPlugins(options: UnifiedLoaderOptions = {}): Promise<UnifiedRuntime> {
  try {
    return runtimeFrom(await discoverUnifiedPluginManifests(options), options);
  } catch (error) {
    warn(options, `loader disabled: ${error instanceof Error ? error.message : String(error)}`);
    return runtimeFrom([], options);
  }
}

export { seedUnifiedPluginMenuItems } from './unified-menu-seeder.ts';
