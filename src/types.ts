/**
 * Oracle v2 Type Definitions
 * Following claude-mem patterns for granular vector documents
 */

export type OracleDocumentType = 'principle' | 'pattern' | 'learning' | 'retro' | 'snapshot';

/**
 * Granular document stored in vector DB
 * Following claude-mem's pattern of splitting large documents into smaller chunks
 */
export interface OracleDocument {
  id: string;           // e.g., "resonance_oracle_principle_1"
  type: OracleDocumentType;
  source_file: string;  // Relative path from repo root
  content: string;      // The actual text to embed
  concepts: string[];   // Tags for filtering: ['trust', 'patterns', 'mirror']
  created_at: number;   // Unix timestamp
  updated_at: number;   // Unix timestamp
  project?: string | null; // Source project (null = universal, undefined = inherit)
}

/**
 * Metadata stored in SQLite (source of truth)
 */
export interface OracleMetadata {
  id: string;
  type: OracleDocumentType;
  source_file: string;
  concepts: string;     // JSON array as string
  created_at: number;
  updated_at: number;
  indexed_at: number;   // When this was indexed
}

/**
 * Search result from hybrid search
 */
export interface SearchResult {
  document: OracleDocument;
  score: number;        // Relevance score from vector search
  source: 'vector' | 'fts' | 'hybrid';
}

/**
 * Tool input schemas
 */
export interface OracleSearchInput {
  query: string;
  type?: OracleDocumentType | 'all';
  limit?: number;
}

export interface OracleConsultInput {
  decision: string;
  context?: string;
}

export interface OracleReflectInput {
  // No parameters - returns random wisdom
}

/**
 * arra_list input - browse documents without search query
 */
export interface OracleListInput {
  type?: OracleDocumentType | 'all';
  limit?: number;
  offset?: number;
}

/**
 * Tool output types
 */
export interface OracleSearchOutput {
  results: SearchResult[];
  total: number;
}

export interface OracleConsultOutput {
  principles: SearchResult[];
  patterns: SearchResult[];
  guidance: string;
}

export interface OracleReflectOutput {
  principle: OracleDocument;
}

/**
 * arra_list output - paginated document list
 */
export interface OracleListOutput {
  documents: Array<{
    id: string;
    type: OracleDocumentType;
    title: string;
    content: string;
    source_file: string;
    concepts: string[];
    indexed_at: number;
  }>;
  total: number;
  limit: number;
  offset: number;
  type: string;
}

/**
 * Hybrid search options for combining FTS and vector results
 */
export interface HybridSearchOptions {
  ftsWeight?: number;     // Weight for FTS results (default 0.5)
  vectorWeight?: number;  // Weight for vector results (default 0.5)
}

/**
 * Indexer configuration
 */
export interface IndexerConfig {
  repoRoot: string;
  dbPath: string;
  chromaPath: string;
  sourcePaths: {
    resonance: string;
    learnings: string;
    retrospectives: string;
  };
}
