import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectPsiLearn } from '../collectors.ts';
import { readLearningDocuments } from '../learn-doc-source.ts';

function config(repoRoot: string) {
  return {
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
  };
}

test('bulk ψ/learn ingest derives project from local org/repo directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-derive-project-'));
  try {
    const file = path.join(root, 'ψ', 'learn', 'Soul-Brews-Studio', 'demo', 'ops', 'runbook.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# Runbook\n\n## Finding\n\nRetry retry deploy failures with traced context.', 'utf8');

    const docs = collectPsiLearn({ config: config(root), seenContentHashes: new Set() });

    expect(docs).toHaveLength(1);
    expect(docs[0].project).toBe('github.com/soul-brews-studio/demo');
    expect(docs[0].concepts).toEqual(expect.arrayContaining(['ops', 'runbook', 'retry', 'deploy']));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('readLearningDocuments derives folder concepts without frontmatter taxonomy', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-derive-concepts-'));
  try {
    const file = path.join(root, 'github.com', 'Soul-Brews-Studio', 'demo', 'ψ', 'learn', 'codex', 'vector-search.md');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '# Vector Search\n\n## Finding\n\nLatency latency ranking improves retrieval.', 'utf8');

    const docs = readLearningDocuments(root, file);

    expect(docs).toHaveLength(1);
    expect(docs[0].project).toBe('github.com/soul-brews-studio/demo');
    expect(docs[0].concepts).toEqual(expect.arrayContaining(['codex', 'vector', 'search', 'latency', 'ranking']));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
