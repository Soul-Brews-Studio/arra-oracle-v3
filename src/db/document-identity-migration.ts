import type { Database } from 'bun:sqlite';
import {
  UNIVERSAL_PROJECT,
  canonicalProject,
  contentDigest,
  documentStorageId,
} from '../document-identity.ts';

const MIGRATION_MARKER = 'migration_document_identity_v1';

interface DocumentRow {
  id: string;
  display_id: string | null;
  content_digest: string | null;
  project: string | null;
  superseded_by: string | null;
}

interface FtsRow {
  id: string;
  content: string;
  concepts: string;
}

interface MigrationPlan {
  oldId: string;
  currentId: string;
  storageId: string;
  displayId: string;
  project: string | null;
  digest: string | null;
  supersededBy: string | null;
  fts: FtsRow | null;
}

export function ensureDocumentIdentityColumns(sqlite: Database): void {
  const columns = sqlite.prepare('PRAGMA table_info(oracle_documents)').all() as Array<{ name: string }>;
  const names = new Set(columns.map(({ name }) => name));
  if (!names.has('display_id')) {
    sqlite.exec('ALTER TABLE oracle_documents ADD COLUMN display_id text');
  }
  if (!names.has('content_digest')) {
    sqlite.exec('ALTER TABLE oracle_documents ADD COLUMN content_digest text');
  }
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_project_display ON oracle_documents (project, display_id)');
}

export function migrateDocumentIdentity(sqlite: Database): number {
  ensureDocumentIdentityColumns(sqlite);
  const completed = sqlite.prepare('SELECT value FROM settings WHERE key = ?')
    .get(MIGRATION_MARKER) as { value: string | null } | null;
  if (completed?.value === '1') return 0;

  const markComplete = sqlite.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, '1', ?)
    ON CONFLICT(key) DO UPDATE SET value = '1', updated_at = excluded.updated_at
  `);

  sqlite.exec('BEGIN IMMEDIATE');
  try {
    const rows = sqlite.prepare(`
      SELECT id, display_id, content_digest, project, superseded_by
      FROM oracle_documents
      ORDER BY id
    `).all() as DocumentRow[];
    const ftsRows = sqlite.prepare(`
      SELECT id, content, concepts
      FROM oracle_fts
      ORDER BY rowid
    `).all() as FtsRow[];
    const latestFts = new Map<string, FtsRow>();
    for (const row of ftsRows) latestFts.set(row.id, row);

    const plans: MigrationPlan[] = rows.map((row) => {
      const displayId = row.display_id || row.id;
      const canonical = canonicalProject(row.project);
      const fts = latestFts.get(row.id) || null;
      return {
        oldId: row.id,
        currentId: row.id,
        storageId: documentStorageId(canonical, displayId),
        displayId,
        project: canonical === UNIVERSAL_PROJECT ? null : canonical,
        digest: fts ? contentDigest(fts.content) : null,
        supersededBy: row.superseded_by,
        fts,
      };
    });
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const changed = plans.filter((plan) => {
      const row = rowById.get(plan.oldId);
      return plan.oldId !== plan.storageId
        || row?.display_id !== plan.displayId
        || row?.content_digest !== plan.digest
        || row?.project !== plan.project;
    });

    const needsFtsRebuild = ftsRows.length !== plans.filter(({ fts }) => fts).length;
    if (changed.length === 0 && !needsFtsRebuild) {
      markComplete.run(MIGRATION_MARKER, Date.now());
      sqlite.exec('COMMIT');
      return 0;
    }

    const storageIds = new Set(plans.map(({ storageId }) => storageId));
    if (storageIds.size !== plans.length) {
      throw new Error('Duplicate canonical document identity detected');
    }

    const idMap = new Map(plans.map(({ oldId, storageId }) => [oldId, storageId]));
    const updateId = sqlite.prepare('UPDATE oracle_documents SET id = ? WHERE id = ?');
    const finalize = sqlite.prepare(`
      UPDATE oracle_documents
      SET id = ?, display_id = ?, content_digest = ?, project = ?, superseded_by = ?
      WHERE id = ?
    `);
    const insertFts = sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');

    sqlite.exec('DELETE FROM oracle_fts');
    for (const plan of plans) {
      if (plan.oldId === plan.storageId) continue;
      const tempId = `__document_identity_migration__${contentDigest(plan.oldId)}`;
      updateId.run(tempId, plan.oldId);
      plan.currentId = tempId;
    }

    for (const plan of plans) {
      const supersededBy = plan.supersededBy ? (idMap.get(plan.supersededBy) || plan.supersededBy) : null;
      finalize.run(
        plan.storageId,
        plan.displayId,
        plan.digest,
        plan.project,
        supersededBy,
        plan.currentId,
      );
      if (plan.fts) insertFts.run(plan.storageId, plan.fts.content, plan.fts.concepts);
    }

    markComplete.run(MIGRATION_MARKER, Date.now());
    sqlite.exec('COMMIT');
    return changed.length;
  } catch (error) {
    sqlite.exec('ROLLBACK');
    throw error;
  }
}
