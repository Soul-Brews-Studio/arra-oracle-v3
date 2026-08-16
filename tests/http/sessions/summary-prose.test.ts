/**
 * A stored summary must read as prose, not as its storage wrapper.
 *
 * `buildLearningMarkdown` writes ~15 lines of frontmatter, then an `# H1` that `firstSummaryLine`
 * produced by truncating the summary's own first line — often mid-sentence — then the summary,
 * then a footer. Rendered raw, a reader meets `hash: sha256:…` and `arra_concepts: […]` before
 * they meet a sentence, and then reads a broken version of that sentence twice.
 *
 * These pin the stripping, and equally that it is conservative: a `---` inside the body is a
 * horizontal rule, not a frontmatter fence, and must survive.
 */
import { describe, expect, test } from 'bun:test';
import { authorFromContent, summaryProse } from '../../../src/routes/sessions/summaries.ts';

const stored = (body: string, source = 'session-summary from claude-opus-5') =>
  `---\nid: session-summary_abc\ntype: learning\ntitle: "Truncated headline that stops mid"\n` +
  `concepts: [session-summary]\nhash: sha256:deadbeef\nsource: ${source}\n---\n\n` +
  `# Truncated headline that stops mid\n\n${body}\n\n---\n*Added via session auto-summary*\n`;

describe('summaryProse', () => {
  test('returns the summary and nothing else', () => {
    const body = 'Exported 6,024 sessions into one SQLite corpus and reported the +7h timestamp bug.';
    expect(summaryProse(stored(body))).toBe(body);
  });

  test('drops the frontmatter — no hash, no concepts array, no arra_ fields', () => {
    const prose = summaryProse(stored('The summary.'));
    expect(prose).not.toContain('sha256');
    expect(prose).not.toContain('concepts:');
    expect(prose).not.toContain('---');
  });

  test('drops the truncated H1 rather than showing a broken sentence twice', () => {
    const prose = summaryProse(stored('A full sentence that does not stop mid.'));
    expect(prose).not.toContain('stops mid');
    expect(prose.startsWith('#')).toBe(false);
  });

  test('a horizontal rule inside the body survives — only the trailing footer is removed', () => {
    const body = 'First part.\n\n---\n\nSecond part.';
    const prose = summaryProse(stored(body));
    expect(prose).toBe(body);
    expect(prose).not.toContain('Added via session auto-summary');
  });

  test('content with no frontmatter is returned unchanged', () => {
    expect(summaryProse('Just a sentence.')).toBe('Just a sentence.');
  });

  test('an empty document yields an empty string, not a crash', () => {
    expect(summaryProse('')).toBe('');
  });
});

describe('authorFromContent', () => {
  test('reads the claimed author from the source line', () => {
    expect(authorFromContent(stored('x'))).toBe('claude-opus-5');
  });

  test('an unattributed summary reports null rather than inventing "unknown"', () => {
    expect(authorFromContent(stored('x', 'session-summary'))).toBeNull();
  });

  test('a document with no source line reports null', () => {
    expect(authorFromContent('# Heading\n\nBody.')).toBeNull();
  });
});
