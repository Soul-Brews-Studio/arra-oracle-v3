import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-ask-real-'));
const stamp = `${Date.now()}${Math.random().toString(16).slice(2)}`;
const tenantId = `tenant-real-${stamp}`;
const oldDocId = `ask-real-old-${stamp}`;
const newDocId = `ask-real-new-${stamp}`;
const term = `dialectic${stamp}`;

let dbModule: typeof import('../../../src/db/index.ts');
let route: { handle: (request: Request) => Response | Promise<Response> };
let createTenantFetch: typeof import('../../../src/middleware/tenant.ts').createTenantFetch;
let tenantHeader: string;
let capturedPrompt: import('../../../src/routes/ask/synthesis.ts').AskPrompt | undefined;

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
      capturedPrompt = prompt;
      return { answer: `The oracle cites the indexed rollout note [1].`, citations: [1], noEvidence: false };
    },
    now: () => new Date('2026-06-17T01:00:00.000Z'),
  });

  const now = Date.now();
  for (const [id, supersededBy] of [[oldDocId, newDocId], [newDocId, null]] as const) {
    dbModule.db.insert(dbModule.oracleDocuments).values({
      id,
      tenantId,
      type: 'learning',
      sourceFile: `docs/real/${id}.md`,
      concepts: JSON.stringify(['dialectic', 'ask']),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
      supersededBy,
      supersededAt: supersededBy ? now + 1 : null,
      supersededReason: supersededBy ? 'newer rollout note' : null,
      project: 'ask-real',
      createdBy: 'ask-real-test',
    }).run();
  }
  dbModule.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(oldDocId, `Real rollout evidence for ${term}: use cited synthesis from indexed docs.`, 'dialectic ask');
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

describe('POST /api/ask real-data verification', () => {
  test('queries indexed data, sends cited sources to LLM, and preserves supersede status', async () => {
    const res = await post({ q: `What does ${term} say?`, llm: true, limit: 4 });
    const body = await res.json() as Record<string, any>;

    expect(res.status).toBe(200);
    expect(body.mode).toBe('llm');
    expect(body.answer).toContain('[1]');
    expect(body.citationIndexes).toEqual([1]);
    expect(body.citations[0]).toMatchObject({ index: 1, id: oldDocId, sourceFile: `docs/real/${oldDocId}.md` });
    expect(body.noEvidence).toBe(false);
    expect(body.generatedAt).toBe('2026-06-17T01:00:00.000Z');
    expect(body.sources[0]).toMatchObject({
      id: oldDocId,
      sourceFile: `docs/real/${oldDocId}.md`,
      supersededBy: newDocId,
      supersededReason: 'newer rollout note',
    });
    expect(capturedPrompt?.question).toContain(term);
    expect(capturedPrompt?.sources[0].excerpt).toContain('Real rollout evidence');
    expect(capturedPrompt?.sources[0].supersededBy).toBe(newDocId);
  });
});
