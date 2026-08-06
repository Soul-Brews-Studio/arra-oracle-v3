import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ask-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-ask-${stamp}`;
const docId = `ask-doc-${stamp}`;
const term = `askterm${stamp}`;

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
  route = ask.createAskRoutes({
    client: async (prompt) => ({ answer: `Use the cited oracle source [${prompt.sources[0]?.index}].`, citations: [1], noEvidence: false }),
    now: () => new Date('2026-06-17T00:00:00.000Z'),
  });

  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id: docId,
    tenantId,
    type: 'learning',
    sourceFile: 'ψ/shared/ask.md',
    concepts: JSON.stringify(['ask']),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'ask',
    createdBy: 'ask-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(docId, `Oracle answer evidence with ${term}`, 'ask');
});

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

describe('POST /api/ask', () => {
  test('runs hybrid search and returns LLM synthesis with citations', async () => {
    const res = await post({ q: term, llm: true });
    const body = await res.json() as { answer: string; citations: Array<{ index: number; id: string }>; citationIndexes: number[]; noEvidence: boolean; mode: string; sources: Array<{ id: string }> };

    expect(res.status).toBe(200);
    expect(body.mode).toBe('llm');
    expect(body.answer).toContain('[1]');
    expect(body.citationIndexes).toEqual([1]);
    expect(body.citations).toEqual([expect.objectContaining({ index: 1, id: docId })]);
    expect(body.noEvidence).toBe(false);
    expect(body.sources[0].id).toBe(docId);
  });

  test('falls back to extractive citations when LLM is disabled', async () => {
    const res = await post({ q: term, llm: false });
    const body = await res.json() as { mode: string; citations: Array<{ index: number; id: string }>; citationIndexes: number[]; answer: string };

    expect(res.status).toBe(200);
    expect(body.mode).toBe('extractive');
    expect(body.citationIndexes).toEqual([1]);
    expect(body.citations[0]).toMatchObject({ index: 1, id: docId });
    expect(body.answer).toContain('[1]');
  });

  test('flags no evidence when retrieval returns nothing', async () => {
    const res = await post({ q: `missing-${stamp}`, llm: true });
    const body = await res.json() as { noEvidence: boolean; citations: unknown[]; citationIndexes: number[]; sources: unknown[] };

    expect(res.status).toBe(200);
    expect(body.noEvidence).toBe(true);
    expect(body.citations).toEqual([]);
    expect(body.citationIndexes).toEqual([]);
    expect(body.sources).toEqual([]);
  });
});
