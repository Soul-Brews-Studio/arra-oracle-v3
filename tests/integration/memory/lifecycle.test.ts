import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { startSmokeServer, type SmokeServer } from '../../smoke/_helpers.ts';

type JsonRecord = Record<string, unknown>;
type DbConnection = Awaited<ReturnType<typeof openDb>>;
type DocRow = {
  id: string;
  usage_count: number;
  last_accessed_at: number | null;
  superseded_by: string | null;
  superseded_at: number | null;
  superseded_reason: string | null;
};

let server: SmokeServer | null = null;
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const oldId = `lifecycle-old-${stamp}`;
const newId = `lifecycle-new-${stamp}`;
const term = `lifecycleterm${stamp}`;
const staleAt = Date.parse('2024-01-01T00:00:00.000Z');
const workerNow = Date.parse('2026-06-17T00:00:00.000Z');
const duplicateMemory = `${term} retrieval heat should protect useful memory. ` +
  'Consolidation should keep a canonical current learning, supersede stale duplicates, ' +
  'and preserve audit history without deleting any rows.';

beforeAll(async () => {
  server = await startSmokeServer({ name: 'memory-lifecycle' });
}, 30_000);

afterAll(async () => {
  await server?.stop();
});

async function openDb() {
  expect(server).not.toBeNull();
  const dbMod = await import('../../../src/db/index.ts');
  const worker = await import('../../../src/workers/consolidation.ts');
  return { connection: dbMod.createDatabase(server!.dbPath), worker };
}

async function json(path: string, init: RequestInit = {}) {
  expect(server).not.toBeNull();
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const response = await fetch(`${server!.baseUrl}${path}`, { ...init, headers });
  const body = await response.json() as unknown;
  expect(typeof body).toBe('object');
  expect(body).not.toBeNull();
  return { response, body: body as JsonRecord };
}

function postJson(path: string, body: unknown) {
  return json(path, { method: 'POST', body: JSON.stringify(body) });
}

function learnBody(id: string, pattern: string) {
  return {
    id,
    pattern,
    concepts: ['memory-lifecycle', 'retrieval-heat', 'dedupe'],
    project: 'github.com/soul-brews-studio/arra-oracle-v3',
    sourceFile: `ψ/memory/learnings/${id}.md`,
  };
}

function doc(db: DbConnection, id: string): DocRow {
  const row = db.connection.sqlite.prepare(`
    SELECT id, usage_count, last_accessed_at, superseded_by, superseded_at, superseded_reason
    FROM oracle_documents WHERE id = ?
  `).get(id) as DocRow | undefined;
  expect(row).toBeDefined();
  return row!;
}

function backdateOldDoc(db: DbConnection) {
  db.connection.sqlite.prepare(`
    UPDATE oracle_documents SET created_at = ?, updated_at = ?, indexed_at = ? WHERE id = ?
  `).run(staleAt, staleAt, staleAt, oldId);
}

function ids(body: JsonRecord, key: string): string[] {
  expect(Array.isArray(body[key])).toBe(true);
  return (body[key] as Array<{ id?: string }>).map((item) => String(item.id));
}

describe('memory lifecycle integration', () => {
  test('write, recall heat, consolidation supersede, and temporal expiry stay connected', async () => {
    const old = await postJson('/api/v1/learn', learnBody(oldId, duplicateMemory));
    expect(old.response.status).toBe(200);
    expect(old.body).toMatchObject({ success: true, id: oldId });

    const recall = await json(`/api/v1/search?q=${term}&mode=fts&limit=5`);
    expect(recall.response.status).toBe(200);
    expect(ids(recall.body, 'results')).toContain(oldId);

    const created = await postJson('/api/v1/learn', learnBody(newId, `${duplicateMemory} Updated canonical guidance.`));
    expect(created.response.status).toBe(200);
    expect(created.body).toMatchObject({ success: true, id: newId });

    const db = await openDb();
    let supersededAt = 0;
    try {
      const heated = doc(db, oldId);
      expect(heated.usage_count).toBeGreaterThanOrEqual(1);
      expect(heated.last_accessed_at).toBeGreaterThan(0);

      backdateOldDoc(db);
      const result = await db.worker.runConsolidationWorker(db.connection.db, db.connection.sqlite, {
        dryRun: false,
        now: workerNow,
        staleDays: 30,
        minCosine: 0.7,
        minFtsOverlap: 0.55,
        logger: { log: () => {}, warn: () => {}, error: () => {} },
      });
      const oldDoc = doc(db, oldId);
      const rowCount = db.connection.sqlite.prepare('SELECT COUNT(*) AS count FROM oracle_documents WHERE id IN (?, ?)')
        .get(oldId, newId) as { count: number };

      expect(result).toMatchObject({ dryRun: false, planned: 1, applied: 1, deleted: 0 });
      expect(result.plans[0]).toMatchObject({ oldId, newId, tenantId: 'default' });
      expect(result.confidence).toContainEqual(expect.objectContaining({ id: oldId, stale: true }));
      expect(oldDoc.superseded_by).toBe(newId);
      expect(oldDoc.superseded_reason).toContain('async consolidation duplicate');
      expect(rowCount.count).toBe(2);
      supersededAt = oldDoc.superseded_at ?? 0;
    } finally {
      db.connection.storage.close();
    }

    expect(supersededAt).toBeGreaterThan(0);
    const afterSupersede = encodeURIComponent(new Date(supersededAt + 1).toISOString());
    const expired = await json(`/api/v1/search?q=${term}&mode=fts&limit=5&asOf=${afterSupersede}`);
    expect(expired.response.status).toBe(200);
    expect(ids(expired.body, 'results')).toContain(newId);
    expect(ids(expired.body, 'results')).not.toContain(oldId);
    expect(expired.body.total).toBe(1);
  }, 45_000);
});
