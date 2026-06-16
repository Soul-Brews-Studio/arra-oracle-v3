import { describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectPsiLearn, getAllMarkdownFiles } from '../collectors.ts';

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
