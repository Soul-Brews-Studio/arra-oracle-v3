import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { containedHandoffFile, relativeKnowledgePath, safeHandoffSlug, writeHandoffFile } from '../handoff.ts';
import { listHandoffFiles, parsePageInt } from '../inbox.ts';

let tmp = '';

function tempRoot() {
  tmp = mkdtempSync(path.join(tmpdir(), 'arra-knowledge-lib-'));
  return tmp;
}

afterEach(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
  tmp = '';
});

describe('knowledge handoff helpers', () => {
  test('sanitizes invalid slugs and contains generated files', () => {
    const root = tempRoot();
    const dir = path.join(root, 'ψ/inbox/handoff');
    const file = writeHandoffFile(dir, 'hello', safeHandoffSlug('../../🔥', 'fallback text'), new Date('2026-06-16T08:09:00Z'));

    expect(path.basename(file)).toContain('handoff');
    expect(relativeKnowledgePath(root, file)).toBe('ψ/inbox/handoff/2026-06-16_08-09_handoff.md');
    expect(() => containedHandoffFile(dir, '../escape.md')).toThrow('Invalid handoff path');
  });
});

describe('knowledge inbox helpers', () => {
  test('strictly parses pagination integers', () => {
    expect(parsePageInt('25', 10, 1, 100)).toBe(25);
    expect(parsePageInt('25abc', 10, 1, 100)).toBe(10);
    expect(parsePageInt('-1', 10, 0, 100)).toBe(10);
    expect(parsePageInt('500', 10, 1, 100)).toBe(100);
  });

  test('lists handoff markdown files while skipping directories and unreadable races', () => {
    const root = tempRoot();
    const dir = path.join(root, 'ψ/inbox/handoff');
    mkdirSync(path.join(dir, '2026-06-16_01-00_directory.md'), { recursive: true });
    writeFileSync(path.join(dir, '2026-06-16_02-00_valid.md'), 'a'.repeat(600));
    writeFileSync(path.join(dir, 'ignore.txt'), 'nope');

    const files = listHandoffFiles(dir, root);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      filename: '2026-06-16_02-00_valid.md',
      created: '2026-06-16T02:00:00',
      type: 'handoff',
    });
    expect(files[0].preview).toHaveLength(500);
  });
});
