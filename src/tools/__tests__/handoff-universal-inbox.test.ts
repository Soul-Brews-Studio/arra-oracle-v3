/**
 * Handoff = UNIVERSAL single inbox — regression suite for the handoff sibling
 * of the two-root learn drift (design bound 2026-07-07, oracle Option B).
 *
 * Consumed reality: EVERY reader (oracle_inbox MCP, GET /api/inbox,
 * knowledge/inbox listHandoffFiles, maw-plugin via HTTP, ctl verify) reads the
 * single ROOT ψ/inbox/handoff. Project-nesting was declared in
 * PROJECT_CATEGORIES but never consumed by any reader — mail written
 * project-nested is DARK. The embedded MCP writer (tools/handoff.ts) was the
 * only project-nested writer, and embedded mode is the lazy fallback when the
 * HTTP server is down — i.e. handoffs written during an outage went exactly
 * where nobody looks, precisely when they matter most.
 *
 * Contract:
 *   - vault configured   → write vaultRoot/ψ/inbox/handoff (ROOT, no project dir)
 *   - vault unavailable  → write ctx.repoRoot/ψ/inbox/handoff as LAST resort,
 *     with a loud console.error naming the orphan path (outage mail must at
 *     least be findable in logs)
 *   - mapToVaultPath treats ψ/inbox/handoff/ as UNIVERSAL (identity mapping)
 *   - migrate.ts carries NO duplicate category list (divergence-by-copy seed)
 */

import { describe, it, expect, afterAll, mock } from 'bun:test';
import path from 'path';
import os from 'os';
import fs from 'fs';

const TMP_REPO_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-handoff-repo-'));
const TMP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-handoff-data-'));
const TMP_VAULT = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-handoff-vault-'));

const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;
process.env.ORACLE_REPO_ROOT = TMP_REPO_ROOT;
process.env.ORACLE_DATA_DIR = TMP_DATA_DIR;

// Controllable vault resolution — flipped per-test.
let vaultAvailable = true;
mock.module('../../vault/handler.ts', () => ({
  getVaultPsiRoot: () =>
    vaultAvailable ? { path: TMP_VAULT } : { needsInit: true, hint: 'no vault (test)' },
}));

const { handleHandoff } = await import('../handoff.ts');
const { mapToVaultPath, isProjectCategory } = await import('../../vault/path-mapping.ts');

const ctx = { repoRoot: TMP_REPO_ROOT } as unknown as import('../types.ts').ToolContext;

function parseResponse(res: { content: Array<{ text: string }> }): { success: boolean; file: string } {
  return JSON.parse(res.content[0].text);
}

describe('oracle_handoff (embedded) — universal ROOT inbox', () => {
  it('vault configured → writes vaultRoot/ψ/inbox/handoff with NO project prefix', async () => {
    vaultAvailable = true;
    const res = await handleHandoff(ctx, { content: 'universal inbox probe', slug: 'universal-probe' });
    const body = parseResponse(res);
    expect(body.success).toBe(true);
    expect(body.file).toMatch(/^ψ\/inbox\/handoff\//);
    expect(body.file).not.toMatch(/^(github\.com|_universal)\//);
    expect(fs.existsSync(path.join(TMP_VAULT, body.file))).toBe(true);
  });

  it('vault unavailable → last-resort repoRoot write + LOUD orphan warning in logs', async () => {
    vaultAvailable = false;
    const errors: string[] = [];
    const origError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
      const res = await handleHandoff(ctx, { content: 'outage mail probe', slug: 'outage-probe' });
      const body = parseResponse(res);
      expect(body.success).toBe(true);
      expect(fs.existsSync(path.join(TMP_REPO_ROOT, body.file))).toBe(true);
      // Outage mail must be findable from logs: a loud line naming the orphan path.
      const loud = errors.filter((line) => line.includes('ORPHAN') && line.includes('handoff'));
      expect(loud.length).toBeGreaterThan(0);
      expect(loud.join(' ')).toContain(TMP_REPO_ROOT);
    } finally {
      console.error = origError;
      vaultAvailable = true;
    }
  });
});

describe('path-mapping — handoff is a UNIVERSAL category', () => {
  it('mapToVaultPath leaves ψ/inbox/handoff paths unprefixed (identity)', () => {
    expect(mapToVaultPath('ψ/inbox/handoff/2026-07-07_10-00_context.md', 'github.com/owner/repo'))
      .toBe('ψ/inbox/handoff/2026-07-07_10-00_context.md');
  });

  it('isProjectCategory(ψ/inbox/handoff/…) is false', () => {
    expect(isProjectCategory('ψ/inbox/handoff/x.md')).toBe(false);
  });

  it('learnings/retrospectives stay project-nested (unchanged)', () => {
    expect(isProjectCategory('ψ/memory/learnings/x.md')).toBe(true);
    expect(mapToVaultPath('ψ/memory/learnings/x.md', 'github.com/owner/repo'))
      .toBe('github.com/owner/repo/ψ/memory/learnings/x.md');
  });
});

describe('anti-divergence tripwire — one category list only', () => {
  it('migrate.ts declares no local PROJECT_CATEGORIES copy (imports the shared one)', () => {
    const src = fs.readFileSync(path.join(import.meta.dir, '../../vault/migrate.ts'), 'utf-8');
    expect(src).not.toMatch(/const PROJECT_CATEGORIES\s*=/);
    expect(src).toContain('isProjectCategory');
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
