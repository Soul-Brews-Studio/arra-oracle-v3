/**
 * Oracle v2 Server Types
 */

export interface SearchResult {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  source?: 'fts' | 'vector' | 'hybrid';
  score?: number;
  distance?: number;
  model?: string;
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

export type HealthDbStatus = 'connected' | 'error' | 'ok' | 'down';
export type PluginHealthStatus = 'ok' | 'degraded';
export type VectorMode = 'embedded' | 'proxied' | 'disabled';

export interface HealthDbCheck {
  status: HealthDbStatus;
  path?: string;
  error?: string;
}

export interface VectorHealthEngine {
  key?: string;
  model?: string;
  collection?: string;
  adapter?: string;
  embeddingProvider?: string;
  connectionStatus?: 'connected' | 'error' | string;
  count?: number;
  ok?: boolean;
  error?: string;
}

export interface VectorServiceHealth {
  name: string;
  type?: string;
  endpoint?: string;
  status?: string;
  available?: boolean;
  health?: { status?: string; error?: string; checkedAt?: string };
}

export interface VectorHealthResponse {
  status: RuntimeStatus;
  engines: VectorHealthEngine[];
  collections?: VectorHealthEngine[];
  checked_at: string;
  proxy?: string;
  error?: string;
  services?: VectorServiceHealth[];
}

export interface HealthResponse {
  status: RuntimeStatus;
  server: string;
  version: string;
  port?: number;
  sandbox?: string;
  oracle?: 'connected' | 'degraded';
  uptimeSeconds?: number;
  dbStatus?: HealthDbStatus;
  vectorStatus?: RuntimeStatus;
  vectorMode?: VectorMode;
  vectorAvailable?: boolean;
  vectorUrl?: string;
  vectorDisabledReason?: string;
  pluginStatus?: PluginHealthStatus;
  mcpToolCount?: number;
  pluginCount?: number;
  draining?: boolean;
  uptime?: number | { seconds: number };
  uptimeSecondsBreakdown?: { seconds: number };
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
