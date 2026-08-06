import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseVaultFile } from '../lib/parse-body.ts';
import {
  deriveTitle,
  stripLeadingH1,
  stripExportArtifacts,
  extractTagsFromBody,
  mergeConcepts,
} from '../lib/parse-body.ts';

let vault: string;

beforeEach(async () => {
  vault = await mkdtemp(join(tmpdir(), 'import-parse-test-'));
});

afterEach(async () => {
  await rm(vault, { recursive: true, force: true });
});

describe('parse-body helpers', () => {
  test('stripLeadingH1 removes first H1', () => {
    expect(stripLeadingH1('# Hi\n\nbody')).toBe('body');
    expect(stripLeadingH1('no h1')).toBe('no h1');
  });

  test('deriveTitle prefers H1 then meta then filename', () => {
    expect(deriveTitle('# Found\n\nbody', {}, 'learnings/a.md')).toBe('Found');
    expect(deriveTitle('body', { title: 'Meta' }, 'learnings/a.md')).toBe('Meta');
    expect(deriveTitle('body', {}, 'learnings/my-file.md')).toBe('my-file');
  });

  test('extractTagsFromBody finds #tags outside code', () => {
    const body = 'hello #foo and #bar-baz\n```\n#not-a-tag\n```\n';
    expect(extractTagsFromBody(body).sort()).toEqual(['bar-baz', 'foo']);
  });

  test('stripExportArtifacts removes Related and Concepts sections', () => {
    const body = [
      '# Title',
      '',
      'real content',
      '',
      '## Related (by embedding)',
      '- [[foo]] (0.90)',
      '',
      '## Concepts',
      '#a #b',
    ].join('\n');
    const out = stripExportArtifacts(body);
    expect(out).not.toContain('Related');
    expect(out).not.toContain('## Concepts');
    expect(out).toContain('real content');
  });

  test('mergeConcepts combines frontmatter + body tags, dedupes', () => {
    const merged = mergeConcepts({ muninn_concepts: ['foo', 'Bar'] }, 'hi #bar #baz');
    expect(merged.sort()).toEqual(['bar', 'baz', 'foo']);
  });
});

describe('parseVaultFile', () => {
  test('parses a full file and produces a stable hash', async () => {
    const path = join(vault, 'a.md');
    await writeFile(
      path,
      [
        '---',
        'arra_id: doc_abc',
        'arra_type: learning',
        'muninn_concepts: [foo, bar]',
        '---',
        '',
        '# My Title',
        '',
        'some content #baz',
        '',
      ].join('\n'),
      'utf8',
    );
    const doc = await parseVaultFile(path, 'a.md');
    expect(doc.meta.arra_id).toBe('doc_abc');
    expect(doc.title).toBe('My Title');
    expect(doc.concepts.sort()).toEqual(['bar', 'baz', 'foo']);
    expect(doc.body).toContain('some content');
    expect(doc.contentHash).toBeTruthy();

    // Same input → same hash.
    const again = await parseVaultFile(path, 'a.md');
    expect(again.contentHash).toBe(doc.contentHash);
  });
});
