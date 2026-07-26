import type { Database } from 'bun:sqlite';
import { currentTenantId } from '../middleware/tenant.ts';
import { entityLinksForDocument, replaceEntityLinks } from '../search/entity-ranking.ts';
import { replaceDocumentPointers } from '../search/pointer-index.ts';
import { readEntityCoverageStats, type EntityCoverageStats } from '../search/entity-coverage.ts';
import { entityCollectionName, entityDocumentsFor } from '../vector/entities.ts';
import { createVectorStoreForModel, getEmbeddingModels, type EmbeddingModelConfig } from '../vector/factory.ts';
import type { VectorDocument, VectorStoreAdapter } from '../vector/types.ts';

type Env = Record<string, string | undefined>;
type Logger = Pick<Console, 'warn' | 'error'>;
type Store = Pick<VectorStoreAdapter, 'connect' | 'ensureCollection' | 'addDocuments'> &
  Partial<Pick<VectorStoreAdapter, 'close' | 'deleteDocuments' | 'getAllEmbeddings'>>;
type IndexedDoc = {
  id: string; tenantId: string; type: string; sourceFile: string;
  concepts: string; content: string; project: string | null;
};
type SidecarPlan = { key: string; preset: EmbeddingModelConfig; deleteIds: string[]; docs: VectorDocument[] };
type Plan = { docs: IndexedDoc[]; linkDocs: IndexedDoc[]; sidecars: SidecarPlan[]; coverage: EntityCoverageStats };

export type EntityBackfillOptions = {
  env?: Env; force?: boolean; dryRunOnly?: boolean; limit?: number; entityScanLimit?: number;
  tenantId?: string; models?: () => Record<string, EmbeddingModelConfig>;
  createStore?: (preset: EmbeddingModelConfig) => Store; logger?: Logger;
};
export type EntityBackfillReport = EntityCoverageStats & {
  scanned: number; linkDocsMissing: number; sidecarDocsMissing: number; entityDocsPlanned: number; models: string[];
};
export type EntityBackfillApplied = { docsRepaired: number; linksWritten: number; entityDocsWritten: number; errors: string[] };
export type EntityBackfillResult = {
  enabled: boolean; dryRun: EntityBackfillReport; applied: EntityBackfillApplied; after: EntityBackfillReport;
};

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const DEFAULT_LIMIT = 250;
const DEFAULT_ENTITY_SCAN_LIMIT = 100_000;
const status = { running: false, lastRun: undefined as string | undefined, lastDurationMs: undefined as number | undefined, lastError: undefined as string | undefined, lastDryRun: undefined as EntityBackfillReport | undefined, lastApplied: undefined as EntityBackfillApplied | undefined };

export function entityBackfillConfig(env: Env = process.env) {
  return {
    enabled: env.ORACLE_ENTITY_BACKFILL === '1',
    intervalMs: intEnv(env.ORACLE_ENTITY_BACKFILL_INTERVAL_MS, DEFAULT_INTERVAL_MS, 60_000, 86_400_000),
    limit: intEnv(env.ORACLE_ENTITY_BACKFILL_LIMIT, DEFAULT_LIMIT, 1, 5_000),
    entityScanLimit: intEnv(env.ORACLE_ENTITY_BACKFILL_ENTITY_SCAN_LIMIT, DEFAULT_ENTITY_SCAN_LIMIT, 1, 1_000_000),
  };
}

export function entityBackfillStatus(env: Env = process.env) {
  const config = entityBackfillConfig(env);
  return { ...status, ...config, ...(config.enabled ? {} : { disabledReason: 'set ORACLE_ENTITY_BACKFILL=1 to enable' }) };
}

export async function runEntityBackfillSweep(sqlite: Database, input: EntityBackfillOptions = {}): Promise<EntityBackfillResult> {
  const started = Date.now(), config = entityBackfillConfig(input.env), enabled = config.enabled || input.force === true;
  if (!enabled) return finish(false, started, emptyReport(sqlite, input), emptyApplied(), emptyReport(sqlite, input));
  try {
    const dryPlan = await plan(sqlite, input, config.limit, config.entityScanLimit);
    const dryRun = report(dryPlan);
    const applied = input.dryRunOnly ? emptyApplied() : await applyPlan(sqlite, dryPlan, input);
    const after = report(await plan(sqlite, input, config.limit, config.entityScanLimit));
    return finish(true, started, dryRun, applied, after);
  } catch (error) {
    status.lastError = message(error); input.logger?.error?.(status.lastError);
    const dry = emptyReport(sqlite, input);
    return finish(true, started, dry, { ...emptyApplied(), errors: [status.lastError] }, dry);
  }
}

