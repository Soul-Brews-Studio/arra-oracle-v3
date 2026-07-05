import { Elysia, t } from 'elysia';
import { createVectorStoreForModel, getEmbeddingModels } from '../../vector/factory.ts';
import { createDatabase } from '../../db/index.ts';
import { setIndexingStatus } from '../../indexer/status.ts';
import { DB_PATH, REPO_ROOT } from '../../config.ts';
import { currentTenantId, runWithTenant } from '../../middleware/tenant.ts';
import { replaceEntityLinks } from '../../search/entity-ranking.ts';
import { entityCollectionName, entityDocumentsFor } from '../../vector/entities.ts';
import {
  applyVectorIndexPlan,
  loadVectorIndexManifest,
  planVectorIndex,
  writeVectorIndexManifest,
} from '../../indexer/vector-index-manifest.ts';
import type { IndexerConfig } from '../../types.ts';
import type { VectorDocument } from '../../vector/types.ts';

let abortFlag = false;
export function getAbortFlag() { return abortFlag; }
export function setAbortFlag(v: boolean) { abortFlag = v; }

type Models = ReturnType<typeof getEmbeddingModels>;
type DatabaseConnection = ReturnType<typeof createDatabase>;
type VectorStoreFactory = typeof createVectorStoreForModel;

export interface StartRouteDeps {
  createDb?: (dbPath: string) => DatabaseConnection;
  createStore?: VectorStoreFactory;
  dbPath?: string;
  getModels?: () => Models;
  repoRoot?: string;
  runInBackground?: (task: Promise<void>) => void;
}

function chooseModel(models: Models, requested?: string): string | undefined {
  if (requested && models[requested]) return requested;
  if (models.nomic) return 'nomic';
  return Object.keys(models)[0];
}

function normalizeBatchSize(value: number | undefined, key: string): number {
  const fallback = key === 'nomic' ? 100 : 50;
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(1000, Math.floor(value));
}

type IndexedRow = {
  id: string;
  tenant_id: string;
  type: string;
  content: string;
  source_file: string;
  concepts: string;
  project: string | null;
};

function vectorDoc(row: IndexedRow): VectorDocument {
  return {
    id: row.id,
    document: row.content,
    metadata: {
      type: row.type,
      source_file: row.source_file,
      concepts: row.concepts,
      tenant_id: row.tenant_id,
      ...(row.project && { project: row.project }),
    },
  };
}

export function createStartRoute(deps: StartRouteDeps = {}) {
  return new Elysia().post('/indexer/start', async ({ body, set }) => {
    const { model, sourcePath, batchSize } = body;

    const models = (deps.getModels ?? getEmbeddingModels)();
    const key = chooseModel(models, model);
    if (!key) {
      set.status = 503;
      return { status: 'error', error: 'No embedding models configured' };
    }
    const preset = models[key];
    const batch = normalizeBatchSize(batchSize, key);

    const dbPath = deps.dbPath ?? DB_PATH;
    const repoRoot = sourcePath || deps.repoRoot || REPO_ROOT;
    const tenantId = currentTenantId();
    const conn = (deps.createDb ?? createDatabase)(dbPath);
    const { sqlite } = conn;
    const indexDb = conn.db ?? sqlite;
    const config: IndexerConfig = {
      repoRoot,
      dbPath,
      chromaPath: '',
      sourcePaths: {
        resonance: 'ψ/memory/resonance',
        learnings: 'ψ/memory/learnings',
        retrospectives: 'ψ/memory/retrospectives',
        distillations: 'ψ/memory/distillations',
        learn: 'ψ/learn',
      },
    };

    const storeFactory = deps.createStore ?? createVectorStoreForModel;
    const store = storeFactory(preset);
    const entityStore = storeFactory({ ...preset, collection: entityCollectionName(preset.collection) });

    abortFlag = false;

    const jobId = `idx-${Date.now()}`;

    // Run indexing in background
    const task = runWithTenant(tenantId, async () => {
      try {
        await store.connect();
        await entityStore.connect();
        await store.ensureCollection();
        await entityStore.ensureCollection();

        const tenantWhere = tenantId ? 'WHERE d.tenant_id = ?' : '';
        const rows = sqlite.prepare(`
        SELECT d.id, d.tenant_id, d.type, GROUP_CONCAT(f.content, '\n') as content,
          d.source_file, d.concepts, d.project, d.created_at
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        ${tenantWhere}
        GROUP BY d.id
        ORDER BY d.created_at DESC
      `).all(...(tenantId ? [tenantId] : [])) as IndexedRow[];

        const total = rows.length;
        setIndexingStatus(indexDb, config, true, 0, total);

        const docs = rows.map(vectorDoc);
        const previous = loadVectorIndexManifest(indexDb, key);
        const plan = planVectorIndex(docs, previous, key, { pruneStale: !tenantId });
        const applied = await applyVectorIndexPlan(store, plan, {
          batchSize: batch,
          replaceBaseline: previous.size === 0 && docs.length > 0,
          shouldAbort: () => abortFlag,
          onProgress: (indexed) => setIndexingStatus(indexDb, config, true, indexed, total),
        });

        if (applied.aborted) {
          setIndexingStatus(indexDb, config, false, applied.embedded, total, 'Cancelled by user');
          return;
        }

        if (previous.size === 0 || plan.changedDocs.length > 0 || plan.staleIds.length > 0) {
          const entityPlan = planVectorIndex(docs.flatMap(entityDocumentsFor), new Map(), `${key}:entities`, { force: true });
          const entityApplied = await applyVectorIndexPlan(entityStore, entityPlan, {
            batchSize: batch,
            replaceBaseline: true,
            shouldAbort: () => abortFlag,
          });
          if (entityApplied.aborted) {
            setIndexingStatus(indexDb, config, false, applied.embedded, total, 'Cancelled by user');
            return;
          }
        }

        if (plan.changedDocs.length > 0) {
          for (const doc of plan.changedDocs) {
            replaceEntityLinks(sqlite, {
              documentId: doc.id,
              tenantId: String(doc.metadata.tenant_id ?? ''),
              content: doc.document,
              concepts: doc.metadata.concepts,
            });
          }
        }
        writeVectorIndexManifest(indexDb, plan);

        if (!abortFlag) {
          setIndexingStatus(indexDb, config, false, rows.length, rows.length);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setIndexingStatus(indexDb, config, false, 0, 0, msg);
      } finally {
        await store.close().catch(() => undefined);
        await entityStore.close().catch(() => undefined);
      }
    });
    (deps.runInBackground ?? ((backgroundTask) => { void backgroundTask; }))(task);

    return { jobId, status: 'started', model: key, batchSize: batch, tenantId };
  }, {
    body: t.Object({
      model: t.Optional(t.String()),
      sourcePath: t.Optional(t.String()),
      batchSize: t.Optional(t.Number()),
    }),
    detail: {
      tags: ['indexer'],
      summary: 'Start vector indexing job',
    },
  });
}

export const startEndpoint = createStartRoute();
