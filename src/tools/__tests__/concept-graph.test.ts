/**
 * Unit tests for the concept graph helper (recordConceptRelations / getRelatedConcepts).
 */
import { describe, it, expect } from 'bun:test';
import Database from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as schema from '../../db/schema.ts';
import { recordConceptRelations, getRelatedConcepts, slugifyConcept } from '../concept-graph.ts';
import type { ToolContext } from '../types.ts';

const SCHEMA_SQL = `
CREATE TABLE oracle_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  source_file TEXT NOT NULL,
  concepts TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  indexed_at INTEGER NOT NULL
);
CREATE TABLE concept_entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE concept_relations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object_id TEXT NOT NULL,
  source_doc_id TEXT,
  created_at INTEGER NOT NULL
);
`;

function makeDb(): ToolContext['db'] {
  const sqlite = new Database(':memory:');
  sqlite.exec(SCHEMA_SQL);
  return drizzle(sqlite, { schema });
}

describe('slugifyConcept', () => {
  it('lowercases and dashes non-alphanumerics', () => {
    expect(slugifyConcept('Nothing is Deleted')).toBe('nothing-is-deleted');
    expect(slugifyConcept('  trust/safety  ')).toBe('trust-safety');
  });

  it('returns empty string for concepts with no alphanumerics', () => {
    expect(slugifyConcept('---')).toBe('');
  });
});

describe('recordConceptRelations', () => {
  it('records one relation per unordered pair of concepts on a doc', () => {
    const db = makeDb();
    recordConceptRelations(db, 'doc-1', ['trust', 'safety', 'pattern'], 1000);

    const related = getRelatedConcepts(db, 'trust');
    expect(related.map(r => r.name).sort()).toEqual(['pattern', 'safety']);
  });

  it('is idempotent for the same document (no duplicate relations)', () => {
    const db = makeDb();
    recordConceptRelations(db, 'doc-1', ['trust', 'safety'], 1000);
    recordConceptRelations(db, 'doc-1', ['trust', 'safety'], 2000);

    const related = getRelatedConcepts(db, 'trust');
    expect(related).toHaveLength(1);
    expect(related[0]).toEqual({ name: 'safety', count: 1 });
  });

  it('accumulates counts across multiple documents', () => {
    const db = makeDb();
    recordConceptRelations(db, 'doc-1', ['trust', 'safety'], 1000);
    recordConceptRelations(db, 'doc-2', ['trust', 'safety'], 2000);

    const related = getRelatedConcepts(db, 'trust');
    expect(related[0]).toEqual({ name: 'safety', count: 2 });
  });

  it('ignores single-concept documents (no pair to relate)', () => {
    const db = makeDb();
    recordConceptRelations(db, 'doc-1', ['solo'], 1000);
    expect(getRelatedConcepts(db, 'solo')).toEqual([]);
  });

  it('never throws on empty input', () => {
    const db = makeDb();
    expect(() => recordConceptRelations(db, 'doc-1', [], 1000)).not.toThrow();
  });
});

describe('getRelatedConcepts', () => {
  it('returns empty array for an unknown concept', () => {
    const db = makeDb();
    expect(getRelatedConcepts(db, 'never-seen')).toEqual([]);
  });
});
