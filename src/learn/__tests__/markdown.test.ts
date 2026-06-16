import { describe, expect, test } from 'bun:test';
import { buildLearningMarkdown, dateSlug } from '../markdown.ts';
import { parseLearningFile } from '../../indexer/parser.ts';

const createdAt = new Date('2026-06-01T01:02:03.000Z');

describe('learning markdown builder hardening', () => {
  test('rejects invalid dates before writing frontmatter', () => {
    expect(() => dateSlug(new Date(Number.NaN))).toThrow(/valid Date/);
    expect(() => buildLearningMarkdown({
      id: 'learn_bad-date',
      title: 'Bad date',
      pattern: 'bad date pattern',
      concepts: [],
      createdAt: new Date(Number.NaN),
    })).toThrow(/valid Date/);
  });

  test('requires a non-empty id', () => {
    expect(() => buildLearningMarkdown({
      id: '  ',
      title: 'Missing id',
      pattern: 'missing id pattern',
      concepts: [],
      createdAt,
    })).toThrow(/id is required/);
  });

  test('collapses frontmatter scalars to one line to prevent injection', () => {
    const markdown = buildLearningMarkdown({
      id: 'learn-safe',
      title: 'Safe title\nproject: evil\n---',
      pattern: 'body keeps\n---\nmarkdown separators outside frontmatter',
      concepts: ['alpha, beta', 'gamma\nproject: evil', '[]', '  '],
      createdAt,
      source: 'source\nhash: fake',
      project: 'github.com/acme/repo\nsource: fake',
      type: 'learning\nother: fake',
    });

    const frontmatter = markdown.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(frontmatter.match(/^project:/gm)).toHaveLength(1);
    expect(frontmatter.match(/^source:/gm)).toHaveLength(1);
    expect(frontmatter.match(/^hash:/gm)).toHaveLength(1);
    expect(frontmatter).not.toContain('\nother: fake');
    expect(frontmatter).toContain('concepts: [alpha beta, gamma project evil]');
    expect(markdown).toContain('body keeps\n---\nmarkdown separators outside frontmatter');
  });

  test('sanitized markdown remains parseable as one learning document', () => {
    const markdown = buildLearningMarkdown({
      id: 'learn-roundtrip',
      title: 'Roundtrip: one\nInjected: no',
      pattern: 'learn markdown should roundtrip after scalar cleanup',
      concepts: ['Frontmatter, YAML', 'Vector\nReplay'],
      createdAt,
      project: 'github.com/Acme/Repo\nsource: nope',
    });

    const docs = parseLearningFile('roundtrip.md', markdown, 'ψ/memory/learnings/roundtrip.md');
    expect(docs).toHaveLength(1);
    expect(docs[0].id).toBe('learn-roundtrip');
    expect(docs[0].concepts).toContain('frontmatter yaml');
    expect(docs[0].concepts).toContain('vector replay');
    expect(docs[0].project).toBe('github.com/Acme/Repo source: nope');
  });
});