export function createEntityBackfillWorker(sqlite: Database, input: EntityBackfillOptions = {}) {
  let timer: ReturnType<typeof setInterval> | null = null;
  const runOnce = () => runEntityBackfillSweep(sqlite, input);
  return {
    runOnce,
    start() {
      const config = entityBackfillConfig(input.env);
      if (!config.enabled || timer) return;
      status.running = true;
      timer = setInterval(() => { void runOnce().catch((error) => (input.logger ?? console).error(error)); }, config.intervalMs);
    },
    stop() { if (timer) clearInterval(timer); timer = null; status.running = false; },
    isRunning: () => timer !== null,
  };
}

async function plan(sqlite: Database, input: EntityBackfillOptions, limit: number, entityScanLimit: number): Promise<Plan> {
  const tenantId = input.tenantId ?? currentTenantId();
  const docs = loadDocs(sqlite, input.limit ?? limit, tenantId);
  const links = existingLinkKeys(sqlite, docs.map((doc) => doc.id), tenantId);
  const linkDocs = docs.filter((doc) => !sameSet(entityKeys(doc), links.get(doc.id) ?? new Set()));
  const sidecars = await sidecarPlans(docs, input, entityScanLimit, tenantId);
  return { docs, linkDocs, sidecars, coverage: readEntityCoverageStats(sqlite, tenantId) };
}

async function sidecarPlans(docs: IndexedDoc[], input: EntityBackfillOptions, scanLimit: number, tenantId?: string): Promise<SidecarPlan[]> {
  const models = input.models?.() ?? getEmbeddingModels();
  const createStore = input.createStore ?? createVectorStoreForModel;
  const plans: SidecarPlan[] = [];
  for (const [key, preset] of Object.entries(models)) {
    const entityPreset = { ...preset, collection: entityCollectionName(preset.collection) };
    const store = createStore(entityPreset);
    try {
      await store.connect(); await store.ensureCollection();
      const existing = await existingEntityDocs(store, scanLimit, tenantId);
      const docsToWrite: VectorDocument[] = [], deleteIds = new Set<string>();
      for (const doc of docs) {
        const expected = entityDocumentsFor(vectorDoc(doc));
        if (expected.length === 0) continue;
        const seen = existing.get(doc.id) ?? new Set<string>();
        if (sameSet(new Set(expected.map((item) => item.id)), seen)) continue;
        expected.forEach((item) => docsToWrite.push(item));
        [...seen, ...expected.map((item) => item.id)].forEach((id) => deleteIds.add(id));
      }
      if (docsToWrite.length > 0) plans.push({ key, preset: entityPreset, docs: docsToWrite, deleteIds: [...deleteIds] });
    } finally { await store.close?.().catch(() => undefined); }
  }
  return plans;
}

async function applyPlan(sqlite: Database, planned: Plan, input: EntityBackfillOptions): Promise<EntityBackfillApplied> {
  let linksWritten = 0, entityDocsWritten = 0; const errors: string[] = [];
  for (const doc of planned.linkDocs) {
    try {
      replaceEntityLinks(sqlite, { documentId: doc.id, tenantId: doc.tenantId, content: doc.content, concepts: doc.concepts });
      replaceDocumentPointers(sqlite, { documentId: doc.id, tenantId: doc.tenantId, content: doc.content, concepts: doc.concepts });
      linksWritten += entityKeys(doc).size;
    }
    catch (error) { errors.push(message(error)); }
  }
  const createStore = input.createStore ?? createVectorStoreForModel;
  for (const item of planned.sidecars) {
    const store = createStore(item.preset);
    try {
      await store.connect(); await store.ensureCollection();
      await store.deleteDocuments?.(item.deleteIds);
      await store.addDocuments(item.docs); entityDocsWritten += item.docs.length;
    } catch (error) { errors.push(`${item.key}: ${message(error)}`); }
    finally { await store.close?.().catch(() => undefined); }
  }
  return { docsRepaired: new Set([...planned.linkDocs.map((doc) => doc.id), ...planned.sidecars.flatMap((item) => item.docs.map((doc) => String(doc.metadata.source_doc_id)))]).size, linksWritten, entityDocsWritten, errors };
}

