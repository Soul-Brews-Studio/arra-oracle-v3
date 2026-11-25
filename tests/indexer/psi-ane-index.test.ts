/** scripts/psi-ane-index.ts: args, vault resolution (ψ or repo, through a symlink), and a scan that counts what the indexer reads. */
import { describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseArgs, resolveVault, scan } from '../../scripts/psi-ane-index.ts';

function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psi-ane-'));
  const real = path.join(root, 'other-oracle', 'ψ');
  const w = (rel: string) => { fs.mkdirSync(path.dirname(path.join(real, rel)), { recursive: true }); fs.writeFileSync(path.join(real, rel), '# x\n'); };
  w('memory/learnings/a.md'); w('memory/learnings/b.md'); w('memory/retrospectives/2026-11/r.md');
  w('inbox/i.md'); w('writing/w.md');
  const src = path.join(root, 'src-repo'); fs.mkdirSync(path.join(src, 'node_modules', 'p'), { recursive: true });
  fs.writeFileSync(path.join(src, 'README.md'), '#'); fs.writeFileSync(path.join(src, 'node_modules', 'p', 'README.md'), '#');
  fs.mkdirSync(path.join(real, 'learn', 'o', 'r'), { recursive: true });
  fs.writeFileSync(path.join(real, 'learn', 'o', 'r', 'r.md'), '#');
  fs.symlinkSync(src, path.join(real, 'learn', 'o', 'r', 'origin'));
  const repo = path.join(root, 'my-repo'); fs.mkdirSync(repo); fs.symlinkSync(real, path.join(repo, 'ψ'));
  return { repo, real };
}

describe('psi-ane-index', () => {
  test('defaults: the ANE service and EmbeddingGemma on the ANE', () => {
    const a = parseArgs(['/x', '--dry-run']);
    expect(a).toMatchObject({ target: '/x', dryRun: true, ane: 'http://127.0.0.1:11445', model: 'embeddinggemma:ane-w8a16' });
    expect(() => parseArgs(['--bogus'])).toThrow('unknown argument');
  });
  test('a repo whose ψ links to another vault resolves to the real vault', () => {
    const { repo, real } = vault();
    expect(resolveVault(repo).psi).toBe(fs.realpathSync(real));
    expect(resolveVault(path.join(repo, 'ψ')).psi).toBe(fs.realpathSync(real));
  });
  test('scan counts like the indexer: follows origin links (node_modules too) and says so', () => {
    const s = scan(resolveVault(vault().repo).psi);
    expect(s.indexed['memory/learnings']).toBe(2);
    expect(s.indexed['memory/retrospectives']).toBe(1);
    expect(s.indexed.learn).toBe(3);
    expect(s.viaOrigin).toBe(2);
    expect(s.total).toBe(6);
    expect(s.skipped).toMatchObject({ inbox: 1, writing: 1 });
  });
});
