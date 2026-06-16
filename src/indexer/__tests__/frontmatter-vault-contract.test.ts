import { describe, expect, it } from 'bun:test';
import { buildLearningMarkdown } from '../../learn/markdown.ts';
import { parseLearningFile } from '../parser.ts';

describe('parseLearningFile — oracle_learn frontmatter contract', () => {
  it('preserves oracle_learn ids, concepts, timestamps, and project from vault markdown', () => {
    const createdAt = new Date('2026-06-01T01:02:03.000Z');
    const id = 'learning_2026-06-01_frontmatter-contract-123';
    const sourceFile = 'ψ/memory/learnings/2026-06-01_frontmatter-contract.md';
    const markdown = buildLearningMarkdown({
      id,
      pattern: 'frontmatter identity vector replay pattern from oracle_learn',
      title: 'Frontmatter Contract',
      concepts: ['frontmatter', 'vector'],
      createdAt,
      source: 'Oracle Learn',
      project: 'github.com/Soul-Brews-Studio/arra-oracle-v3',
    });

    const docs = parseLearningFile('2026-06-01_frontmatter-contract.md', markdown, sourceFile);

    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe(id);
    expect(docs[0].type).toBe('learning');
    expect(docs[0].source_file).toBe(sourceFile);
    expect(docs[0].project).toBe('github.com/Soul-Brews-Studio/arra-oracle-v3');
    expect(docs[0].concepts).toContain('frontmatter');
    expect(docs[0].concepts).toContain('vector');
    expect(docs[0].created_at).toBe(createdAt.getTime());
    expect(docs[0].updated_at).toBe(createdAt.getTime());
    expect(docs[0].content).toContain('# Frontmatter Contract');
    expect(docs[0].content).toContain('frontmatter identity vector replay pattern');
    expect(docs[0].content).not.toContain('arra_id:');
  });
});
