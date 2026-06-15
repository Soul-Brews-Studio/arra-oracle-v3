import type { ServerPluginTier } from '../server/plugin/types.ts';
import { validatePluginConfig, type JsonSchema } from './config-schema.ts';

export type UnifiedPluginSurface =
  | 'mcpTools'
  | 'apiRoutes'
  | 'proxy'
  | 'server'
  | 'menu'
  | 'cliSubcommands';

export type UnifiedHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS' | 'HEAD' | 'ALL';
export type UnifiedPluginRenderer = 'Three' | 'React';

export interface UnifiedMcpToolManifest {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: string;
  group?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
}

export interface UnifiedApiRouteManifest {
  path: string;
  methods?: UnifiedHttpMethod[];
  handler?: string;
}

export interface UnifiedProxyManifest {
  path: string;
  targetEnv: string;
  stripPrefix?: boolean;
  methods?: UnifiedHttpMethod[];
}

export interface UnifiedServerManifest {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  healthPath?: string;
  autostart?: boolean;
}

export type PublicUnifiedServerManifest = Omit<UnifiedServerManifest, 'env'>;

export interface UnifiedMenuManifest {
  label: string;
  path: string;
  group?: 'main' | 'tools' | 'hidden';
  order?: number;
  icon?: string;
}

export interface UnifiedCliSubcommandManifest {
  command: string;
  help: string;
  handler?: string;
}

export interface UnifiedLifecycleManifest {
  init?: string;
  destroy?: string;
  start?: boolean;
  stop?: boolean;
}

export interface UnifiedPluginManifest {
  name: string;
  version: string;
  entry: string;
  sdk?: string;
  tier?: ServerPluginTier;
  enabled?: boolean;
  description?: string;
  depends?: string[];
  config?: unknown;
  configSchema?: JsonSchema;
  mcpTools?: UnifiedMcpToolManifest[];
  apiRoutes?: UnifiedApiRouteManifest[];
  proxy?: UnifiedProxyManifest[];
  server?: UnifiedServerManifest;
  menu?: UnifiedMenuManifest[];
  cliSubcommands?: UnifiedCliSubcommandManifest[];

  /** Legacy compatibility aliases used by existing ServerPlugin/CLI manifests. */
  api?: { path: string; methods?: UnifiedHttpMethod[] };
  lifecycle?: UnifiedLifecycleManifest;
  seedMenu?: boolean;
  cli?: { command: string; help: string };
}

export interface NormalizedUnifiedPluginManifest extends Omit<UnifiedPluginManifest, 'api' | 'cli' | 'seedMenu'> {
  sdk: string;
  depends: string[];
  apiRoutes: UnifiedApiRouteManifest[];
  mcpTools: UnifiedMcpToolManifest[];
  proxy: UnifiedProxyManifest[];
  menu: UnifiedMenuManifest[];
  cliSubcommands: UnifiedCliSubcommandManifest[];
}

const NAME_RE = /^[a-z0-9-]+$/;
const SEMVER_RE = /^\d+\.\d+\.\d+/;
const TOOL_RE = /^[a-z][a-z0-9_]*$/;
const HTTP_METHODS = new Set<UnifiedHttpMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD', 'ALL']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function assertAbsolutePath(path: string, field: string): void {
  if (typeof path !== 'string' || !path.startsWith('/')) throw new Error(`${field} must be an absolute path`);
}

function assertMethods(methods: unknown, field: string): void {
  if (methods === undefined) return;
  if (!Array.isArray(methods)) throw new Error(`${field} must be an array`);
  for (const method of methods) {
    if (typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase() as UnifiedHttpMethod)) {
      throw new Error(`${field} contains invalid method: ${JSON.stringify(method)}`);
    }
  }
}

function assertStringArray(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of strings`);
  }
}

function assertStringRecord(value: unknown, field: string): void {
  if (value === undefined) return;
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be a string map`);
  }
}

