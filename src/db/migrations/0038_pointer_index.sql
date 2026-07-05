CREATE TABLE IF NOT EXISTS oracle_pointer_index (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id),
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  doc_ids TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pointer_tenant_kind_key ON oracle_pointer_index (tenant_id, kind, key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_pointer_tenant_updated ON oracle_pointer_index (tenant_id, updated_at);
