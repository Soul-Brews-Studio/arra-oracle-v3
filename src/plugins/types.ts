export type PluginType = 'js' | 'http' | 'ffi' | 'subprocess';

export type PluginRoute = {
  prefix: string;
  methods?: string[];
};

export type PluginManifest = {
  name: string;
  version: string;
  description?: string;
  type: PluginType;
  enabled?: boolean;
} & (JsPluginFields | HttpPluginFields | FfiPluginFields | SubprocessPluginFields);

type JsPluginFields = {
  type: 'js';
  main: string;
};

type HttpPluginFields = {
  type: 'http';
  port: number;
  healthPath?: string;
  healthInterval?: number;
  routes: PluginRoute[];
  startup?: { command: string; args?: string[]; env?: Record<string, string> };
};

type FfiPluginFields = {
  type: 'ffi';
  library: string;
  interface: 'vector' | 'compute' | 'custom';
  symbols?: Record<string, { args: string[]; returns: string }>;
};

type SubprocessPluginFields = {
  type: 'subprocess';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  tools?: 'auto' | string[];
};

export type PluginStatus = 'loading' | 'healthy' | 'degraded' | 'disabled' | 'error';

export type LoadedPlugin = {
  manifest: PluginManifest;
  dir: string;
  status: PluginStatus;
  error?: string;
  pid?: number;
  port?: number;
};

export type PluginRegistry = {
  plugins: LoadedPlugin[];
  getByName(name: string): LoadedPlugin | undefined;
  getByType(type: PluginType): LoadedPlugin[];
};
