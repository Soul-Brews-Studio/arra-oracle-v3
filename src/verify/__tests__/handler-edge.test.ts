import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const dataDir = path.join(tmpdir(), `arra-verify-lib-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const repoRoot = path.join(tmpdir(), `arra-verify-lib-repo-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const originalDataDir = process.env.ORACLE_DATA_DIR;
const originalDbPath = process.env.ORACLE_DB_PATH;
mkdirSync(dataDir, { recursive: true });
mkdirSync(repoRoot, { recursive: true });
process.env.ORACLE_DATA_DIR = dataDir;
process.env.ORACLE_DB_PATH = path.join(dataDir, 'oracle.db');

const dbModule = await import('../../db/index.ts');
dbModule.resetDefaultDatabaseForTests(process.env.ORACLE_DB_PATH);
const { db, oracleDocuments } = dbModule;
const { verifyKnowledgeBase } = await import('../handler.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const now = Date.now();
const relAbsolute = `ψ/memory/learnings/verify-absolute-${stamp}.md`;
const relBackslash = `ψ/memory/learnings/verify-backslash-${stamp}.md`;
const relOrphan = `ψ/memory/learnings/verify-orphan-${stamp}.md`;
const ids = {
  absolute: `verify-absolute-${stamp}`,
  backslash: `verify-backslash-${stamp}`,
  blank: `verify-blank-${stamp}`,
  orphanA: `verify-orphan-a-${stamp}`,
  orphanB: `verify-orphan-b-${stamp}`,
};

function writeRepoFile(relPath: string) {
  const fullPath = path.join(repoRoot, relPath);
  mkdirSync(path.dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, `# ${relPath}\n`);
}

function seedDoc(id: string, sourceFile: string) {
  db.insert(oracleDocuments).values({
    id,
    type: 'learning',
    concepts: '[]',
    sourceFile,
    createdAt: now,
    updatedAt: now,
    indexedAt: now + 60_000,
  }).run();
}

writeRepoFile(relAbsolute);
writeRepoFile(relBackslash);
seedDoc(ids.absolute, path.join(repoRoot, relAbsolute));
seedDoc(ids.backslash, relBackslash.replaceAll('/', '\\'));
seedDoc(ids.blank, '   ');
seedDoc(ids.orphanA, relOrphan.replaceAll('/', '\\'));
seedDoc(ids.orphanB, relOrphan);

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbModule.closeDb();
  restore('ORACLE_DATA_DIR', originalDataDir);
  restore('ORACLE_DB_PATH', originalDbPath);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(repoRoot, { recursive: true, force: true });
});

describe('verifyKnowledgeBase edge cases', () => {
  test('normalizes absolute and backslash DB source paths before classification', () => {
    const result = verifyKnowledgeBase({ repoRoot, type: ' learning ' });

    expect(result.counts.healthy).toBe(2);
    expect(result.missing).toEqual([]);
    expect(result.orphaned).toEqual([relOrphan]);
    expect(result.orphaned).not.toContain('');
  });

  test('check=false flags every DB row for one normalized orphan path', () => {
    const result = verifyKnowledgeBase({ repoRoot, type: 'learning', check: false });
    const rows = db.select({ id: oracleDocuments.id, supersededBy: oracleDocuments.supersededBy })
      .from(oracleDocuments)
      .all();
    const superseded = Object.fromEntries(rows.map((row) => [row.id, row.supersededBy]));

    expect(result.fixedOrphans).toBe(2);
    expect(superseded[ids.orphanA]).toBe('_verified_orphan');
    expect(superseded[ids.orphanB]).toBe('_verified_orphan');
    expect(superseded[ids.blank]).toBeNull();
  });
});
