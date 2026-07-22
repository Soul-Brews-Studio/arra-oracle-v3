import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDocuments, collectPsiLearn, getAllMarkdownFiles } from '../collectors.ts';
import { parseLearningFile } from '../parser.ts';

const LEARN_CONFIG = (repoRoot: string) => ({
  repoRoot,
  dbPath: ':memory:',
  chromaPath: '',
  sourcePaths: {
    resonance: 'ψ/memory/resonance',
    learnings: 'ψ/memory/learnings',
    retrospectives: 'ψ/memory/retrospectives',
    distillations: 'ψ/memory/distillations',
    learn: 'ψ/learn',
  },
});

function writeLearn(dir: string, name: string, content: string): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

describe('collectDocuments — mixed flat/nested dedup (S2)', () => {
  test('exact byte-duplicate present flat AND nested indexes once, NESTED precedence', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mixed-dedup-'));
    try {
      const body = '---\ntitle: Shared\ncreated: 2026-07-22\n---\n\n# Shared\n\nExact same bytes in both roots.\n';
      writeLearn(path.join(tmp, 'ψ', 'memory', 'learnings'), 'dup.md', body);
      writeLearn(path.join(tmp, 'github.com', 'dumpdumpy', 'demo', 'ψ', 'memory', 'learnings'), 'dup.md', body);

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('github.com/dumpdumpy/demo/ψ/memory/learnings/dup.md');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('flat-only legacy file still indexes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-flat-only-'));
    try {
      writeLearn(path.join(tmp, 'ψ', 'memory', 'learnings'), 'legacy.md',
        '---\ntitle: Legacy\ncreated: 2026-07-15\n---\n\n# Legacy\n\nFlat legacy learning with no nested twin.\n');

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('ψ/memory/learnings/legacy.md');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('different bytes under two roots remain two documents', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mixed-distinct-'));
    try {
      writeLearn(path.join(tmp, 'ψ', 'memory', 'learnings'), 'a.md',
        '---\ntitle: A\ncreated: 2026-07-22\n---\n\n# A\n\nFlat body.\n');
      writeLearn(path.join(tmp, 'github.com', 'dumpdumpy', 'demo', 'ψ', 'memory', 'learnings'), 'b.md',
        '---\ntitle: B\ncreated: 2026-07-22\nproject: github.com/dumpdumpy/demo\n---\n\n# B\n\nNested body.\n');

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(2);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('_universal nested-only learning is indexed with _universal source_file and null project', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-universal-only-'));
    try {
      writeLearn(path.join(tmp, '_universal', 'ψ', 'memory', 'learnings'), 'u.md',
        '---\ntitle: U\ncreated: 2026-07-22\n---\n\n# U\n\nUniversal learning, no project.\n');

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('_universal/ψ/memory/learnings/u.md');
      expect(docs[0].project ?? null).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('exact bytes under _universal nested AND flat choose the _universal source_file once', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-universal-dup-'));
    try {
      const body = '---\ntitle: UDup\ncreated: 2026-07-22\n---\n\n# UDup\n\nSame bytes universal and flat.\n';
      writeLearn(path.join(tmp, 'ψ', 'memory', 'learnings'), 'udup.md', body);
      writeLearn(path.join(tmp, '_universal', 'ψ', 'memory', 'learnings'), 'udup.md', body);

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('_universal/ψ/memory/learnings/udup.md');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('nested-only historical file still indexes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-nested-only-'));
    try {
      writeLearn(path.join(tmp, 'github.com', 'dumpdumpy', 'demo', 'ψ', 'memory', 'learnings'), 'hist.md',
        '---\ntitle: Hist\ncreated: 2026-07-01\nproject: github.com/dumpdumpy/demo\n---\n\n# Hist\n\nHistorical nested learning.\n');

      const docs = collectDocuments({
        config: LEARN_CONFIG(tmp),
        seenContentHashes: new Set(),
        subdir: 'learnings',
        parseFn: parseLearningFile,
        label: 'learning',
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('github.com/dumpdumpy/demo/ψ/memory/learnings/hist.md');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe('getAllMarkdownFiles', () => {
  test('skips broken symlinks instead of crashing on ENOENT', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-md-scan-'));
    try {
      const keep = path.join(tmp, 'keep.md');
      fs.writeFileSync(keep, '# keep\n');
      fs.symlinkSync(path.join(tmp, 'missing.md'), path.join(tmp, 'broken.md'));

      expect(() => getAllMarkdownFiles(tmp)).not.toThrow();
      expect(getAllMarkdownFiles(tmp)).toEqual([keep]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('collects project-first vault ψ/learn files and skips security corpus by default', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-psi-learn-project-'));
    try {
      const learnDir = path.join(tmp, 'github.com', 'Soul-Brews-Studio', 'demo', 'ψ', 'learn', 'codex');
      const corpusDir = path.join(tmp, 'github.com', 'Soul-Brews-Studio', 'demo', 'ψ', 'learn', 'security-corpus');
      fs.mkdirSync(learnDir, { recursive: true });
      fs.mkdirSync(corpusDir, { recursive: true });
      fs.writeFileSync(path.join(learnDir, 'finding.md'), '# Finding\n\n## Lesson\n\nProject-first learn scan works.');
      fs.writeFileSync(path.join(corpusDir, 'skip.md'), '# Skip\n\n## Lesson\n\nSecurity corpus remains opt-in.');

      const docs = collectPsiLearn({
        config: {
          repoRoot: tmp,
          dbPath: ':memory:',
          chromaPath: '',
          sourcePaths: {
            resonance: 'ψ/memory/resonance',
            learnings: 'ψ/memory/learnings',
            retrospectives: 'ψ/memory/retrospectives',
            distillations: 'ψ/memory/distillations',
            learn: 'ψ/learn',
          },
        },
        seenContentHashes: new Set(),
      });

      expect(docs).toHaveLength(1);
      expect(docs[0].source_file).toBe('github.com/Soul-Brews-Studio/demo/ψ/learn/codex/finding.md');
      expect(docs[0].project).toBe('github.com/soul-brews-studio/demo');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
