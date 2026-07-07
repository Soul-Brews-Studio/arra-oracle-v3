/**
 * Regression test — two-root vault drift (POST /api/learn ignores project for the write path).
 *
 * Bug: `handleLearn` (HTTP path) hardcoded `ψ/memory/learnings` at REPO_ROOT, so a
 * learning with an explicit `project` param landed flat at the vault root, while the
 * embedded MCP tool (src/tools/learn.ts) wrote project-first `{project}/ψ/memory/learnings`.
 * Two code paths → two roots → successors must search both (observed live 2026-07-06/07:
 * 17 misplaced files at the vault root).
 *
 * Fix contract (shared helper `resolveLearnDir` in src/vault/learn-path.ts, consumed by
 * BOTH paths):
 *   - vault configured + project      → {project}/ψ/memory/learnings under the vault root
 *   - vault configured + no project   → _universal/ψ/memory/learnings under the vault root
 *   - vault NOT configured            → flat ψ/memory/learnings under REPO_ROOT (local-ψ
 *     convention — matches mapToVaultPath semantics where project nesting is a vault concept)
 *
 * Hermetic: ORACLE_DATA_DIR + ORACLE_REPO_ROOT point at tmp dirs, set BEFORE the dynamic
 * import. Vault resolution is mocked so the test does not depend on ghq or real settings.
 */

import { describe, it, expect, afterAll, mock } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP_REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-projpath-repo-'));
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-projpath-data-'));
const TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-learn-projpath-vault-'));

const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;

process.env.ORACLE_REPO_ROOT = TMP_REPO_ROOT;
process.env.ORACLE_DATA_DIR = TMP_DATA_DIR;

// Vault is "configured" for this suite — both paths must nest by project under it.
mock.module('../../vault/discovery.ts', () => ({
  getVaultPsiRoot: () => ({ path: TMP_VAULT }),
}));

// Dynamic imports after env + mock are set (REPO_ROOT and DB_PATH are module-frozen).
const { handleLearn } = await import('../handlers.ts');
const { resolveLearnDir } = await import('../../vault/learn-path.ts');
const { db } = await import('../../db/index.ts');
const { oracleDocuments } = await import('../../db/schema.ts');
const { eq } = await import('drizzle-orm');

const PROJECT = 'github.com/dumpdumpy/orchestrator-oracle';

function dbSourceFile(id: string): string | null {
  const row = db.select({ sourceFile: oracleDocuments.sourceFile })
    .from(oracleDocuments)
    .where(eq(oracleDocuments.id, id))
    .get();
  return row?.sourceFile ?? null;
}

describe('resolveLearnDir — shared path contract (unit)', () => {
  it('vault + project → project-nested under vault', () => {
    const r = resolveLearnDir({ project: PROJECT, vaultRoot: TMP_VAULT, repoRoot: TMP_REPO_ROOT });
    expect(r.relDir).toBe(`${PROJECT}/ψ/memory/learnings`);
    expect(r.absDir).toBe(path.join(TMP_VAULT, PROJECT, 'ψ/memory/learnings'));
  });

  it('vault + no project → _universal under vault', () => {
    const r = resolveLearnDir({ project: null, vaultRoot: TMP_VAULT, repoRoot: TMP_REPO_ROOT });
    expect(r.relDir).toBe('_universal/ψ/memory/learnings');
  });

  it('project is lowercased (one canonical dir per project)', () => {
    const r = resolveLearnDir({ project: 'github.com/DUMPDUMPY/Repo', vaultRoot: TMP_VAULT, repoRoot: TMP_REPO_ROOT });
    expect(r.relDir).toBe('github.com/dumpdumpy/repo/ψ/memory/learnings');
  });

  it('no vault → flat local-ψ under repoRoot, project ignored for the path', () => {
    const r = resolveLearnDir({ project: PROJECT, vaultRoot: null, repoRoot: TMP_REPO_ROOT });
    expect(r.relDir).toBe('ψ/memory/learnings');
    expect(r.absDir).toBe(path.join(TMP_REPO_ROOT, 'ψ/memory/learnings'));
  });
});

describe('handleLearn (HTTP path) — project-first writes', () => {
  it('write WITH project lands project-nested in the vault, DB sourceFile prefixed', () => {
    const res = handleLearn('project nested write probe', 'test', [], undefined, PROJECT);
    expect(res.success).toBe(true);
    expect(res.file).toMatch(new RegExp(`^${PROJECT}/ψ/memory/learnings/`));
    expect(fs.existsSync(path.join(TMP_VAULT, res.file))).toBe(true);
    expect(dbSourceFile(res.id)).toBe(res.file);
  });

  it('write WITHOUT project lands under _universal (B1 binding — no more vault-root flat writes)', () => {
    const res = handleLearn('universal write probe');
    expect(res.success).toBe(true);
    expect(res.file).toMatch(/^_universal\/ψ\/memory\/learnings\//);
    expect(fs.existsSync(path.join(TMP_VAULT, res.file))).toBe(true);
  });

  it('slug-collision loop operates inside the project dir (-2 suffix, no 500)', () => {
    const prefix = 'collision probe shared first line kept exactly fifty';
    const a = handleLearn(`${prefix}\nbody one`, 'test', [], undefined, PROJECT);
    const b = handleLearn(`${prefix}\nbody two`, 'test', [], undefined, PROJECT);
    expect(a.success).toBe(true);
    expect(b.success).toBe(true);
    expect(b.file).toMatch(new RegExp(`^${PROJECT}/ψ/memory/learnings/.*-2\\.md$`));
    expect(fs.existsSync(path.join(TMP_VAULT, b.file))).toBe(true);
  });
});

describe('backward compat — pre-fix rows still readable', () => {
  it('old flat root sourceFile still resolves by direct join against REPO_ROOT', async () => {
    // Simulate a pre-fix artifact: file at the old flat root location.
    const oldRel = 'ψ/memory/learnings/2026-07-06_prefix-era-file.md';
    fs.mkdirSync(path.join(TMP_REPO_ROOT, 'ψ/memory/learnings'), { recursive: true });
    fs.writeFileSync(path.join(TMP_REPO_ROOT, oldRel), '---\nid: prefix-era\n---\nold row', 'utf-8');

    const { resolveFilePath } = await import('../../tools/read.ts');
    const resolved = await resolveFilePath(oldRel, TMP_REPO_ROOT, path.join(os.homedir(), 'ghq'));
    expect(resolved).toBe(fs.realpathSync(path.join(TMP_REPO_ROOT, oldRel)));
  });
});

describe('anti-divergence tripwire — both write paths consume the shared helper', () => {
  it('server/handlers.ts and tools/learn.ts both call resolveLearnDir', () => {
    const handlers = fs.readFileSync(path.join(import.meta.dir, '../handlers.ts'), 'utf-8');
    const mcpLearn = fs.readFileSync(path.join(import.meta.dir, '../../tools/learn.ts'), 'utf-8');
    expect(handlers).toContain('resolveLearnDir(');
    expect(mcpLearn).toContain('resolveLearnDir(');
  });
});

afterAll(() => {
  for (const d of [TMP_REPO_ROOT, TMP_DATA_DIR, TMP_VAULT]) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch {}
  }
  if (ORIGINAL_REPO_ROOT) process.env.ORACLE_REPO_ROOT = ORIGINAL_REPO_ROOT;
  else delete process.env.ORACLE_REPO_ROOT;
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
});
