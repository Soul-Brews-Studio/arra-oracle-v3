import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { ToolContext } from '../types.ts';
import { handleRead, isPathAllowed, resolveGhqAliasTargetByOrigin } from '../read.ts';

// ORA-SHARED-20260820-06 build 3: a document's DB `project` can be a repo's
// real git-origin identity (github.com/ttt3p/nntn-vault) while the only ghq
// entry for that repo is aliased under a DIFFERENT name
// (ghq/github.com/ttt3p/nntn). Creating a second ghq/nntn-vault symlink was
// explicitly NO-GO (a maw scanner derives a fresh Oracle identity per ghq
// entry name — a second entry for the same repo pollutes the registry).
// This drives handleRead() through the origin-mapping fallback instead: no
// direct ghq entry, resolved by finding the ONE existing alias whose real
// target's own git origin matches the requested project.

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const savedGhqRoot = process.env.GHQ_ROOT;

let root = '';
let ghqRoot = '';
let dbMod: typeof import('../../db/index.ts');
let ctx: ToolContext;

function parse(response: { content: Array<{ text: string }> }) {
  return JSON.parse(response.content[0].text);
}

function gitRepoWithOrigin(dir: string, originUrl: string): void {
  fs.mkdirSync(dir, { recursive: true });
  execFileSync('git', ['init', '--quiet'], { cwd: dir });
  execFileSync('git', ['remote', 'add', 'origin', originUrl], { cwd: dir });
}

function listGhqEntries(): string[] {
  const entries: string[] = [];
  for (const host of fs.readdirSync(ghqRoot)) {
    for (const owner of fs.readdirSync(path.join(ghqRoot, host))) {
      for (const repo of fs.readdirSync(path.join(ghqRoot, host, owner))) {
        entries.push(`${host}/${owner}/${repo}`);
      }
    }
  }
  return entries.sort();
}

beforeEach(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-read-origin-e2e-')));
  const repoRoot = path.join(root, 'repo');
  const dataDir = path.join(root, 'data');
  ghqRoot = path.join(root, 'ghq');
  fs.mkdirSync(repoRoot, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(ghqRoot, 'github.com', 'ttt3p'), { recursive: true });

  process.env.ORACLE_DATA_DIR = dataDir;
  process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');
  process.env.GHQ_ROOT = ghqRoot;

  dbMod = await import('../../db/index.ts');
  dbMod.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
  ctx = { db: dbMod.db, sqlite: dbMod.sqlite, repoRoot } as ToolContext;
});

