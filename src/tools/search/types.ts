export type FtsRow = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string | null;
  rank: number;
};

export type FtsResult = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  source: 'fts';
};

export type VectorResult = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  distance: number;
  model: string;
  source: 'vector';
};

export type CombinedSearchResult = {
  id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string[];
  score: number;
  source: 'fts' | 'vector' | 'hybrid';
  ftsScore?: number;
  vectorScore?: number;
  distance?: number;
  model?: string;
  superseded_by?: string;
  superseded_at?: string | null;
  superseded_reason?: string | null;
  valid_time?: string | null;
  valid_until?: string | null;
  confidence?: SearchConfidence;
  provenance?: SearchProvenance;
};

export type SearchConfidence = {
  level: 'high' | 'medium' | 'low';
  score: number;
  signals: string[];
};

export type SearchProvenance = {
  source: 'fts' | 'vector' | 'hybrid';
  source_file: string;
  fts_score?: number;
  vector_score?: number;
  vector_distance?: number;
  vector_model?: string;
};
