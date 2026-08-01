import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import { cosineDistanceToSimilarity } from '../../vector/scoring.ts';
import {
  attachSearchEvidence,
  combineResults,
  handleSearch,
  normalizeFtsScore,
} from '../search.ts';
import type { ToolContext } from '../types.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
const originalVectorEnabled = process.env.ORACLE_VECTOR_ENABLED;
const originalRerankerUrl = process.env.ORACLE_RERANKER_URL;

function tempRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(root);
  return root;
}

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function vectorContext(): ToolContext & { entityLinkSearch: () => Promise<never[]> } {
  const connection = createDatabase(path.join(tempRoot('arra-search-direction-'), 'oracle.db'));
  connections.push(connection);
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-search-direction-repo-'),
    vectorStore: {
      name: 'direction-vector',
      query: async () => ({
        ids: ['near', 'far'],
        documents: ['nearest result', 'farther result'],
        distances: [0.1, 0.7],
        metadatas: [
          { type: 'learning', source_file: 'near.md', concepts: '[]' },
          { type: 'learning', source_file: 'far.md', concepts: '[]' },
        ],
      }),
    } as ToolContext['vectorStore'],
    vectorStatus: 'connected',
    version: 'test-version',
    entityLinkSearch: async () => [],
  };
}

afterEach(() => {
  if (originalVectorEnabled === undefined) delete process.env.ORACLE_VECTOR_ENABLED;
  else process.env.ORACLE_VECTOR_ENABLED = originalVectorEnabled;
  if (originalRerankerUrl === undefined) delete process.env.ORACLE_RERANKER_URL;
  else process.env.ORACLE_RERANKER_URL = originalRerankerUrl;
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('search score direction', () => {
  test('mapped FTS scores preserve real SQLite ORDER BY rank', () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE VIRTUAL TABLE docs USING fts5(id UNINDEXED, content, tokenize='porter unicode61');
      INSERT INTO docs VALUES ('strong', 'signal signal signal signal');
      INSERT INTO docs VALUES ('weak', 'signal plus several unrelated filler words');
    `);

    const rows = sqlite.query(`
      SELECT id, rank FROM docs WHERE docs MATCH 'signal' ORDER BY rank
    `).all() as Array<{ id: string; rank: number }>;

    expect(rows.map((row) => row.id)).toEqual(['strong', 'weak']);
    expect(rows[0].rank).toBeLessThan(rows[1].rank);
    expect(normalizeFtsScore(rows[0].rank)).toBeGreaterThan(normalizeFtsScore(rows[1].rank));
    sqlite.close();
  });

  test('handler keeps smaller vector distance first and exposes canonical similarity', async () => {
    process.env.ORACLE_VECTOR_ENABLED = '1';
    delete process.env.ORACLE_RERANKER_URL;

    const body = parse(await handleSearch(vectorContext(), {
      query: 'direction contract',
      mode: 'vector',
      limit: 2,
    }));

    expect(body.results.map((result: { id: string }) => result.id)).toEqual(['near', 'far']);
    expect(body.results[0].provenance.vector_score).toBeCloseTo(cosineDistanceToSimilarity(0.1), 3);
    expect(body.results[0].provenance.vector_distance).toBe(0.1);
  });

  test('hybrid fusion arithmetic feeds public confidence without another inversion', () => {
    const [result] = attachSearchEvidence(combineResults(
      [{ id: 'both', type: 'learning', content: 'both', source_file: 'both.md', concepts: [], score: 0.5, source: 'fts' }],
      [{ id: 'both', type: 'learning', content: 'both', source_file: 'both.md', concepts: [], score: 0.7, distance: 0.6, model: 'bge-m3', source: 'vector' }],
      0.5,
      0.5,
      [{ id: 'both', type: 'learning', content: 'both', source_file: 'both.md', concepts: [], score: 0.2, pointerScore: 0.2, pointerMatches: ['both'], source: 'pointer' }],
      0.35,
    ));

    // ((0.5 * 0.5) + (0.5 * 0.7)) * 1.1 + (0.35 * 0.2) = 0.73
    expect(result.score).toBeCloseTo(0.73, 10);
    expect(result.confidence).toMatchObject({ level: 'high', score: 0.73 });
    expect(result.provenance).toMatchObject({ fts_score: 0.5, vector_score: 0.7, pointer_score: 0.2 });
  });
});
