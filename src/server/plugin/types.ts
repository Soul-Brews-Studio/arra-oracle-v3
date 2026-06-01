import type { Elysia } from 'elysia';

export type ServerPluginTier = 'core' | 'standard' | 'extra';
export type ElysiaApp = Elysia<any, any, any, any, any, any, any>;

export interface ServerPluginApiManifest {
  /**
   * Prefix where this plugin's relative Elysia routes should be mounted.
   * Example: api.path "/api/example" + route "/" => "/api/example".
   */
  path: string;
  methods?: string[];
}

export interface ServerPluginLogger {
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface ServerPluginLifecycleContext {
  dataDir: string;
  vectorUrl?: string;
  signal: AbortSignal;
  logger: ServerPluginLogger;
}

export interface ServerPlugin {
  name: string;
  tier: ServerPluginTier;
  enabled?: boolean;
  seedMenu?: boolean;
  api?: ServerPluginApiManifest;
  routes?: () => ElysiaApp | ElysiaApp[];
  start?: (context: ServerPluginLifecycleContext) => void | Promise<void>;
  stop?: (context: ServerPluginLifecycleContext) => void | Promise<void>;
}

export interface LoadedServerPlugin {
  plugin: ServerPlugin;
  disabled: boolean;
}

export interface LoadServerPluginsOptions {
  disabledPlugins?: string[];
  enabledPlugins?: string[];
}

export interface ServerPluginRoutesOptions {
  warn?: (message: string) => void;
}

export interface ServerPluginLifecycleOptions {
  dataDir: string;
  vectorUrl?: string;
  logger?: ServerPluginLogger;
  abortController?: AbortController;
}

export interface StartedServerPlugins {
  plugins: ServerPlugin[];
  context: ServerPluginLifecycleContext;
  stop: () => Promise<void>;
}
