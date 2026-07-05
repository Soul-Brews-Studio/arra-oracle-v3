/**
 * Oracle v2 Server Types
 */

export interface SearchResult {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  source?: 'fts' | 'vector' | 'pointer' | 'hybrid';
  score?: number;
  distance?: number;
  model?: string;
  pointerScore?: number;
  pointerMatches?: string[];
  entity_score?: number;
  entity_matches?: string[];
  entityLinkScore?: number;
  entityLinkMatches?: string[];
  superseded_by?: string;
  superseded_at?: string | null;
  superseded_reason?: string | null;
  valid_time?: string | null;
  valid_until?: string | null;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  offset: number;
  limit: number;
  query?: string;
}

export interface StatsResponse {
  total: number;
  by_type: Record<string, number>;
  concepts: {
    total: number;
    top: Array<{ name: string; count: number }>;
  };
  last_indexed: string | null;
  is_stale: boolean;
  fts_status: string;
  chroma_status: string;
}

export interface GraphResponse {
  nodes: Array<{
    id: string;
    type: string;
    label: string;
    concepts: string[];
  }>;
  links: Array<{
    source: string;
    target: string;
    weight: number;
  }>;
}

export interface DashboardSummary {
  documents: {
    total: number;
    by_type: Record<string, number>;
  };
  concepts: {
    total: number;
    top: Array<{ name: string; count: number }>;
  };
  activity: {
    searches_7d: number;
    learnings_7d: number;
  };
  health: {
    fts_status: string;
    last_indexed: string | null;
  };
}

export type RuntimeStatus = 'ok' | 'down' | 'degraded' | 'draining' | string;
export type PublicHealthStatus = 'healthy' | 'starting' | 'degraded' | 'down';
export type HealthSubsystemName = 'backend' | 'database' | 'db' | 'fts' | 'vector' | 'embedder' | 'mcp' | 'plugins' | 'plugin';
export type HealthUptimeSeconds = number | { seconds: number };
export type VectorRuntimeMode = 'embedded' | 'proxied' | 'disabled';
export type HealthDbStatus = 'connected' | 'error' | 'ok' | 'down';
export type PluginHealthStatus = 'ok' | 'degraded';

export interface HealthDbCheck {
  status: HealthDbStatus;
  path?: string;
  error?: string;
}

export interface VectorHealthResponse {
  status: RuntimeStatus;
  engines: Array<Record<string, unknown>>;
  collections?: Array<Record<string, unknown>>;
  checked_at: string;
  proxy?: string;
  error?: string;
  services?: Array<Record<string, unknown>>;
}

export interface HealthSubsystemDetail {
  status: PublicHealthStatus;
  label: string;
  detail: string;
  critical: boolean;
  checkedAt?: string;
  data?: Record<string, unknown>;
}

export interface HealthResponse {
  status: RuntimeStatus;
  healthStatus?: PublicHealthStatus;
  state?: PublicHealthStatus;
  checked_at?: string;
  server: string;
  version: string;
  port?: number;
  sandbox?: string;
  oracle?: 'connected' | 'degraded';
  uptimeSeconds?: number;
  uptimeSecondsBreakdown?: HealthUptimeSeconds;
  dbStatus?: HealthDbStatus;
  vectorStatus?: RuntimeStatus;
  vectorMode?: VectorRuntimeMode;
  vectorAvailable?: boolean;
  vectorUrl?: string;
  vectorDisabledReason?: string;
  pluginStatus?: PluginHealthStatus;
  mcpToolCount?: number;
  pluginCount?: number;
  draining?: boolean;
  uptime?: HealthUptimeSeconds;
  db?: HealthDbStatus | ({ status: HealthDbStatus; path?: string; error?: string });
  dbCheck?: HealthDbCheck;
  vector?: VectorHealthResponse;
  vectorServer?: { configured: boolean; status: 'ok' | 'down' | 'unconfigured'; url?: string; httpStatus?: number; protocol?: string; name?: string; version?: string; error?: string };
  mcp?: { toolCount: number };
  plugins?: {
    count: number;
    status: PluginHealthStatus;
    items: Array<{ name: string; status: PluginHealthStatus; error?: string }>;
  };
  subsystems?: Partial<Record<HealthSubsystemName, HealthSubsystemDetail>>;
}

export interface MemoryUsageSnapshot {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

export interface MetricsSnapshot {
  uptime: number;
  requestCount: number;
  avgResponseMs: number;
  lastResponseMs?: number;
  maxResponseMs?: number;
  activeConnections: number;
  errorCount?: number;
  statusCounts?: Record<string, number>;
  methodCounts?: Record<string, number>;
  lastRestart: string;
  memoryUsage: MemoryUsageSnapshot;
}

export interface PluginEntryResponse {
  name: string;
  file: string;
  size: number;
  modified: string;
  version?: string;
  status?: 'ok' | 'degraded' | 'disabled' | string;
  enabled?: boolean;
  error?: string;
  surfaces?: string[];
  description?: string;
  menu?: {
    label: string;
    group?: 'main' | 'tools' | 'hidden';
    order?: number;
    icon?: string;
    path?: string;
  };
  server?: {
    command: string;
    args?: string[];
    healthPath?: string;
    autostart?: boolean;
  };
}

export interface PluginsResponse {
  plugins: PluginEntryResponse[];
  dir: string;
  count?: number;
}

export type VectorSearchResponse = Omit<SearchResponse, 'query' | 'offset' | 'limit'> & {
  query: string;
  offset?: number;
  limit?: number;
  error?: string;
};

export interface DashboardActivity {
  searches: Array<{
    query: string;
    type: string | null;
    results_count: number | null;
    search_time_ms: number | null;
    created_at: string;
  }>;
  learnings: Array<{
    document_id: string;
    pattern_preview: string | null;
    source: string | null;
    concepts: string[];
    created_at: string;
  }>;
  days: number;
}

export interface DashboardGrowth {
  period: string;
  days: number;
  data: Array<{
    date: string;
    documents: number;
    searches: number;
  }>;
}
