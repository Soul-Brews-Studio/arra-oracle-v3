import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'bun:test';

import { createPreservationFixture } from './indexer-preservation.fixture.ts';

let fixture: ReturnType<typeof createPreservationFixture>;

beforeAll(() => {
  fixture = createPreservationFixture();
});

afterAll(() => {
  fixture.close();
});

beforeEach(() => {
  fixture.reset();
});

describe('Indexer Preservation - oracle_learn documents', () => {
  it('preserves oracle_learn documents during re-index', () => {
    fixture.insert({
      id: 'test-oracle-learn-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/test.md',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
    });
    fixture.insert({
      id: 'test-indexer-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/local.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = fixture.deleteFor('github.com/current/repo');

    expect(fixture.getDoc('test-oracle-learn-1')?.createdBy).toBe('oracle_learn');
    expect(fixture.getDoc('test-indexer-1')).toBeUndefined();
    expect(deleted).toContain('test-indexer-1');
    expect(deleted).not.toContain('test-oracle-learn-1');
  });

  it('preserves oracle_learn docs from different projects', () => {
    fixture.insert({
      id: 'learn-repo-a',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/a.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-a',
    });
    fixture.insert({
      id: 'learn-repo-b',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/b.md',
      createdBy: 'oracle_learn',
      project: 'github.com/team/repo-b',
    });

    fixture.deleteFor('github.com/team/repo-a');

    expect(fixture.getDoc('learn-repo-a')).toBeDefined();
    expect(fixture.getDoc('learn-repo-b')).toBeDefined();
  });
});

describe('Indexer Preservation - project isolation', () => {
  it('deletes indexer docs from current project only', () => {
    fixture.insert({
      id: 'other-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/other.md',
      createdBy: 'indexer',
      project: 'github.com/other/repo',
    });
    fixture.insert({
      id: 'current-repo-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/current.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = fixture.deleteFor('github.com/current/repo');

    expect(fixture.getDoc('other-repo-doc')).toBeDefined();
    expect(fixture.getDoc('current-repo-doc')).toBeUndefined();
    expect(deleted).toContain('current-repo-doc');
    expect(deleted).not.toContain('other-repo-doc');
  });

  it('deletes universal indexer docs with project-specific docs', () => {
    fixture.insert({
      id: 'universal-indexer-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/universal.md',
      createdBy: 'indexer',
      project: null,
    });
    fixture.insert({
      id: 'project-specific-doc',
      type: 'principle',
      sourceFile: 'ψ/memory/resonance/project.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
    });

    const deleted = fixture.deleteFor('github.com/current/repo');

    expect(deleted).toContain('universal-indexer-doc');
    expect(deleted).toContain('project-specific-doc');
  });

  it('preserves universal oracle_learn docs', () => {
    fixture.insert({
      id: 'universal-learn-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/universal.md',
      createdBy: 'oracle_learn',
      project: null,
    });

    const deleted = fixture.deleteFor('github.com/any/repo');

    expect(fixture.getDoc('universal-learn-doc')).toBeDefined();
    expect(deleted).not.toContain('universal-learn-doc');
  });
});

describe('Indexer Preservation - legacy docs', () => {
  it('treats null createdBy as indexer-created', () => {
    fixture.insert({
      id: 'legacy-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/legacy.md',
      createdBy: null,
      project: 'github.com/current/repo',
    });

    const deleted = fixture.deleteFor('github.com/current/repo');

    expect(fixture.getDoc('legacy-doc')).toBeUndefined();
    expect(deleted).toContain('legacy-doc');
  });
});

describe('Indexer Preservation - FTS sync', () => {
  it('deletes from FTS when deleting from oracle_documents', () => {
    fixture.insert({
      id: 'fts-test-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/fts.md',
      createdBy: 'indexer',
      project: 'github.com/current/repo',
      content: 'Searchable content for FTS test',
    });

    expect(fixture.getFts('fts-test-doc')).toBeDefined();
    fixture.deleteFor('github.com/current/repo');
    expect(fixture.getFts('fts-test-doc')).toBeFalsy();
  });

  it('preserves FTS entries for preserved documents', () => {
    fixture.insert({
      id: 'fts-preserved-doc',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/preserved.md',
      createdBy: 'oracle_learn',
      project: 'github.com/other/repo',
      content: 'This content should remain searchable',
    });

    fixture.deleteFor('github.com/current/repo');

    expect(fixture.getFts('fts-preserved-doc')?.content).toBe('This content should remain searchable');
  });
});

describe('Indexer Preservation - edge cases', () => {
  it('handles empty database gracefully', () => {
    expect(fixture.deleteFor('github.com/any/repo')).toEqual([]);
  });

  it('handles database with only oracle_learn docs', () => {
    fixture.insert({
      id: 'only-learn-1',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/1.md',
      createdBy: 'oracle_learn',
      project: 'github.com/repo/1',
    });
    fixture.insert({
      id: 'only-learn-2',
      type: 'learning',
      sourceFile: 'ψ/memory/learnings/2.md',
      createdBy: 'oracle_learn',
      project: 'github.com/repo/2',
    });

    expect(fixture.deleteFor('github.com/any/repo')).toEqual([]);
    expect(fixture.countDocs()).toBe(2);
  });

  it('handles mixed createdBy values correctly', () => {
    fixture.insert({ id: 'indexer-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/indexer.md', createdBy: 'indexer', project: 'github.com/current/repo' });
    fixture.insert({ id: 'oracle-learn-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/learn.md', createdBy: 'oracle_learn', project: 'github.com/current/repo' });
    fixture.insert({ id: 'manual-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/manual.md', createdBy: 'manual', project: 'github.com/current/repo' });
    fixture.insert({ id: 'legacy-doc', type: 'learning', sourceFile: 'ψ/memory/learnings/legacy.md', createdBy: null, project: 'github.com/current/repo' });

    const deleted = fixture.deleteFor('github.com/current/repo');
    const remaining = fixture.allIds();

    expect(deleted).toContain('indexer-doc');
    expect(deleted).toContain('legacy-doc');
    expect(deleted).not.toContain('oracle-learn-doc');
    expect(deleted).not.toContain('manual-doc');
    expect(remaining).toContain('oracle-learn-doc');
    expect(remaining).toContain('manual-doc');
  });
});
