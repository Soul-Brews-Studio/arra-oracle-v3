CREATE TABLE IF NOT EXISTS oracle_document_content (
  id TEXT PRIMARY KEY NOT NULL,
  content TEXT NOT NULL
);
--> statement-breakpoint
CREATE VIEW IF NOT EXISTS oracle_content AS
  SELECT f.rowid, f.id, COALESCE(o.content, f.content) AS content, f.concepts
  FROM oracle_fts f LEFT JOIN oracle_document_content o ON o.id = f.id;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS oracle_document_content_delete
AFTER DELETE ON oracle_documents BEGIN
  DELETE FROM oracle_document_content WHERE id = OLD.id;
END;
