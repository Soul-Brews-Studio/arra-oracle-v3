/** Vault time travel (#3110): the git log is the timeline; any commit opens read-only. */
import { beforeAll, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { noteAt, vaultAt, vaultHistory } from '../history.ts';

let dir: string, vault: string;
const sh = (args: string[]) => {
  const p = Bun.spawnSync(['git', '-C', vault, ...args], { env: { ...process.env, GIT_AUTHOR_NAME: 'hub', GIT_AUTHOR_EMAIL: 'h@x', GIT_COMMITTER_NAME: 'hub', GIT_COMMITTER_EMAIL: 'h@x' } });
  if (p.exitCode !== 0) throw new Error(p.stderr.toString());
  return p.stdout.toString().trim();
};
const commit = (file: string, body: string | null, msg: string) => {
  const f = path.join(vault, file);
  if (body === null) fs.rmSync(f); else { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body); }
  sh(['add', '-A']); sh(['commit', '-qm', msg]);
  return sh(['rev-parse', 'HEAD']);
};
let shaA: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-hist-'));
  vault = path.join(dir, 'vault');
  fs.mkdirSync(vault); sh(['init', '-q']);
  commit('README.md', '# soul-brews vault\n', 'init');
  shaA = commit('notes/a.md', '# Note from node a\nbisque at cone 04\n', 'share: Note from node a');
  commit('notes/b.md', '# Note from node b\n', 'share: Note from node b');
  commit('notes/a.md', null, 'retire: note a');
  fs.writeFileSync(path.join(dir, 'arra.json'), JSON.stringify({ version: 1, name: 'hub', vaults: [{ name: 'vault', path: vault }] }));
  fs.mkdirSync(path.join(dir, 'snapshots'));
  fs.writeFileSync(path.join(dir, 'snapshots', `lancedb-none-${shaA.slice(0, 12)}.tar.zst`), 'x');
});

describe('vault history', () => {
  test('newest first, each commit typed by its message, with file changes', () => {
    const h = vaultHistory(50, dir);
    expect(h.events.map((e) => e.kind)).toEqual(['retire', 'share', 'share', 'init']);
    expect(h.events[0].changes).toEqual([{ path: 'notes/a.md', status: 'deleted' }]);
    expect(h.head).toBe(h.events[0].sha);
  });
  test('a snapshot hangs on the commit it was cut from', () => {
    const e = vaultHistory(50, dir).events.find((x) => x.sha === shaA)!;
    expect(e.snapshots).toEqual([`lancedb-none-${shaA.slice(0, 12)}.tar.zst`]);
  });
  test('going back to a commit shows the notes of that moment and what changed since', () => {
    const at = vaultAt(shaA, dir);
    expect(at.notes.map((n) => n.title).sort()).toEqual(['Note from node a', 'soul-brews vault']);
    expect(at.sinceThen).toContainEqual({ path: 'notes/a.md', status: 'deleted' });
    expect(at.sinceThen).toContainEqual({ path: 'notes/b.md', status: 'added' });
    expect(noteAt(shaA, 'notes/a.md', dir)).toContain('bisque at cone 04');
  });
  test('a retired note is still readable at its old commit; bad input is refused', () => {
    expect(() => noteAt(shaA, '../arra.json', dir)).toThrow();
    expect(() => vaultAt('HEAD; rm -rf /', dir)).toThrow('sha must be');
    expect(() => vaultAt('deadbeef', dir)).toThrow('no commit');
  });
});
