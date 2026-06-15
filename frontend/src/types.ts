export type MenuGroup = 'main' | 'tools' | 'hidden';

export interface MenuItem {
  label: string;
  path: string;
  group: MenuGroup;
  order: number;
  icon?: string;
  source?: string;
  sourceName?: string;
}

export interface MenuResponse {
  items: MenuItem[];
}

export interface PluginMenu {
  label: string;
  group?: MenuGroup;
  order?: number;
  icon?: string;
  path?: string;
}

export interface PublicServerManifest {
  command: string;
  args?: string[];
  healthPath?: string;
  autostart?: boolean;
}

export interface PluginEntry {
  name: string;
  file: string;
  size: number;
  modified: string;
  version?: string;
  description?: string;
  menu?: PluginMenu;
  server?: PublicServerManifest;
}

export interface PluginsResponse {
  plugins: PluginEntry[];
  dir: string;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