export function normalizeUnifiedPluginManifest(raw: unknown): NormalizedUnifiedPluginManifest {
  if (!isRecord(raw)) throw new Error('manifest must be a JSON object');
  const manifest = raw as unknown as UnifiedPluginManifest;

  if (!manifest.name || !NAME_RE.test(manifest.name)) {
    throw new Error(`manifest.name must match ${NAME_RE}, got: ${JSON.stringify(manifest.name)}`);
  }
  if (!manifest.version || !SEMVER_RE.test(manifest.version)) {
    throw new Error(`manifest.version must be semver, got: ${JSON.stringify(manifest.version)}`);
  }
  if (!manifest.entry || typeof manifest.entry !== 'string') throw new Error('manifest.entry must be a string path');
  assertStringArray(manifest.depends, 'depends');

  const apiRoutes = [...asArray(manifest.apiRoutes)];
  if (manifest.api) apiRoutes.push({ path: manifest.api.path, methods: manifest.api.methods });

  const cliSubcommands = [...asArray(manifest.cliSubcommands)];
  if (manifest.cli) cliSubcommands.push({ command: manifest.cli.command, help: manifest.cli.help });

  const menu = [...asArray(manifest.menu)];
  const mcpTools = asArray(manifest.mcpTools);
  const proxy = asArray(manifest.proxy);

  for (const tool of mcpTools) {
    if (!TOOL_RE.test(tool.name)) throw new Error(`mcpTools.name must match ${TOOL_RE}, got: ${JSON.stringify(tool.name)}`);
    if (!tool.description || typeof tool.description !== 'string') throw new Error(`mcpTools.${tool.name}.description must be a string`);
    if (!isRecord(tool.inputSchema)) throw new Error(`mcpTools.${tool.name}.inputSchema must be an object`);
    if (!tool.handler || typeof tool.handler !== 'string') throw new Error(`mcpTools.${tool.name}.handler must be a string`);
  }
  for (const route of apiRoutes) {
    assertAbsolutePath(route.path, 'apiRoutes.path');
    assertMethods(route.methods, 'apiRoutes.methods');
  }
  for (const item of proxy) {
    assertAbsolutePath(item.path, 'proxy.path');
    if (!item.targetEnv || typeof item.targetEnv !== 'string') throw new Error('proxy.targetEnv must be a string');
    assertMethods(item.methods, 'proxy.methods');
  }
  if (manifest.server) {
    if (!manifest.server.command || typeof manifest.server.command !== 'string') {
      throw new Error('server.command must be a string');
    }
    assertStringArray(manifest.server.args, 'server.args');
    assertStringRecord(manifest.server.env, 'server.env');
    if (manifest.server.healthPath !== undefined) assertAbsolutePath(manifest.server.healthPath, 'server.healthPath');
    if (manifest.server.autostart !== undefined && typeof manifest.server.autostart !== 'boolean') {
      throw new Error('server.autostart must be a boolean');
    }
  }
  for (const item of menu) {
    assertAbsolutePath(item.path, 'menu.path');
    if (!item.label || typeof item.label !== 'string') throw new Error('menu.label must be a string');
  }
  for (const command of cliSubcommands) {
    if (!command.command || typeof command.command !== 'string') throw new Error('cliSubcommands.command must be a string');
    if (!command.help || typeof command.help !== 'string') throw new Error('cliSubcommands.help must be a string');
  }
  if (manifest.configSchema !== undefined) validatePluginConfig(manifest.config ?? {}, manifest.configSchema, manifest.name);

  if (manifest.lifecycle) {
    const { init, destroy, start, stop } = manifest.lifecycle;
    if (init !== undefined && typeof init !== 'string') throw new Error('lifecycle.init must be a string');
    if (destroy !== undefined && typeof destroy !== 'string') throw new Error('lifecycle.destroy must be a string');
    if (start !== undefined && typeof start !== 'boolean') throw new Error('lifecycle.start must be a boolean');
    if (stop !== undefined && typeof stop !== 'boolean') throw new Error('lifecycle.stop must be a boolean');
  }

  return {
    ...manifest,
    sdk: manifest.sdk ?? '^0.0.1',
    depends: manifest.depends ?? [],
    apiRoutes,
    mcpTools,
    proxy,
    menu,
    cliSubcommands,
  };
}

export function manifestSurfaces(manifest: NormalizedUnifiedPluginManifest): UnifiedPluginSurface[] {
  const surfaces: UnifiedPluginSurface[] = [];
  if (manifest.mcpTools.length) surfaces.push('mcpTools');
  if (manifest.apiRoutes.length) surfaces.push('apiRoutes');
  if (manifest.proxy.length) surfaces.push('proxy');
  if (manifest.server) surfaces.push('server');
  if (manifest.menu.length) surfaces.push('menu');
  if (manifest.cliSubcommands.length) surfaces.push('cliSubcommands');
  return surfaces;
}

export function mcpToolNamesForToggle(manifest: NormalizedUnifiedPluginManifest): string[] {
  return manifest.mcpTools.map((tool) => tool.name);
}

export function publicUnifiedServerManifest(server?: UnifiedServerManifest): PublicUnifiedServerManifest | undefined {
  if (!server) return undefined;
  return { command: server.command, args: server.args, healthPath: server.healthPath, autostart: server.autostart };
}
