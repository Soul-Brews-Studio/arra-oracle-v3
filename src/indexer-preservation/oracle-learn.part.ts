import { beforeEach, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { oracleDocuments } from '../db/schema.ts';
import { db, insertTestDoc, resetTables, simulateSmartDeletion } from './setup.ts';

describe('Indexer Preservation - oracle_learn documents', () => {
  beforeEach(resetTables);
  it('should preserve oracle_learn documents during re-index', () => {
    insertTestDoc({
      id: 'test-oracle-learn-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/test.md',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
    });

    insertTestDoc({
      id: 'test-indexer-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/local.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = simulateSmartDeletion('github.com/current/repo');
    const preserved = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'test-oracle-learn-1')).get();
    const notPreserved = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'test-indexer-1')).get();

    expect(preserved).toBeDefined();
    expect(preserved?.createdBy).toBe('oracle_learn');
    expect(notPreserved).toBeUndefined();
    expect(deleted).toContain('test-indexer-1');
    expect(deleted).not.toContain('test-oracle-learn-1');
  });

  it('should preserve oracle_learn docs from different projects', () => {
    insertTestDoc({
      id: 'learn-repo-a',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/a.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-a',
    });

    insertTestDoc({
      id: 'learn-repo-b',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/b.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-b',
    });

    simulateSmartDeletion('github.com/team/repo-a');

    const docA = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'learn-repo-a')).get();
    const docB = db.select().from(oracleDocuments)
      .where(eq(oracleDocuments.id, 'learn-repo-b')).get();

    expect(docA).toBeDefined();
    expect(docB).toBeDefined();
  });
});
