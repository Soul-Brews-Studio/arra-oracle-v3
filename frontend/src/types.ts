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

export interface PluginApiRoute {
  path: string;
  methods?: string[];
}

export interface PluginProxyConfig {
  path: string;
  targetEnv: string;
  stripPrefix?: boolean;
  methods?: string[];
}

export interface PluginCliSubcommand {
  command: string;
  help: string;
  handler?: string;
}

export interface PluginExportFormat {
  extension: string;
  mimeType?: string;
  name?: string;
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
  status?: 'ok' | 'degraded' | 'disabled' | string;
  enabled?: boolean;
  error?: string;
  description?: string;
  menu?: PluginMenu;
  server?: PublicServerManifest;
  mcpTools?: McpTool[];
  apiRoutes?: PluginApiRoute[];
  proxy?: PluginProxyConfig[];
  cliSubcommands?: PluginCliSubcommand[];
  exportFormats?: PluginExportFormat[];
  surfaces?: string[];
}

export interface PluginsResponse {
  plugins: PluginEntry[];
  dir: string;
  count?: number;
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

export interface LearnEntry {
  id: string;
  title: string;
  content: string;
  concepts: string[];
  sourceFile: string;
  createdAt: number;
  updatedAt: number;
  origin?: string | null;
  project?: string | null;
}

export interface LearnListResponse {
  items: LearnEntry[];
  total: number;
}

export interface LearnMutationPayload {
  pattern: string;
  concepts?: string[];
  source?: string;
}

export interface LearnCreateResponse {
  success: boolean;
  id: string;
  file: string;
}

export interface LearnUpdateResponse {
  id: string;
  type: 'learning';
  sourceFile: string;
  concepts: string[];
  createdAt: number;
  updatedAt: number;
  indexedAt: number;
  origin?: string | null;
  project?: string | null;
  supersededAt?: number | null;
  supersededBy?: string | null;
  supersededReason?: string | null;
  createdBy?: string | null;
}

export interface LearnDeleteResponse {
  id: string;
  deleted: 'soft';
  supersededAt: number;
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
  enabled?: boolean;
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

export interface VectorConfigHealth {
  ok: boolean;
  status: 'ok' | 'down' | 'disabled' | string;
  collection: string;
  adapter?: string;
  model?: string;
  enabled?: boolean;
  error?: string;
}

export interface VectorConfigResponse {
  source: 'file' | 'defaults';
  config: { collections: Record<string, SettingsEmbedderCollection> };
  doc_counts: Record<string, number>;
  health: Record<string, VectorConfigHealth>;
  checked_at?: string;
}

export interface VectorConfigUpdateResponse {
  success: boolean;
  source: 'file' | 'defaults';
  path?: string;
  collection?: string;
  config: { collections: Record<string, SettingsEmbedderCollection> };
}

export type LoadState = 'idle' | 'loading' | 'ready' | 'error';
