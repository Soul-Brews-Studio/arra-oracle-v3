import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import { db, insertTestDoc, resetTables, simulateSmartDeletion } from './setup.ts';

describe('Indexer Preservation - project isolation', () => {
  beforeEach(resetTables);
  it('should delete indexer docs from current project only', () => {
    insertTestDoc({
      id: 'other-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/other.md',
      createdBy: 'indexer',
      project: 'github.com/other/repo',
    });

    insertTestDoc({
      id: 'current-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/current.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = simulateSmartDeletion('github.com/current/repo');
    const otherDoc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'other-repo-doc')).get();
    const currentDoc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'current-repo-doc')).get();

    expect(otherDoc).toBeDefined();
    expect(currentDoc).toBeUndefined();
    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('should delete universal (null project) indexer docs', () => {
    insertTestDoc({
      id: 'universal-indexer-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/universal.md',
      createdBy: 'indexer',
      project: null,
    });

    insertTestDoc({
      id: 'project-specific-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/project.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = simulateSmartDeletion('github.com/current/repo');

    expect(deleted).toContain('universal-indexer-doc');
    expect(deleted).toContain('project-specific-doc');
  });

  it('should preserve universal oracle_learn docs', () => {
    insertTestDoc({
      id: 'universal-learn-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/universal.md',
      createdBy: 'oracle_learn',
      project: null,
    });

    const deleted = simulateSmartDeletion('github.com/any/repo');
    const doc = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'universal-learn-doc')).get();

    expect(doc).toBeDefined();
    expect(deleted).not.toContain('universal-learn-doc');
  });
});
