import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IndexerConfig } from '../../../src/types.ts';
import { collectPsiLearn } from '../../../src/indexer/collectors.ts';
import { createIndexerConfig } from '../../../src/indexer/cli.ts';

let repoRoot = '';

function makeConfig(): IndexerConfig {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-psi-learn-'));
  return {
    repoRoot,
    dbPath: path.join(repoRoot, 'oracle.db'),
    chromaPath: path.join(repoRoot, 'chroma'),
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
    },
  };
}

afterEach(() => {
  if (repoRoot) fs.rmSync(repoRoot, { recursive: true, force: true });
  repoRoot = '';
});

describe('ψ/learn auto-index source discovery', () => {
  test('CLI indexer config includes ψ/learn in scan paths', () => {
    const config = createIndexerConfig('/tmp/arra-psi-learn-config-test');

    expect(config.sourcePaths.learn).toBe('ψ/learn');
    expect(Object.values(config.sourcePaths)).toContain('ψ/learn');
  });

  test('standard index scan includes ψ/learn markdown by default', () => {
    const config = makeConfig();
    const learnDir = path.join(repoRoot, 'ψ', 'learn', 'github.com', 'owner', 'repo');
    const corpusDir = path.join(repoRoot, 'ψ', 'learn', 'security-corpus', 'web', 'docs');
    fs.mkdirSync(learnDir, { recursive: true });
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.writeFileSync(
      path.join(learnDir, 'exploration.md'),
      '# Exploration\n\n## Finding\n\nThe watcher and indexer should ingest learn docs.',
    );
    fs.writeFileSync(path.join(corpusDir, 'ignored.md'), 'security corpus is opt-in');

    const docs = collectPsiLearn({ config, seenContentHashes: new Set() });

    expect(docs).toHaveLength(1);
    expect(docs[0].type).toBe('learning');
    expect(docs[0].source_file).toBe('ψ/learn/github.com/owner/repo/exploration.md');
    expect(docs[0].id.startsWith('learning_psi_learn_')).toBe(true);
  });
});
