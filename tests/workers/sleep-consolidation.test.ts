import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const root = mkdtempSync(join(tmpdir(), 'arra-sleep-consolidation-'));
process.env.ORACLE_DATA_DIR = root;

const dbModule = await import('../../src/db/index.ts');
const workerModule = await import('../../src/workers/sleep-consolidation.ts');
const queueModule = await import('../../src/workers/consolidation-queue.ts');
const { createDatabase, oracleDocuments, resetDefaultDatabaseForTests } = dbModule;
const { createSleepConsolidationWorker, runSleepConsolidationSweep, sleepConsolidationStatus } = workerModule;
const { clearConsolidationQueueForTests, listQueuedConsolidationPlans } = queueModule;

type Connection = ReturnType<typeof createDatabase>;

const now = Date.parse('2026-07-05T00:00:00.000Z');
const content = 'Oracle memory consolidation uses vector similarity, human approval, supersede-not-delete, and no LLM.';
const models = () => ({ bge: { collection: 'oracle_docs_bge', model: 'bge-m3' } });

function connection(name: string): Connection {
  return createDatabase(join(root, `${name}.db`));
}

function addDoc(conn: Connection, id: string, updatedAt: number, tenantId = 'tenant-a') {
  conn.db.insert(oracleDocuments).values({
    id,
    tenantId,
    type: 'memory',
    sourceFile: `docs/${id}.md`,
    concepts: '["memory","consolidation"]',
    createdAt: updatedAt - 1000,
    updatedAt,
    indexedAt: updatedAt,
    usageCount: id.startsWith('new') ? 4 : 0,
  }).run();
  conn.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'memory consolidation');
}

function addPair(conn: Connection) {
  addDoc(conn, 'old-doc', now - 86_400_000);
  addDoc(conn, 'new-doc', now);
}

function connectWith(distance: number) {
  return async () => ({
    queryById: async (id: string) => ({
      ids: partnerId(id) ? [partnerId(id)!] : [],
      documents: [content],
      distances: [distance],
      metadatas: [{}],
    }),
  });
}

function partnerId(id: string): string | undefined {
  if (id.startsWith('old')) return id.replace(/^old/, 'new');
  if (id.startsWith('new')) return id.replace(/^new/, 'old');
  return undefined;
}

function supersededBy(conn: Connection, id: string) {
  return conn.db.select({ supersededBy: oracleDocuments.supersededBy })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get()?.supersededBy;
}

beforeEach(() => clearConsolidationQueueForTests());

afterAll(() => {
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  resetDefaultDatabaseForTests(':memory:');
  if (existsSync(root)) rmSync(root, { recursive: true });
});

