CREATE TABLE IF NOT EXISTS vector_index_manifest (
  id TEXT PRIMARY KEY NOT NULL,
  chunk_id TEXT NOT NULL,
  source_file TEXT NOT NULL,
  model_key TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_vector_manifest_model_hash ON vector_index_manifest (model_key, content_hash);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_vector_manifest_source ON vector_index_manifest (source_file);
