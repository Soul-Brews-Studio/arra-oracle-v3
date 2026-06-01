import type { Elysia } from 'elysia';

export type ServerPluginTier = 'core' | 'standard' | 'extra';
export type ElysiaApp = Elysia<any, any, any, any, any, any, any>;

export interface ServerPlugin {
  name: string;
  tier: ServerPluginTier;
  enabled?: boolean;
  seedMenu?: boolean;
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
