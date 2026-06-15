export type MenuGroup = 'main' | 'tools' | 'admin' | 'hidden';

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

export interface McpTool {
  name: string;
  description: string;
  inputSchema?: unknown;
  group?: string;
  readOnly?: boolean;
  enabledByDefault?: boolean;
  source?: 'core' | 'plugin';
  plugin?: string;
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
  mcpTools?: McpTool[];
}

export interface PluginsResponse {
  plugins: PluginEntry[];
  dir: string;
}

export interface SearchResult {
  id: string;
  content: string;
  title?: string;
  type?: string;
  source?: string;
  source_file?: string;
  score?: number;
  model?: string;
  concepts?: string[];
  project?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  query: string;
  limit?: number;
  offset?: number;
  error?: string;
}

export interface McpToolsResponse {
  tools: McpTool[];
  total: number;
}


export interface SettingsStorageConfig {
  activeBackend: string;
  configuredBackend: string;
  defaultBackend: string;
  dbPath: string;
  dataDir: string;
  repoRoot: string;
}

export interface SettingsEmbedderCollection {
  key: string;
  collection: string;
  model: string;
  provider: string;
  adapter?: string;
  primary?: boolean;
}

export interface SettingsEmbedderConfig {
  source: string;
  backend: string;
  model: string | null;
  url: string | null;
  dimensions: number | null;
  embeddingEndpoint: string;
  collections: SettingsEmbedderCollection[];
}

export interface SettingsMigrationStatus {
  status: 'current' | 'pending';
  tablePresent: boolean;
  appliedCount: number;
  availableCount: number;
  pendingCount: number;
  latestKnown: string | null;
  latestAppliedAt: string | null;
}

export interface SettingsSystemResponse {
  storage: SettingsStorageConfig;
  embedder: SettingsEmbedderConfig;
  migrations: SettingsMigrationStatus;
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
