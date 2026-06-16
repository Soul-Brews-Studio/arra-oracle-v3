import { Elysia, t } from 'elysia';
import { createVectorStoreForModel, getEmbeddingModels } from '../../vector/factory.ts';
import { createDatabase } from '../../db/index.ts';
import { setIndexingStatus } from '../../indexer/status.ts';
import { DB_PATH, REPO_ROOT } from '../../config.ts';
import { currentTenantId, runWithTenant } from '../../middleware/tenant.ts';
import type { IndexerConfig } from '../../types.ts';

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
    const { sqlite } = (deps.createDb ?? createDatabase)(dbPath);
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

    const store = (deps.createStore ?? createVectorStoreForModel)(preset);

    abortFlag = false;

    const jobId = `idx-${Date.now()}`;

    // Run indexing in background
    const task = runWithTenant(tenantId, async () => {
      try {
        await store.connect();
        try { await store.deleteCollection(); } catch {}
        await store.ensureCollection();

        const tenantWhere = tenantId ? 'WHERE d.tenant_id = ?' : '';
        const rows = sqlite.prepare(`
        SELECT d.id, d.tenant_id, d.type, GROUP_CONCAT(f.content, '\n') as content,
          d.source_file, d.concepts, d.project, d.created_at
        FROM oracle_documents d
        JOIN oracle_fts f ON d.id = f.id
        ${tenantWhere}
        GROUP BY d.id
        ORDER BY d.created_at DESC
      `).all(...(tenantId ? [tenantId] : [])) as Array<{
          id: string; tenant_id: string; type: string; content: string;
          source_file: string; concepts: string; project: string | null; created_at: string;
        }>;

        const total = rows.length;
        setIndexingStatus(sqlite, config, true, 0, total);

        for (let i = 0; i < rows.length; i += batch) {
          if (abortFlag) {
            setIndexingStatus(sqlite, config, false, i, total, 'Cancelled by user');
            break;
          }

          const batchRows = rows.slice(i, i + batch);
          const docs = batchRows.map(row => ({
            id: row.id,
            document: row.content,
            metadata: {
              type: row.type,
              source_file: row.source_file,
              concepts: row.concepts,
              tenant_id: row.tenant_id,
              ...(row.project && { project: row.project }),
            },
          }));

          await store.addDocuments(docs);
          setIndexingStatus(sqlite, config, true, i + batchRows.length, total);
        }

        if (!abortFlag) {
          setIndexingStatus(sqlite, config, false, rows.length, rows.length);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setIndexingStatus(sqlite, config, false, 0, 0, msg);
      } finally {
        await store.close().catch(() => undefined);
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
