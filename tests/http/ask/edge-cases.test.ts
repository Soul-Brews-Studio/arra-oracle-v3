import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ask-edge-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantA = `tenant-ask-a-${stamp}`;
const tenantB = `tenant-ask-b-${stamp}`;
const docA = `ask-a-${stamp}`;
const docB = `ask-b-${stamp}`;
const term = `dialecticask${stamp}`;

let dbModule: typeof import('../../../src/db/index.ts');
let route: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;
let promptSources: string[] = [];

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
    client: async (prompt) => {
      promptSources = prompt.sources.map((source) => source.id);
      return { answer: 'Use the tenant-scoped source [1].', citations: [1], noEvidence: false };
    },
    now: () => new Date('2026-06-17T00:00:00.000Z'),
  });
  insertDoc(docA, tenantA, `alpha answer evidence ${term}`);
  insertDoc(docB, tenantB, `beta answer evidence ${term}`);
});

function insertDoc(id: string, tenantId: string, content: string) {
  const now = Date.now();
  dbModule.db.insert(dbModule.oracleDocuments).values({
    id,
    tenantId,
    type: 'learning',
    sourceFile: `ψ/shared/${id}.md`,
    concepts: JSON.stringify(['dialectic', tenantId]),
    createdAt: now,
    updatedAt: now,
    indexedAt: now,
    project: 'dialectic',
    createdBy: 'dialectic-ask-test',
  }).run();
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, content, 'dialectic');
}

function post(body: Record<string, unknown>, tenantId = tenantA) {
  return createTenantFetch((req) => route.handle(req))(new Request('http://local/api/ask', {
    method: 'POST',
    headers: { 'content-type': 'application/json', [tenantHeader]: tenantId },
    body: JSON.stringify(body),
  }));
}

afterAll(() => {
  dbModule?.closeDb();
  if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe('POST /api/ask Dialectic hardening', () => {
  test('rejects empty questions after sanitization', async () => {
    const res = await post({ q: '<b></b>' });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid query: empty after sanitization' });
  });

  test('rejects missing embedding model keys before retrieval', async () => {
    const res = await post({ q: term, model: `missing-model-${stamp}` });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: `Unknown model: missing-model-${stamp}` });
  });

  test('uses tenant-scoped retrieval sources for synthesis', async () => {
    promptSources = [];
    const res = await post({ q: term, llm: true }, tenantB);
    const body = await res.json() as { sources: Array<{ id: string }>; citations: number[]; mode: string };

    expect(res.status).toBe(200);
    expect(body.mode).toBe('llm');
    expect(body.citations).toEqual([1]);
    expect(body.sources.map((source) => source.id)).toEqual([docB]);
    expect(promptSources).toEqual([docB]);
  });
});
