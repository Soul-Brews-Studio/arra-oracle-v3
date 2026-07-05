CREATE TABLE IF NOT EXISTS oracle_entity_links (
  id TEXT PRIMARY KEY NOT NULL,
  tenant_id TEXT NOT NULL DEFAULT 'default' REFERENCES tenants(id),
  document_id TEXT NOT NULL REFERENCES oracle_documents(id) ON DELETE CASCADE,
  entity TEXT NOT NULL,
  entity_key TEXT NOT NULL,
  weight INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_entity_links_tenant_key ON oracle_entity_links (tenant_id, entity_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_entity_links_tenant_doc ON oracle_entity_links (tenant_id, document_id);