afterEach(() => {
  dbMod?.closeDb();
  if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = savedDataDir;
  if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = savedDbPath;
  if (savedGhqRoot === undefined) delete process.env.GHQ_ROOT;
  else process.env.GHQ_ROOT = savedGhqRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

function insertDoc(id: string, project: string, sourceFile: string): void {
  const now = Date.now();
  dbMod.db.insert(dbMod.oracleDocuments).values({
    id, type: 'learning', sourceFile, project, concepts: JSON.stringify([]),
    createdAt: now, updatedAt: now, indexedAt: now,
  }).run();
  dbMod.sqlite.prepare('INSERT INTO oracle_fts (id, content, concepts) VALUES (?, ?, ?)')
    .run(id, 'cached fallback — should NOT be returned when the fix works', '');
}

describe('handleRead — ghq origin-mapping fallback (e2e)', () => {
  test('(1) project reachable only via an existing alias real-target origin match → source=file', async () => {
    const target = path.join(root, 'vault', 'real-repo');
    fs.mkdirSync(path.join(target, 'ψ', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(target, 'ψ', 'memory', 'note.md'), 'origin-mapped content');
    gitRepoWithOrigin(target, 'https://github.com/TTT3P/real-repo.git');
    // The ghq entry is named DIFFERENTLY from the doc's project — that's the
    // whole point: no ghq/github.com/ttt3p/real-repo entry exists.
    fs.symlinkSync(target, path.join(ghqRoot, 'github.com', 'ttt3p', 'alias-name'));

    insertDoc('doc-origin-1', 'github.com/ttt3p/real-repo', 'ψ/memory/note.md');
    const response = await handleRead(ctx, { id: 'doc-origin-1' });
    const body = parse(response);

    expect(response.isError).toBeUndefined();
    expect(body.source).toBe('file');
    expect(body.content).toBe('origin-mapped content');
    expect(body.resolved_path).toBe(fs.realpathSync(path.join(target, 'ψ', 'memory', 'note.md')));
  });

  test('(2) legacy direct ghq/<project> entry still resolves — no regression', async () => {
    const target = path.join(root, 'vault', 'direct-target');
    fs.mkdirSync(path.join(target, 'ψ', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(target, 'ψ', 'memory', 'note.md'), 'direct alias content');
    // Alias name MATCHES the project exactly — resolves via the pre-existing
    // step 1.5 direct join, same as before this build.
    fs.symlinkSync(target, path.join(ghqRoot, 'github.com', 'ttt3p', 'direct-project'));

    insertDoc('doc-direct-1', 'github.com/ttt3p/direct-project', 'ψ/memory/note.md');
    const response = await handleRead(ctx, { id: 'doc-direct-1' });
    const body = parse(response);

    expect(response.isError).toBeUndefined();
    expect(body.source).toBe('file');
    expect(body.content).toBe('direct alias content');
  });

  test('(3a) no alias target origin matches the project → fails closed to fts_cache', async () => {
    const target = path.join(root, 'vault', 'unrelated-repo');
    fs.mkdirSync(target, { recursive: true });
    gitRepoWithOrigin(target, 'https://github.com/TTT3P/unrelated-repo.git');
    fs.symlinkSync(target, path.join(ghqRoot, 'github.com', 'ttt3p', 'unrelated-alias'));

    insertDoc('doc-mismatch-1', 'github.com/ttt3p/never-registered', 'ψ/memory/note.md');
    const response = await handleRead(ctx, { id: 'doc-mismatch-1' });
    const body = parse(response);

    expect(body.source).toBe('fts_cache');
    expect(body.resolved_path).toBeNull();
  });

  test('(3b) two alias targets both claim the same origin (ambiguous) → fails closed, not a guess', async () => {
    const targetA = path.join(root, 'vault', 'ambiguous-a');
    const targetB = path.join(root, 'vault', 'ambiguous-b');
    gitRepoWithOrigin(targetA, 'https://github.com/TTT3P/ambiguous-repo.git');
    gitRepoWithOrigin(targetB, 'https://github.com/TTT3P/ambiguous-repo.git');
    fs.symlinkSync(targetA, path.join(ghqRoot, 'github.com', 'ttt3p', 'ambiguous-alias-a'));
    fs.symlinkSync(targetB, path.join(ghqRoot, 'github.com', 'ttt3p', 'ambiguous-alias-b'));

    insertDoc('doc-ambiguous-1', 'github.com/ttt3p/ambiguous-repo', 'ψ/memory/note.md');
    const response = await handleRead(ctx, { id: 'doc-ambiguous-1' });
    const body = parse(response);

    expect(body.source).toBe('fts_cache');
    expect(body.resolved_path).toBeNull();
  });

  test('(4) resolving through the alias creates NO new ghq entry — registry count/names unchanged', async () => {
    const target = path.join(root, 'vault', 'real-repo-2');
    fs.mkdirSync(path.join(target, 'ψ', 'memory'), { recursive: true });
    fs.writeFileSync(path.join(target, 'ψ', 'memory', 'note.md'), 'content');
    gitRepoWithOrigin(target, 'https://github.com/TTT3P/real-repo-2.git');
    fs.symlinkSync(target, path.join(ghqRoot, 'github.com', 'ttt3p', 'alias-name-2'));

    const before = listGhqEntries();
    insertDoc('doc-registry-1', 'github.com/ttt3p/real-repo-2', 'ψ/memory/note.md');
    const response = await handleRead(ctx, { id: 'doc-registry-1' });
    const after = listGhqEntries();

    expect(parse(response).source).toBe('file');
    expect(after).toEqual(before);
    expect(after.length).toBe(before.length);
    // Explicitly: no entry named after the requested project string exists —
    // proves the fix reused the alias, never created one for it.
    expect(after).not.toContain('github.com/ttt3p/real-repo-2');
  });
});

// Riddler latency review (build 3, corrected draft): the first version probed
// EVERY ghq entry (not just symlink aliases — this machine has 13 direct repo
// symlinks among many hundreds of plain checkouts) and isPathAllowed
// independently re-swept the same tree a second time per read. Both are
// fixed structurally now: resolveGhqAliasTargetByOrigin filters to
// lstatSync(...).isSymbolicLink() before ever probing, and isPathAllowed
// takes the already-proven alias root as a plain argument instead of
// scanning for it itself. These two tests prove both corrections directly.
describe('resolveGhqAliasTargetByOrigin — only symlink entries are ever probed', () => {
  test('a plain (non-symlink) directory sitting in ghq is skipped without invoking the probe at all', () => {
    const localRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-origin-probe-')));
    const localGhqRoot = path.join(localRoot, 'ghq');
    fs.mkdirSync(path.join(localGhqRoot, 'github.com', 'ttt3p'), { recursive: true });

    const symlinkTarget = path.join(localRoot, 'vault', 'sym-target');
    fs.mkdirSync(symlinkTarget, { recursive: true });
    fs.symlinkSync(symlinkTarget, path.join(localGhqRoot, 'github.com', 'ttt3p', 'sym-alias'));

    // A plain directory placed directly under ghq — NOT a symlink, i.e. what
    // a real (non-aliased) ghq checkout looks like. If probed, it would
    // resolve to itself (no symlink to follow), and the fake probe below
    // would record it — which must never happen.
    const plainCheckout = path.join(localGhqRoot, 'github.com', 'ttt3p', 'plain-checkout');
    fs.mkdirSync(plainCheckout, { recursive: true });

    const probed: string[] = [];
    const fakeProbe = (dir: string): string | null => {
      probed.push(dir);
      return dir === fs.realpathSync(symlinkTarget) ? 'github.com/ttt3p/target-project' : null;
    };

    const result = resolveGhqAliasTargetByOrigin(localGhqRoot, 'github.com/ttt3p/target-project', fakeProbe);

    expect(result).toBe(fs.realpathSync(symlinkTarget));
    expect(probed).toEqual([fs.realpathSync(symlinkTarget)]);
    expect(probed).not.toContain(fs.realpathSync(plainCheckout));

    fs.rmSync(localRoot, { recursive: true, force: true });
  });
});

// Riddler security review, build 3 second pass: the first correction added
// an `aliasRoot` 5th parameter directly to the EXPORTED isPathAllowed() —
// which would let any caller (a test, a future refactor, an external
// import) widen the security boundary just by passing whatever root they
// like, e.g. isPathAllowed(anyPath, x, y, z, '/'). Fixed by keeping
// isPathAllowed's public surface exactly as it always was (4 args, no alias
// concept at all) and moving the alias-root check into an internal,
// unexported isResolvedFileAllowed() that only handleRead can reach, fed
// only by resolveFilePath's own proven result — never by caller input.
describe('isPathAllowed — public signature cannot be widened by caller input', () => {
  test('function arity is exactly 4 — no aliasRoot or extra parameter exists on the public surface', () => {
    expect(isPathAllowed.length).toBe(4);
  });

  test('a smuggled 5th argument has zero effect — same result with or without it (no widening possible)', () => {
    const localRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'arra-isallowed-nowiden-')));
    const localGhqRoot = path.join(localRoot, 'ghq');
    const unrelatedRepoRoot = path.join(localRoot, 'unrelated-repo-root');
    fs.mkdirSync(path.join(localGhqRoot, 'github.com', 'ttt3p'), { recursive: true });
    fs.mkdirSync(unrelatedRepoRoot, { recursive: true });

    // A path that would ONLY be allowed if some 5th "alias root" argument
    // were honored — isPathAllowed has no such parameter, so this must stay
    // rejected no matter what a caller tries to pass in that position.
    const poisonTarget = path.join(localRoot, 'vault', 'poison-target');
    fs.mkdirSync(poisonTarget, { recursive: true });
    fs.writeFileSync(path.join(poisonTarget, 'secret.md'), 'poison');
    const resolvedPath = fs.realpathSync(path.join(poisonTarget, 'secret.md'));

    const withoutExtraArg = isPathAllowed(resolvedPath, unrelatedRepoRoot, localGhqRoot, 'github.com/ttt3p/poison-repo');
    // Simulates a careless/malicious caller bypassing the type system (the
    // real TS signature has no 5th parameter and would reject this at
    // compile time — `as any` reproduces what a JS caller could still do).
    const withSmuggledExtraArg = (isPathAllowed as (...args: unknown[]) => boolean)(
      resolvedPath, unrelatedRepoRoot, localGhqRoot, 'github.com/ttt3p/poison-repo', poisonTarget,
    );

    expect(withoutExtraArg).toBe(false);
    expect(withSmuggledExtraArg).toBe(false);
    expect(withSmuggledExtraArg).toBe(withoutExtraArg);

    fs.rmSync(localRoot, { recursive: true, force: true });
  });
});
