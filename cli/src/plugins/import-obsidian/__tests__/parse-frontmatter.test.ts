import { describe, expect, test } from 'bun:test';
import { parseFrontmatter } from '../lib/parse-frontmatter.ts';

describe('parseFrontmatter', () => {
  test('parses arra_id and scalar fields', () => {
    const raw = `---\narra_id: abc123\narra_type: learning\n---\n# Title\n\nbody\n`;
    const { meta, body } = parseFrontmatter(raw);
    expect(meta.arra_id).toBe('abc123');
    expect(meta.arra_type).toBe('learning');
    expect(body.trim()).toBe('# Title\n\nbody'.trim());
  });

  test('parses inline arrays', () => {
    const raw = `---\nmuninn_concepts: [foo, bar, "baz qux"]\n---\nhi\n`;
    const { meta } = parseFrontmatter(raw);
    expect(meta.muninn_concepts).toEqual(['foo', 'bar', 'baz qux']);
  });

  test('handles quoted strings with special chars', () => {
    const raw = `---\ntitle: "hello: world"\n---\nbody\n`;
    const { meta } = parseFrontmatter(raw);
    expect(meta.title).toBe('hello: world');
  });

  test('returns empty meta when no frontmatter', () => {
    const { meta, body } = parseFrontmatter('just text\n');
    expect(meta).toEqual({});
    expect(body).toBe('just text\n');
  });

  test('coerces numbers and booleans', () => {
    const raw = `---\narra_similarity_threshold: 0.75\nenabled: true\nn: 5\n---\nbody\n`;
    const { meta } = parseFrontmatter(raw);
    expect(meta.arra_similarity_threshold).toBe(0.75);
    expect(meta.enabled).toBe(true);
    expect(meta.n).toBe(5);
  });

  test('empty array', () => {
    const raw = `---\nmuninn_concepts: []\n---\nhi\n`;
    const { meta } = parseFrontmatter(raw);
    expect(meta.muninn_concepts).toEqual([]);
  });
});