describe('sleep-time consolidation worker', () => {
  test('stays disabled by default and does not query vectors', async () => {
    const conn = connection('disabled');
    addPair(conn);
    let called = false;
    let llmCalled = false;

    try {
      const worker = createSleepConsolidationWorker(conn.sqlite, { env: {}, connect: async () => { called = true; throw new Error('disabled'); } });
      worker.start();
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: {}, models, llmClient: async () => { llmCalled = true; return {}; },
        connect: async () => { called = true; throw new Error('disabled'); },
      });

      expect(worker.isRunning()).toBe(false);
      expect(result).toMatchObject({ enabled: false, scanned: 0, planned: 0, suggestionsEmitted: 0, deleted: 0 });
      expect(called).toBe(false);
      expect(llmCalled).toBe(false);
      expect(listQueuedConsolidationPlans('tenant-a')).toEqual([]);
      expect(supersededBy(conn, 'old-doc')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('queues a near-duplicate vector suggestion without mutating docs', async () => {
    const conn = connection('suggest');
    addPair(conn);

    try {
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: { ORACLE_CONSOLIDATION_WORKER: '1', ORACLE_CONSOLIDATION_SIMILARITY_THRESHOLD: '0.95' },
        now, models, connect: connectWith(0.02),
      });
      const queued = listQueuedConsolidationPlans('tenant-a');

      expect(result).toMatchObject({ enabled: true, scanned: 2, planned: 1, suggestionsEmitted: 1, deleted: 0 });
      expect(queued[0]).toMatchObject({ oldId: 'old-doc', newId: 'new-doc', tenantId: 'tenant-a', cosine: 0.99 });
      expect(queued[0].reason).toContain('sleep-time vector duplicate');
      expect(supersededBy(conn, 'old-doc')).toBeNull();
      expect(sleepConsolidationStatus({ ORACLE_CONSOLIDATION_WORKER: '1' }).suggestionsEmitted).toBeGreaterThanOrEqual(1);
    } finally {
      conn.storage.close();
    }
  });

  test('honors strict similarity threshold before queuing suggestions', async () => {
    const conn = connection('threshold');
    addPair(conn);

    try {
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: { ORACLE_CONSOLIDATION_WORKER: '1', ORACLE_CONSOLIDATION_SIMILARITY_THRESHOLD: '0.995' },
        now, models, connect: connectWith(0.02),
      });

      expect(result).toMatchObject({ enabled: true, scanned: 2, planned: 0, suggestionsEmitted: 0 });
      expect(listQueuedConsolidationPlans('tenant-a')).toEqual([]);
      expect(supersededBy(conn, 'old-doc')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('queues an opt-in LLM SUPERSEDE suggestion without mutating docs', async () => {
    const conn = connection('llm-suggest');
    addPair(conn);

    try {
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: { ORACLE_CONSOLIDATION_LLM: '1', ORACLE_CONSOLIDATION_SIMILARITY_THRESHOLD: '0.95' },
        now, models, connect: connectWith(0.2),
        llmClient: async () => ({
          action: 'SUPERSEDE',
          oldId: 'old-doc',
          newId: 'new-doc',
          reason: 'new-doc corrects the older consolidation note',
          model: 'mock-llm',
        }),
      });
      const queued = listQueuedConsolidationPlans('tenant-a');

      expect(result).toMatchObject({ enabled: true, scanned: 2, planned: 1, suggestionsEmitted: 1, deleted: 0 });
      expect(result.llm).toMatchObject({ enabled: true, pairs: 1, planned: 1, suggestionsEmitted: 1 });
      expect(queued[0]).toMatchObject({ oldId: 'old-doc', newId: 'new-doc', source: 'sleep-time-llm', model: 'mock-llm' });
      expect(queued[0].reason).toContain('new-doc corrects');
      expect(supersededBy(conn, 'old-doc')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('LLM NOOP decisions do not enqueue suggestions', async () => {
    const conn = connection('llm-noop');
    addPair(conn);

    try {
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: { ORACLE_CONSOLIDATION_LLM: '1' },
        now, models, connect: connectWith(0.2),
        llmClient: async () => ({ action: 'NOOP', reason: 'related but not superseding' }),
      });

      expect(result.llm).toMatchObject({ enabled: true, pairs: 1, planned: 0, suggestionsEmitted: 0 });
      expect(listQueuedConsolidationPlans('tenant-a')).toEqual([]);
      expect(supersededBy(conn, 'old-doc')).toBeNull();
    } finally {
      conn.storage.close();
    }
  });

  test('LLM pass respects the per-sweep suggestion cap', async () => {
    const conn = connection('llm-cap');
    [['old-a', 'new-a'], ['old-b', 'new-b'], ['old-c', 'new-c']]
      .forEach(([oldId, newId], index) => {
        addDoc(conn, oldId, now - 86_400_000 - index);
        addDoc(conn, newId, now - index);
      });
    let calls = 0;

    try {
      const result = await runSleepConsolidationSweep(conn.sqlite, {
        env: { ORACLE_CONSOLIDATION_LLM: '1', ORACLE_CONSOLIDATION_LLM_CAP: '1' },
        now, models, connect: connectWith(0.2),
        llmClient: async (prompt) => {
          calls += 1;
          const ids = prompt.sources.map((source) => source.id);
          return { action: 'SUPERSEDE', oldId: ids.find((id) => id.startsWith('old')), newId: ids.find((id) => id.startsWith('new')), reason: 'capped mock', model: 'mock-llm' };
        },
      });

      expect(calls).toBe(1);
      expect(result.llm).toMatchObject({ enabled: true, pairs: 1, planned: 1, suggestionsEmitted: 1 });
      expect(listQueuedConsolidationPlans('tenant-a')).toHaveLength(1);
    } finally {
      conn.storage.close();
    }
  });
});
