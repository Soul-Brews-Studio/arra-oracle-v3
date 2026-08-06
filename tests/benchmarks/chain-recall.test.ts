import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDatasetText, type BenchmarkCase, type SearchHit } from '../../benchmarks/honest-recall.ts';
import { buildRetrievalMetrics, type RetrievalCase } from '../../benchmarks/honest-recall-methodology.ts';
import type { ToolContext, ToolResponse } from '../../src/tools/types.ts';
import type { ChainSearchResult } from '../../src/tools/search.ts';
import type { VectorQueryResult, VectorStoreAdapter } from '../../src/vector/types.ts';

type SearchRow = SearchHit & { score?: number; distance?: number; source?: string };
type Scenario = { direct: string[]; neighbors: Record<string, string[]> };
type MethodReport = { mode: string; recall: number; uniqueDocs: number; scores: ScoreSummary; cases: RetrievalCase[] };
type ScoreSummary = { min: number; p50: number; p90: number; max: number };

const TOP_K = 15;
const RECALL_LABEL = 'Recall@15' as const;
const saved = {
  nodeEnv: process.env.NODE_ENV,
  dataDir: process.env.ORACLE_DATA_DIR,
  dbPath: process.env.ORACLE_DB_PATH,
  vectorEnabled: process.env.ORACLE_VECTOR_ENABLED,
};
const root = join(tmpdir(), `arra-chain-recall-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');

mkdirSync(root, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;
process.env.ORACLE_VECTOR_ENABLED = '1';

const dbMod = await import('../../src/db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { chainSearch, handleSearch } = await import('../../src/tools/search.ts');

const cases = parseDatasetText(`
{"id":"cli","query":"cli bootstrap memory","expectedIds":["doc-cli-runbook"]}
{"id":"backup","query":"backup restore policy","expectedIds":["doc-backup-drill"]}
{"id":"plugin","query":"plugin validation release","expectedIds":["doc-plugin-contract"]}
`);

const scenarioByQuery: Record<string, Scenario> = {
  'cli bootstrap memory': scenario('root-cli', 'doc-cli-runbook', 'cli'),
  'backup restore policy': scenario('root-backup', 'doc-backup-drill', 'backup'),
  'plugin validation release': scenario('root-plugin', 'doc-plugin-contract', 'plugin'),
};

const allIds = collectIds(scenarioByQuery);
const distances = new Map(allIds.map((id, index) => [id, distanceFor(id, index)]));

function scenario(rootId: string, expectedId: string, prefix: string): Scenario {
  const direct = [rootId, ...Array.from({ length: 14 }, (_, i) => `${prefix}-flat-noise-${i + 1}`)];
  return {
    direct,
    neighbors: {
      [rootId]: [expectedId, `${prefix}-evidence-1`, `${prefix}-evidence-2`, `${prefix}-evidence-3`, `${prefix}-evidence-4`],
      [expectedId]: [`${prefix}-deep-1`, `${prefix}-deep-2`, `${prefix}-deep-3`, `${prefix}-deep-4`, `${prefix}-deep-5`],
    },
  };
}

function collectIds(scenarios: Record<string, Scenario>): string[] {
  const ids = new Set<string>();
  for (const item of Object.values(scenarios)) {
    item.direct.forEach((id) => ids.add(id));
    Object.values(item.neighbors).flat().forEach((id) => ids.add(id));
  }
  return [...ids];
}

function distanceFor(id: string, index: number): number {
  if (id.startsWith('root-')) return 0.05;
  if (id.startsWith('doc-')) return 0.08;
  if (id.includes('evidence')) return 0.12;
  if (id.includes('deep')) return 0.18;
  return 0.24 + (index % 8) * 0.03;
}

function restore(name: keyof typeof saved, envName: string) {
  const value = saved[name];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

function seedDocs(ctx: ToolContext) {
  const now = Date.now();
  const insertDoc = ctx.sqlite.prepare(`
    INSERT INTO oracle_documents (id, type, source_file, concepts, created_at, updated_at, indexed_at)
    VALUES (?, 'learning', ?, ?, ?, ?, ?)
  `);
  const insertFts = ctx.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)');
  for (const id of allIds) {
    const concepts = JSON.stringify(['chain-recall', id.split('-')[0]]);
    insertDoc.run(id, `ψ/memory/learnings/${id}.md`, concepts, now, now, now);
    insertFts.run(id, 'benchmark fixture text intentionally avoids seed query terms', concepts);
  }
}

function vectorResult(ids: string[]): VectorQueryResult {
  return {
    ids,
    distances: ids.map((id) => distances.get(id) ?? 0.5),
    documents: ids.map((id) => `${id} chain recall benchmark memory`),
    metadatas: ids.map((id) => ({
      type: 'learning',
      source_file: `ψ/memory/learnings/${id}.md`,
      concepts: JSON.stringify(['chain-recall', id]),
    })),
  };
}

function makeCtx(): ToolContext {
  const vectorStore: Partial<VectorStoreAdapter> = {
    name: 'benchmark-chain-vector',
    query: async (text: string, limit = TOP_K) => {
      const scenario = scenarioByQuery[text];
      return vectorResult((scenario?.direct ?? []).slice(0, limit));
    },
    queryById: async (id: string, limit = 5) => {
      const neighbors = Object.values(scenarioByQuery).find((item) => item.neighbors[id])?.neighbors[id] ?? [];
      return vectorResult(neighbors.slice(0, limit));
    },
  };
  return {
    db: dbMod.db,
    sqlite: dbMod.sqlite,
    repoRoot: root,
    vectorStore: vectorStore as VectorStoreAdapter,
    vectorStatus: 'connected',
    version: 'benchmark',
  };
}

async function flatOracleSearch(ctx: ToolContext, query: string): Promise<SearchRow[]> {
  const response = await handleSearch(ctx, { query, limit: TOP_K });
  const body = parseToolJson(response) as { results?: SearchRow[] };
  return (body.results ?? []).slice(0, TOP_K);
}

async function chainSearchTopK(ctx: ToolContext, query: string): Promise<SearchRow[]> {
  const response: ChainSearchResult = await chainSearch(ctx, { seedQuery: query, maxHops: 3, breadth: 5 });
  return response.results.slice(0, TOP_K);
}

function parseToolJson(response: ToolResponse): unknown {
  return JSON.parse(response.content[0]?.text ?? '{}');
}

async function benchmarkMethod(
  mode: string,
  benchCases: BenchmarkCase[],
  search: (query: string) => Promise<SearchRow[]>,
  scoreFor: (hit: SearchRow) => number,
): Promise<MethodReport> {
  const retrievalCases: RetrievalCase[] = [];
  const unique = new Set<string>();
  const scores: number[] = [];
  for (const item of benchCases) {
    const hits = await search(item.query);
    const ids = hits.map((hit) => hit.id);
    ids.forEach((id) => unique.add(id));
    scores.push(...hits.map(scoreFor).filter(Number.isFinite));
    retrievalCases.push({ expected_ids: item.expectedIds, retrieved_ids: ids, hit: hitsExpected(hits, item.expectedIds) });
  }
  const recall = buildRetrievalMetrics(retrievalCases, TOP_K, RECALL_LABEL)
    .find((row) => row.metric === 'Answerable-Recall@k')?.value ?? 0;
  return { mode, recall, uniqueDocs: unique.size, scores: summarize(scores), cases: retrievalCases };
}

function hitsExpected(hits: SearchRow[], expectedIds: string[]): boolean {
  const expected = new Set(expectedIds);
  return hits.some((hit) => [hit.id, hit.source_file, hit.sourceFile].some((key) => key && expected.has(key)));
}

function flatScore(hit: SearchRow): number {
  return finite(hit.score) ?? normalizedDistance(hit.distance) ?? 0;
}

function chainScore(hit: SearchRow): number {
  return normalizedDistance(hit.distance) ?? normalizedDistance(hit.score) ?? 0;
}

function normalizedDistance(value: unknown): number | undefined {
  const distance = finite(value);
  return distance === undefined ? undefined : round(1 - distance);
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function summarize(values: number[]): ScoreSummary {
  if (!values.length) return { min: 0, p50: 0, p90: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return { min: round(sorted[0]), p50: percentile(sorted, 0.5), p90: percentile(sorted, 0.9), max: round(sorted.at(-1)!) };
}

function percentile(sorted: number[], p: number): number {
  return round(sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]);
}

function round(value: number): number {
  return Number(value.toFixed(3));
}

function formatComparisonTable(reports: MethodReport[]): string {
  const rows = reports.map((item) => [item.mode, item.recall.toFixed(3), item.uniqueDocs, item.scores.min, item.scores.p50, item.scores.p90, item.scores.max]);
  return [
    '| mode | recall@15 | unique_docs | score_min | score_p50 | score_p90 | score_max |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

afterAll(() => {
  dbMod.closeDb();
  restore('nodeEnv', 'NODE_ENV');
  restore('dataDir', 'ORACLE_DATA_DIR');
  restore('dbPath', 'ORACLE_DB_PATH');
  restore('vectorEnabled', 'ORACLE_VECTOR_ENABLED');
  rmSync(root, { recursive: true, force: true });
});

describe('chain recall benchmark (#2590)', () => {
  test('compares flat oracle_search top-K with chainSearch hops in table form', async () => {
    const ctx = makeCtx();
    seedDocs(ctx);
    const flat = await benchmarkMethod('flat oracle_search', cases, (query) => flatOracleSearch(ctx, query), flatScore);
    const chain = await benchmarkMethod('chainSearch maxHops=3 breadth=5', cases, (query) => chainSearchTopK(ctx, query), chainScore);
    const table = formatComparisonTable([flat, chain]);

    expect(flat.cases).toHaveLength(cases.length);
    expect(chain.cases).toHaveLength(cases.length);
    expect(chain.recall).toBeGreaterThan(flat.recall);
    expect(chain.uniqueDocs).toBeGreaterThan(0);
    expect(table).toContain('| mode | recall@15 | unique_docs | score_min | score_p50 | score_p90 | score_max |');
    expect(table).toContain('| flat oracle_search |');
    expect(table).toContain('| chainSearch maxHops=3 breadth=5 |');
    console.info(table);
  });
});
