import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type { IndexerConfig } from '../../types.ts';
import { collectPsiProjects } from '../collect-projects.ts';

const tmpRoots: string[] = [];

function config(repoRoot: string): IndexerConfig {
  return {
    repoRoot,
    dbPath: ':memory:',
    chromaPath: path.join(repoRoot, '.vectors'),
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
      learn: 'ψ/learn',
      projects: 'ψ/projects',
    },
  };
}

afterEach(() => {
  for (const root of tmpRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('collectPsiProjects', () => {
  test('collects canonical project Markdown and rejects invalid/empty project files', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-projects-'));
    tmpRoots.push(root);

    fs.mkdirSync(path.join(root, 'ψ/projects/oracle'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ψ/projects/client-alpha'), { recursive: true });
    fs.mkdirSync(path.join(root, 'ψ/projects/Bad_ID'), { recursive: true });

    fs.writeFileSync(path.join(root, 'ψ/projects/README.md'), '# Projects\n\nContract.');
    fs.writeFileSync(path.join(root, 'ψ/projects/oracle/context.md'), '# Context\n\nShared phrase.');
    fs.writeFileSync(path.join(root, 'ψ/projects/client-alpha/context.md'), '# Context\n\nShared phrase.');
    fs.writeFileSync(path.join(root, 'ψ/projects/Bad_ID/context.md'), '# Invalid\n\nDo not index.');
    fs.writeFileSync(path.join(root, 'ψ/projects/oracle/empty.md'), '   \n');

    const docs = collectPsiProjects({ config: config(root) });
    const sourceFiles = new Set(docs.map((doc) => doc.source_file));

    expect(sourceFiles.has('ψ/projects/README.md')).toBe(true);
    expect(sourceFiles.has('ψ/projects/oracle/context.md')).toBe(true);
    expect(sourceFiles.has('ψ/projects/client-alpha/context.md')).toBe(true);
    expect(sourceFiles.has('ψ/projects/Bad_ID/context.md')).toBe(false);
    expect(sourceFiles.has('ψ/projects/oracle/empty.md')).toBe(false);

    const oracleDocs = docs.filter((doc) => doc.source_file === 'ψ/projects/oracle/context.md');
    const clientDocs = docs.filter((doc) => doc.source_file === 'ψ/projects/client-alpha/context.md');
    expect(oracleDocs.length).toBeGreaterThan(0);
    expect(clientDocs.length).toBeGreaterThan(0);
    expect(oracleDocs.every((doc) => doc.project === 'oracle')).toBe(true);
    expect(clientDocs.every((doc) => doc.project === 'client-alpha')).toBe(true);
  });

  test('missing ψ/projects is a clean empty collection', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-projects-missing-'));
    tmpRoots.push(root);
    expect(collectPsiProjects({ config: config(root) })).toEqual([]);
  });
});
