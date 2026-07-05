import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ask-contract-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-ask-contract-${stamp}`;
const staleId = `stale-${stamp}`;
const currentId = `current-${stamp}`;
const boostedId = `boosted-${stamp}`;
const plainId = `plain-${stamp}`;
const term = `askcontract${stamp}`;

let dbModule: typeof import('../../../src/db/index.ts');
let route: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;

beforeAll(async () => {
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  dbModule = await import('../../../src/db/index.ts');
  dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  const tenant = await import('../../../src/middleware/tenant.ts');
  createTenantFetch = tenant.createTenantFetch;
  tenantHeader = tenant.TENANT_HEADER;
  const ask = await import('../../../src/routes/ask/index.ts');
  route = ask.createAskRoutes({ now: () => new Date('2026-06-17T00:00:00.000Z') });

  insertDoc(staleId, `Superseded ${term} evidence mentions Phoenix.`, {
    supersededBy: currentId,
    validTime: Date.parse('2024-01-01T00:00:00.000Z'),
  });
  insertDoc(currentId, `Current ${term} evidence mentions Phoenix.`, {
    validTime: Date.parse('2025-01-01T00:00:00.000Z'),
  });
  insertDoc(plainId, `${term} plain evidence for Orbit.`);
  insertDoc(boostedId, `${term} boosted evidence for Orbit.`);
  insertEntity(boostedId, 'Orbit');
});

function insertDoc(id: string, content: string, options: { supersededBy?: string | null; validTime?: number } = {}) {
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `notes/${id}.md`,
    concepts: JSON.stringify(['ask', 'contract']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    validTime: options.validTime,
    supersededBy: options.supersededBy,
    supersededAt: options.supersededBy ? now + 1 : null,
    supersededReason: options.supersededBy ? 'replaced by current evidence' : null,
    project: 'ask-contract',
    createdBy: 'ask-contract-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'ask contract');
}

function insertEntity(documentId: string, entity: string) {
  const key = entity.toLowerCase();
  dbModule.db.insert(dbModule.oracleEntityLinks).values({
    id: `${tenantId}:${documentId}:${key}`,
    tenantId,
    documentId,
    entity,
    entityKey: key,
    weight: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }).run();
}

function post(body: Record<string, unknown>) {
  return createTenantFetch((req) => route.handle(req))(new Request('http://local/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [tenantHeader]: tenantId },
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true });
});

describe('POST /api/ask RAG contract', () => {
  test('accepts question and returns detailed citations plus warnings', async () => {
    const res = await post({ question: `${term} Phoenix`, llm: false, limit: 2 });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body).toMatchObject({ query: `${term} Phoenix`, noEvidence: false, mode: 'extractive' });
    expect(body.citations[0]).toMatchObject({ index: 1, id: expect.any(String), title: expect.any(String), excerpt: expect.stringContaining(term) });
    expect(body.citations[0].sourceFile).toContain('notes/');
    expect(body.citationIndexes).toContain(1);
    expect(body.warnings.some((warning: string) => warning.includes('superseded by'))).toBe(true);
    expect(body.sources.some((source: { stale: boolean; supersededBy?: string }) => source.stale && source.supersededBy === currentId)).toBe(true);
  });

  test('filters ask evidence by asOf before synthesis', async () => {
    const res = await post({ question: `${term} Phoenix`, asOf: '2024-06-01T00:00:00.000Z', llm: false, limit: 3 });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.asOf).toBe('2024-06-01T00:00:00.000Z');
    expect(body.sources.map((source: { id: string }) => source.id)).toEqual([staleId]);
    expect(body.citations[0]).toMatchObject({ id: staleId, stale: true });
    expect(body.warnings.some((warning: string) => warning.includes('superseded by'))).toBe(true);
  });

  test('returns structured no-evidence response without failing', async () => {
    const res = await post({ question: `missing-${stamp}`, llm: false });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.noEvidence).toBe(true);
    expect(body.answer).toContain('No evidence found');
    expect(body.citations).toEqual([]);
    expect(body.warnings).toContain('no_evidence_found');
  });

  test('entity boost participates in ask source ordering', async () => {
    const res = await post({ question: `${term} Orbit`, llm: false, limit: 2 });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.sources[0]).toMatchObject({ id: boostedId, entityMatches: ['Orbit'] });
    expect(body.citations[0]).toMatchObject({ id: boostedId });
  });
});
