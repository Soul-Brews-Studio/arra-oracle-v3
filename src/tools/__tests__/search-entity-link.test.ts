import { afterEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase } from '../../db/index.ts';
import type { DatabaseConnection } from '../../db/create.ts';
import { handleSearch } from '../search.ts';
import type { EntityLinkSearchHook } from '../search.ts';
import type { ToolContext } from '../types.ts';

const roots: string[] = [];
const connections: DatabaseConnection[] = [];
const originalVectorEnabled = process.env.ORACLE_VECTOR_ENABLED;
const originalRerankerUrl = process.env.ORACLE_RERANKER_URL;

function tempRoot(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function makeCtx(entityLinkSearch: EntityLinkSearchHook): ToolContext & { entityLinkSearch: EntityLinkSearchHook } {
  const connection = createDatabase(path.join(tempRoot('arra-search-entity-link-'), 'oracle.db'));
  connections.push(connection);
  const vectorStore = {
    name: 'mock-vector',
    query: async () => ({
      ids: ['keyword-doc', 'entity-doc'],
      documents: ['keyword baseline', 'entity linked memory'],
      distances: [0.55, 0.7],
      metadatas: [
        { type: 'learning', source_file: 'docs/keyword.md', concepts: '[]' },
        { type: 'learning', source_file: 'docs/entity.md', concepts: '[]' },
      ],
    }),
  };
  return {
    db: connection.db,
    sqlite: connection.sqlite,
    repoRoot: tempRoot('arra-search-entity-repo-'),
    vectorStore: vectorStore as any,
    vectorStatus: 'connected',
    version: 'test-version',
    entityLinkSearch,
  };
}

afterEach(() => {
  process.env.ORACLE_VECTOR_ENABLED = originalVectorEnabled;
  process.env.ORACLE_RERANKER_URL = originalRerankerUrl;
  for (const connection of connections.splice(0)) connection.storage.close();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('oracle_search uses entity links as a non-graph rank boost', async () => {
  process.env.ORACLE_VECTOR_ENABLED = '1';
  delete process.env.ORACLE_RERANKER_URL;
  const ctx = makeCtx(async () => [
    { sourceDocId: 'entity-doc', entity: 'Cloudflare Workers', score: 1 },
  ]);

  const body = parse(await handleSearch(ctx, {
    query: 'workers deploy',
    mode: 'vector',
    limit: 2,
  }));

  expect(body.results.map((result: { id: string }) => result.id)).toEqual(['entity-doc', 'keyword-doc']);
  expect(body.results[0].provenance).toMatchObject({
    source: 'vector',
    entity_link_score: 1,
    entity_link_matches: ['Cloudflare Workers'],
  });
  expect(body.results[0].confidence.signals).toContain('matched by entity-link ranking signal');
  expect(body.metadata.entityLinks).toMatchObject({
    enabled: true,
    graph: false,
    hits: 1,
    boosted: 1,
  });
});
