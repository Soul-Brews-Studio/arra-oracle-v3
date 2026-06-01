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

export interface ServerPlugin {
  name: string;
  tier: ServerPluginTier;
  enabled?: boolean;
  seedMenu?: boolean;
  api?: ServerPluginApiManifest;
  routes?: () => ElysiaApp | ElysiaApp[];
  start?: () => void | Promise<void>;
  stop?: () => void | Promise<void>;
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