function loadDocs(sqlite: Database, limit: number, tenantId?: string): IndexedDoc[] {
  const where = tenantId ? 'WHERE d.tenant_id = ?' : '';
  return sqlite.query<IndexedDoc, any[]>(`
    SELECT d.id, d.tenant_id AS tenantId, d.type, d.source_file AS sourceFile,
      d.concepts, d.project, GROUP_CONCAT(f.content, '\n') AS content
    FROM oracle_documents d JOIN oracle_fts f ON f.id = d.id
    ${where} GROUP BY d.id ORDER BY d.indexed_at DESC LIMIT ?`).all(...(tenantId ? [tenantId, limit] : [limit]));
}

function existingLinkKeys(sqlite: Database, ids: string[], tenantId?: string): Map<string, Set<string>> {
  if (ids.length === 0) return new Map();
  const params = tenantId ? [tenantId, ...ids] : ids, tenant = tenantId ? 'tenant_id = ? AND' : '';
  const rows = sqlite.query<{ documentId: string; entityKey: string }, any[]>(`
    SELECT document_id AS documentId, entity_key AS entityKey FROM oracle_entity_links
    WHERE ${tenant} document_id IN (${ids.map(() => '?').join(',')})`).all(...params);
  const out = new Map<string, Set<string>>();
  for (const row of rows) (out.get(row.documentId) ?? out.set(row.documentId, new Set()).get(row.documentId)!).add(row.entityKey);
  return out;
}

async function existingEntityDocs(store: Store, limit: number, tenantId?: string): Promise<Map<string, Set<string>>> {
  const snapshot = await store.getAllEmbeddings?.(limit);
  const out = new Map<string, Set<string>>();
  snapshot?.ids?.forEach((id, index) => {
    const meta = (snapshot.metadatas?.[index] ?? {}) as Record<string, unknown>;
    const docId = String(meta.source_doc_id ?? '');
    if (!docId || (tenantId && meta.tenant_id !== tenantId)) return;
    (out.get(docId) ?? out.set(docId, new Set()).get(docId)!).add(id);
  });
  return out;
}

function vectorDoc(doc: IndexedDoc): VectorDocument {
  return { id: doc.id, document: doc.content, metadata: { type: doc.type, source_file: doc.sourceFile, concepts: doc.concepts, tenant_id: doc.tenantId, ...(doc.project ? { project: doc.project } : {}) } };
}
function entityKeys(doc: IndexedDoc): Set<string> { return new Set(entityLinksForDocument({ documentId: doc.id, tenantId: doc.tenantId, content: doc.content, concepts: doc.concepts }).map((link) => link.entityKey)); }
function report(planned: Plan): EntityBackfillReport { return { ...planned.coverage, scanned: planned.docs.length, linkDocsMissing: planned.linkDocs.length, sidecarDocsMissing: new Set(planned.sidecars.flatMap((item) => item.docs.map((doc) => String(doc.metadata.source_doc_id)))).size, entityDocsPlanned: planned.sidecars.reduce((sum, item) => sum + item.docs.length, 0), models: planned.sidecars.map((item) => item.key) }; }
function emptyReport(sqlite: Database, input: EntityBackfillOptions): EntityBackfillReport { return { ...readEntityCoverageStats(sqlite, input.tenantId ?? currentTenantId()), scanned: 0, linkDocsMissing: 0, sidecarDocsMissing: 0, entityDocsPlanned: 0, models: [] }; }
function emptyApplied(): EntityBackfillApplied { return { docsRepaired: 0, linksWritten: 0, entityDocsWritten: 0, errors: [] }; }
function finish(enabled: boolean, started: number, dryRun: EntityBackfillReport, applied: EntityBackfillApplied, after: EntityBackfillReport): EntityBackfillResult { status.lastRun = new Date(started).toISOString(); status.lastDurationMs = Date.now() - started; status.lastDryRun = dryRun; status.lastApplied = applied; return { enabled, dryRun, applied, after }; }
function sameSet(left: Set<string>, right: Set<string>): boolean { return left.size === right.size && [...left].every((item) => right.has(item)); }
function intEnv(raw: string | undefined, fallback: number, min: number, max: number): number { const parsed = Number.parseInt(raw ?? '', 10); return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
