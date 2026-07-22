import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { Elysia } from 'elysia';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OracleLearnInput, OracleSearchInput } from '../types.ts';

// Compile-time contract fixtures (type-checked by `bun run build`). oracle_learn
// MUST accept an explicit null project (matching its JSON schema + handler); a
// silent swap that widens OracleSearchInput instead would fail to type-check here.
const _learnNullProject = { pattern: 'x', project: null } satisfies OracleLearnInput;
// @ts-expect-error — oracle_search project is a plain optional string, never null.
const _searchNullProject = { query: 'x', project: null } satisfies OracleSearchInput;
void _learnNullProject;
void _searchNullProject;

const saved = Object.fromEntries(['ORACLE_DATA_DIR', 'ORACLE_DB_PATH', 'ORACLE_REPO_ROOT', 'GHQ_ROOT', 'ORACLE_INDEXER_ENQUEUE']
  .map((key) => [key, process.env[key]]));
const root = join(tmpdir(), `arra-mcp-learn-authority-${Date.now()}`);
const ghqRoot = join(root, 'ghq');
const vaultRoot = join(ghqRoot, 'github.com', 'test', 'oracle-vault');
let vectors: Array<Record<string, any>> = [];
mkdirSync(vaultRoot, { recursive: true });
mkdirSync(join(vaultRoot, '.git'));
process.env.ORACLE_DATA_DIR = join(root, 'data');
process.env.ORACLE_DB_PATH = join(root, 'data', 'oracle.db');
process.env.ORACLE_REPO_ROOT = join(root, 'server', 'github.com', 'server', 'checkout');
process.env.GHQ_ROOT = ghqRoot;
process.env.ORACLE_INDEXER_ENQUEUE = '0';

const vectorStore = { addDocuments: async (docs: Array<Record<string, any>>) => { vectors.push(...docs); } };
mock.module('../../vector/factory.ts', () => ({
  EMBEDDING_MODELS: [],
  createVectorStore: () => vectorStore,
  createVectorStoreForModel: () => vectorStore,
  ensureVectorStoreConnected: async () => vectorStore,
  getEmbeddingModels: () => [],
  getVectorStoreByModel: () => vectorStore,
  getVectorStoreConfigByModel: () => ({ type: 'mock', collection: 'mock' }),
}));
const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
dbMod.setSetting('vault_repo', 'github.com/test/oracle-vault');
mock.module('../../vault/discovery.ts', () => ({ getVaultPsiRoot: () => ({ path: vaultRoot }) }));
const { mcpToolByName } = await import('../mcp-manifest.ts');
const { createLearnCrudRoutes } = await import('../../routes/learn/index.ts');
const runtime = {
  version: 'test',
  getToolCtx: async () => ({
    db: dbMod.db, sqlite: dbMod.sqlite, repoRoot: process.env.ORACLE_REPO_ROOT!,
    vectorStore: { addDocuments: async (docs: Array<Record<string, any>>) => { vectors.push(...docs); } },
    vectorStatus: 'unknown' as const, version: 'test',
  }),
};
async function learn(arguments_: Record<string, unknown>) {
  const response = await mcpToolByName.get('oracle_learn')!.handler(arguments_, runtime as any);
  return { response, payload: JSON.parse(response.content[0].text) };
}

beforeEach(() => {
  vectors = [];
  for (const table of ['indexing_jobs', 'learn_log', 'oracle_fts', 'oracle_documents']) dbMod.sqlite.run(`DELETE FROM ${table}`);
  for (const dir of ['github.com', '_universal']) rmSync(join(vaultRoot, dir), { recursive: true, force: true });
});

afterAll(() => {
  dbMod.resetDefaultDatabaseForTests(':memory:');
  for (const [key, value] of Object.entries(saved)) value === undefined ? delete process.env[key] : process.env[key] = value;
  rmSync(root, { recursive: true, force: true });
});

describe('registered oracle_learn project authority', () => {
  test('valid explicit project matches file, DB, and vector metadata', async () => {
    const project = 'github.com/acme/widgets';
    const { payload } = await learn({ pattern: 'MCP project-first placement', project });
    expect(payload.file).toStartWith(`${project}/ψ/memory/learnings/`);
    expect(existsSync(join(vaultRoot, payload.file))).toBe(true);
    const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, payload.id)).get();
    expect(row?.project).toBe(project);
    expect(vectors[0]?.metadata.project).toBe(project);
    expect(vectors[0]?.metadata.source_file).toBe(payload.file);
  });

  test('explicit null and omitted ignore server cwd and source prose', async () => {
    for (const args of [
      { pattern: 'MCP explicit universal', project: null },
      { pattern: 'MCP omitted universal', source: 'from github.com/evil/decoy' },
    ]) {
      const { payload } = await learn(args);
      expect(payload.file).toStartWith('_universal/ψ/memory/learnings/');
      const row = dbMod.db.select().from(dbMod.oracleDocuments).where(eq(dbMod.oracleDocuments.id, payload.id)).get();
      expect(row?.project).toBeNull();
      expect(vectors.at(-1)?.metadata.project).toBe('');
    }
  });

  test('malformed explicit stops before file, DB, FTS, vector, or queue effects', async () => {
    for (const project of [
      'owner/repo', 'https://github.com/acme/widgets', 'unknown', vaultRoot, process.env.ORACLE_REPO_ROOT!,
      'github.com/acme/widget space', 'github.com/acme/widget?x', 'github.com/acme/widget#x',
      'github.com/acme/widget:tag', 'github.com/acme/widget@x', 'github.com/acme/widgets.git',
      'github.com/acme/widget🔥', `github.com/${'a'.repeat(101)}/widgets`,
    ]) {
      const { response } = await learn({ pattern: `MCP reject ${project}`, project });
      expect(response.isError).toBe(true);
      expect(dbMod.sqlite.query('SELECT id FROM oracle_documents').all()).toHaveLength(0);
      expect(dbMod.sqlite.query('SELECT id FROM oracle_fts').all()).toHaveLength(0);
      expect(dbMod.sqlite.query('SELECT id FROM learn_log').all()).toHaveLength(0);
      expect(dbMod.sqlite.query('SELECT document_id FROM oracle_entity_links').all()).toHaveLength(0);
      expect(dbMod.sqlite.query('SELECT id FROM indexing_jobs').all()).toHaveLength(0);
      expect(vectors).toHaveLength(0);
      expect(Array.from(new Bun.Glob('**/*.md').scanSync(vaultRoot))).toHaveLength(0);
    }
  });

  test('MCP then HTTP same-day same-slug reserves a cross-writer suffix', async () => {
    const project = 'github.com/acme/widgets';
    const pattern = 'Cross writer shared collision';
    const first = await learn({ pattern, project });
    const app = new Elysia({ prefix: '/api' }).use(createLearnCrudRoutes());
    const response = await app.handle(new Request('http://local/api/learn', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pattern, project }),
    }));
    const second = await response.json() as Record<string, string>;
    expect(response.status).toBe(200);
    expect(second.id).toBe(`${first.payload.id}-2`);
    expect(existsSync(join(vaultRoot, first.payload.file))).toBe(true);
    expect(existsSync(join(vaultRoot, second.file))).toBe(true);
  });
});
