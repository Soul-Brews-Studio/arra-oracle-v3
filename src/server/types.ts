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
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
  offset: number;
  limit: number;
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

export interface HealthResponse {
  status: string;
  server?: string;
  port?: number | string;
}

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

