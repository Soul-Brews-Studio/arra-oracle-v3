import { expect, test } from 'bun:test';
import { entityKey, entityLinksForDocument } from '../../src/search/entity-ranking.ts';
import { entityCollectionName, entityDocumentsFor, extractEntities } from '../../src/vector/entities.ts';

test('extractEntities combines concept metadata with write-time text entities', () => {
  const entities = extractEntities('Arra Oracle indexes Cloudflare Workers and mem0-style entity links.', '["LanceDB","Cloudflare Workers"]');
  expect(entities).toContain('LanceDB');
  expect(entities).toContain('Cloudflare Workers');
  expect(entities).toContain('Arra Oracle');
  expect(entities).toContain('mem0-style');
});

test('entityDocumentsFor writes a parallel vector payload without graph edges', () => {
  const docs = entityDocumentsFor({
    id: 'doc-1',
    document: 'Arra Oracle recalls Nat projects.',
    metadata: { concepts: 'Oracle,Nat', tenant_id: 'team-a' },
  });

  expect(entityCollectionName('oracle_knowledge')).toBe('oracle_knowledge_entities');
  expect(docs[0]).toMatchObject({
    id: 'doc-1:entity:oracle',
    document: 'Oracle',
    metadata: { source_doc_id: 'doc-1', tenant_id: 'team-a', type: 'entity' },
  });
});

test('entityDocumentsFor never emits two docs with the same id (case-variant slug collision) — ORA-EBF-20260822-01', () => {
  // Real reproducer shape from retro_13.30_...: concept "candidate" (lowercase)
  // + text "Candidate identities" (capitalized) both slug to "candidate".
  const docs = entityDocumentsFor({
    id: 'retro_x_4',
    document: 'Candidate identities (6 placeholders). SOUND-THERAPY and NNTN referenced.',
    metadata: { concepts: '["candidate","sound-therapy","nntn"]', tenant_id: 'default' },
  });

  const ids = docs.map((d) => d.id);
  // The bug: without dedupe this array had duplicate ".../:entity:candidate".
  expect(new Set(ids).size).toBe(ids.length);
  // The colliding id is present exactly once.
  expect(ids.filter((id) => id === 'retro_x_4:entity:candidate')).toHaveLength(1);
  // First-occurrence wins: extractEntities yields concepts before text matches,
  // so the concept form "candidate" is the surviving representative.
  const candidateDoc = docs.find((d) => d.id === 'retro_x_4:entity:candidate');
  expect(candidateDoc?.document).toBe('candidate');
});

test('entityLinksForDocument creates deterministic document-entity link rows', () => {
  const links = entityLinksForDocument({
    documentId: 'doc-1',
    tenantId: 'team-a',
    content: 'Arra Oracle links Cloudflare Workers for ranking only.',
    concepts: ['Cloudflare Workers'],
    now: 123,
  });

  expect(entityKey('Cloudflare Workers')).toBe('cloudflare-workers');
  expect(links).toContainEqual(expect.objectContaining({
    id: 'team-a:doc-1:cloudflare-workers',
    documentId: 'doc-1',
    tenantId: 'team-a',
    entity: 'Cloudflare Workers',
    entityKey: 'cloudflare-workers',
    createdAt: 123,
  }));
});
