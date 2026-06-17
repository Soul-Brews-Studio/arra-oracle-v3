CREATE INDEX IF NOT EXISTS idx_documents_tenant_superseded ON oracle_documents (tenant_id, superseded_by);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_tenant_insert_guard
BEFORE INSERT ON oracle_documents
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id)
BEGIN
  INSERT INTO tenants (id, name, status, created_at, updated_at)
  VALUES (NEW.tenant_id, NEW.tenant_id, 'active', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_tenant_update_guard
BEFORE UPDATE OF tenant_id ON oracle_documents
WHEN NOT EXISTS (SELECT 1 FROM tenants WHERE id = NEW.tenant_id)
BEGIN
  INSERT INTO tenants (id, name, status, created_at, updated_at)
  VALUES (NEW.tenant_id, NEW.tenant_id, 'active', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_supersede_insert_guard
BEFORE INSERT ON oracle_documents
WHEN NEW.superseded_by IS NOT NULL AND (
  NEW.superseded_by = NEW.id
  OR EXISTS (
    SELECT 1 FROM oracle_documents newer
    WHERE newer.id = NEW.superseded_by AND newer.tenant_id <> NEW.tenant_id
  )
  OR EXISTS (
    WITH RECURSIVE chain(id, superseded_by) AS (
      SELECT id, superseded_by FROM oracle_documents WHERE id = NEW.superseded_by
      UNION ALL
      SELECT next.id, next.superseded_by
      FROM oracle_documents next
      JOIN chain ON next.id = chain.superseded_by
      WHERE chain.superseded_by IS NOT NULL
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid oracle_documents supersede chain');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_supersede_update_guard
BEFORE UPDATE OF superseded_by, tenant_id ON oracle_documents
WHEN NEW.superseded_by IS NOT NULL AND (
  NEW.superseded_by = NEW.id
  OR EXISTS (
    SELECT 1 FROM oracle_documents newer
    WHERE newer.id = NEW.superseded_by AND newer.tenant_id <> NEW.tenant_id
  )
  OR EXISTS (
    WITH RECURSIVE chain(id, superseded_by) AS (
      SELECT id, superseded_by FROM oracle_documents WHERE id = NEW.superseded_by
      UNION ALL
      SELECT next.id, next.superseded_by
      FROM oracle_documents next
      JOIN chain ON next.id = chain.superseded_by
      WHERE chain.superseded_by IS NOT NULL
    )
    SELECT 1 FROM chain WHERE id = NEW.id
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid oracle_documents supersede chain');
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_fts_delete_sync
AFTER DELETE ON oracle_documents
BEGIN
  DELETE FROM oracle_fts WHERE id = OLD.id;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_documents_fts_concepts_sync
AFTER UPDATE OF concepts ON oracle_documents
BEGIN
  UPDATE oracle_fts SET concepts = NEW.concepts WHERE id = NEW.id;
END;
