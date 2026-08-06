import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../../src/db/index.ts';
import { oracleDocuments } from '../../src/db/schema.ts';
import type { DatabaseConnection } from '../../src/db/create.ts';
import { handleSearch } from '../../src/tools/search.ts';
import type { ToolContext } from '../../src/tools/types.ts';

type FixtureDoc = { id: string; query: string; focus: string; concepts: string[] };
type SearchPayload = { results: Array<{ content?: string; summary?: string }>; metadata: { retrieval?: Record<string, unknown> } };
type Measurement = { query: string; fullTokens: number; compactTokens: number; reduction: number };

const roots: string[] = [];
const connections: DatabaseConnection[] = [];

const docs: FixtureDoc[] = [
  {
    id: 'compact-bench-token-economy',
    query: 'token economy',
    concepts: ['token-economy', 'retrieval'],
    focus: 'Phoenix token economy retrieval keeps compact evidence while preserving enough detail to decide when oracle_read is necessary.',
  },
  {
    id: 'compact-bench-supersede',
    query: 'supersede provenance',
    concepts: ['supersede', 'provenance'],
    focus: 'Supersede provenance keeps invalidated memories auditable instead of deleting contradictory facts from the retrieval history.',
  },
  {
    id: 'compact-bench-confidence',
    query: 'confidence ranking',
    concepts: ['confidence', 'ranking'],
    focus: 'Confidence ranking combines freshness, source receipts, and retrieval reinforcement so stale but useful memories stay findable.',
  },
];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function makeCtx(): ToolContext {
  const connection = createDatabase(join(tempRoot('arra-compact-bench-'), 'oracle.db'));
  connections.push(connection);
  const now = Date.now();
  for (const doc of docs) {
    connection.db.insert(oracleDocuments).values({
      id: doc.id,
      type: 'learning',
      sourceFile: `ψ/memory/learnings/${doc.id}.md`,
      concepts: JSON.stringify(doc.concepts),
      createdAt: now,
      updatedAt: now,
      indexedAt: now,
    }).run();
    connection.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
      .run(doc.id, longMemory(doc.focus), doc.concepts.join(' '));
  }
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-compact-bench-repo-'),
    vectorStore: { name: 'benchmark-vector' } as any,
    vectorStatus: 'connected',
    version: 'benchmark',
  };
}

function longMemory(focus: string): string {
  const setup = 'Background migration notes, UI shell details, and unrelated deployment runbooks add context but should not dominate recall. '.repeat(4);
  const tail = 'Additional archive material about sidecars, dashboards, and operator workflows is useful only after a full document read. '.repeat(5);
  return [`# Benchmark memory`, setup, focus, tail].join('\n\n');
}

async function search(ctx: ToolContext, query: string, retrieval?: 'compact-summary'): Promise<SearchPayload> {
  const response = await handleSearch(ctx, { query, mode: 'fts', limit: 1, retrieval });
  return JSON.parse(response.content[0].text) as SearchPayload;
}

function contextText(payload: SearchPayload): string {
  return payload.results
    .map((result) => [result.content, result.summary].filter(Boolean).join('\n'))
    .join('\n---\n');
}

function approximateTokens(text: string): number {
  return text.match(/[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]/gu)?.length ?? 0;
}

function compare(query: string, full: SearchPayload, compact: SearchPayload): Measurement {
  const fullTokens = approximateTokens(contextText(full));
  const compactTokens = approximateTokens(contextText(compact));
  return {
    query,
    fullTokens,
    compactTokens,
    reduction: Number(((fullTokens - compactTokens) / fullTokens).toFixed(3)),
  };
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

afterEach(() => {
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test('compact-summary benchmark reduces retrieved tokens per query versus full retrieval (#2251)', async () => {
  const ctx = makeCtx();
  const measurements: Measurement[] = [];

  for (const doc of docs) {
    const full = await search(ctx, doc.query);
    const compact = await search(ctx, doc.query, 'compact-summary');
    expect(compact.metadata.retrieval).toMatchObject({ mode: 'compact-summary' });
    measurements.push(compare(doc.query, full, compact));
  }

  for (const measurement of measurements) {
    expect(measurement.compactTokens).toBeLessThan(measurement.fullTokens);
    expect(measurement.reduction).toBeGreaterThanOrEqual(0.25);
  }

  const fullTokensPerQuery = average(measurements.map((item) => item.fullTokens));
  const compactTokensPerQuery = average(measurements.map((item) => item.compactTokens));
  const averageReduction = 1 - (compactTokensPerQuery / fullTokensPerQuery);

  expect(compactTokensPerQuery).toBeLessThan(fullTokensPerQuery);
  expect(averageReduction).toBeGreaterThanOrEqual(0.25);
});
