import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { walkFiles } from '../discovery.ts';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-vault-discovery-'));

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('vault discovery edge cases', () => {
  test('walkFiles skips symlinks and returns slash-normalized relative paths', () => {
    const psiDir = path.join(root, 'ψ');
    const nested = path.join(psiDir, 'memory', 'learnings');
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, 'edge.md'), '# edge');
    fs.symlinkSync(path.join(nested, 'edge.md'), path.join(psiDir, 'linked.md'));

    const files = walkFiles(psiDir, root);

    expect(files.map((file) => file.relativePath)).toEqual(['ψ/memory/learnings/edge.md']);
  });

  test('walkFiles returns empty for missing roots', () => {
    expect(walkFiles(path.join(root, 'missing'), root)).toEqual([]);
  });
});
