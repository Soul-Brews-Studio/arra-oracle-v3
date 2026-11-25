/** #3114 item 3: the markdown walker never descends into node_modules or .git, even through a symlink. */
import { expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAllMarkdownFiles } from '../collectors.ts';

test('skips node_modules and .git, keeps real notes (also via an origin symlink)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-'));
  const repo = path.join(root, 'repo');
  for (const f of ['README.md', 'docs/guide.md', 'node_modules/pkg/README.md', '.git/info.md']) {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), '# x');
  }
  const learn = path.join(root, 'learn', 'o', 'r');
  fs.mkdirSync(learn, { recursive: true });
  fs.writeFileSync(path.join(learn, 'notes.md'), '# n');
  fs.symlinkSync(repo, path.join(learn, 'origin'));
  const got = getAllMarkdownFiles(path.join(root, 'learn')).map((f) => path.relative(root, f)).sort();
  expect(got).toEqual(['learn/o/r/notes.md', 'learn/o/r/origin/README.md', 'learn/o/r/origin/docs/guide.md']);
});
