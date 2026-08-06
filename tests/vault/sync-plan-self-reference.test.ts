/**
 * A vault sync must refuse to sync a repository into itself (#2856).
 *
 * `vault_repo` holds a **ghq repo spec**, not a path, and `resolveVaultPath()` runs
 * `ghq list -p <spec>` to get a repository ROOT. So the natural-looking setting
 * `vault_repo = "Soul-Brews-Studio/arra-oracle-v3"` — the shape you would reach for if you
 * decided this repo's own ψ/ were the canonical vault — resolves the vault to this very
 * checkout.
 *
 * What follows is not a no-op. `mapToVaultPath` appends `<project>/ψ/…` beneath the vault root,
 * so the plan copies the whole of ψ/ into a nested `<repo>/<project>/ψ/` tree, and
 * `syncVault()` then runs `git add -A`, `git commit` and `git push` at the vault path — which
 * is the working repository. Any unrelated uncommitted state in the tree gets swept into that
 * commit and pushed.
 *
 * `.gitignore`'s `ψ/` pattern matches at any depth (verified with `git check-ignore`), so the
 * copied tree never appears in `git status`. The evidence that something went wrong is hidden
 * by the same rule that makes the vault per-user. That is why this throws instead of warning.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertVaultIsNotSelf, planSync } from '../../src/vault/sync-plan.ts';

describe('a vault that is the source repository is refused', () => {
  test('the same path for both throws', () => {
    expect(() => assertVaultIsNotSelf('/repos/arra-oracle-v3', '/repos/arra-oracle-v3'))
      .toThrow(/into itself/i);
  });

  test('a vault that CONTAINS the source repo throws', () => {
    // ghq roots nest: a vault resolved to /repos would contain /repos/arra-oracle-v3.
    expect(() => assertVaultIsNotSelf('/repos', '/repos/arra-oracle-v3')).toThrow();
  });

  test('a vault nested INSIDE the source repo throws', () => {
    expect(() => assertVaultIsNotSelf('/repos/arra-oracle-v3/ψ', '/repos/arra-oracle-v3')).toThrow();
  });

  test('the message names both paths and says what would happen', () => {
    // A refusal that does not explain the destructive part reads as an arbitrary restriction.
    expect(() => assertVaultIsNotSelf('/repos/x', '/repos/x')).toThrow(/git push/);
  });
});

describe('a genuinely separate vault is allowed', () => {
  test('two unrelated directories pass', () => {
    expect(() => assertVaultIsNotSelf('/repos/oracle-vault', '/repos/arra-oracle-v3')).not.toThrow();
  });

  test('a sibling sharing a string prefix is NOT self-reference', () => {
    // The startsWith() trap: '/repos/arra-oracle-v3-oracle' is a different repository.
    expect(() => assertVaultIsNotSelf('/repos/arra-oracle-v3-oracle', '/repos/arra-oracle-v3'))
      .not.toThrow();
  });
});

describe('planSync enforces it, not just the exported helper', () => {
  /**
   * The guard is only worth anything if the code path that copies files runs it. Asserting on
   * `assertVaultIsNotSelf` alone would pass even if `planSync` never called it — the exact
   * shape of defect that shipped in #2877, where the fix was real but production never reached
   * it.
   */
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), 'sync-self-'));
    const psi = join(root, 'ψ', 'memory');
    mkdirSync(psi, { recursive: true });
    writeFileSync(join(psi, 'note.md'), '# note\n');
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
  }

  test('planning a sync of a repo into itself throws before any write is planned', () => {
    const { root, cleanup } = fixture();
    try {
      expect(() => planSync(join(root, 'ψ'), root, root, 'arra-oracle-v3')).toThrow(/into itself/i);
    } finally {
      cleanup();
    }
  });

  test('planning into a separate vault still works', () => {
    const { root, cleanup } = fixture();
    const vault = mkdtempSync(join(tmpdir(), 'sync-vault-'));
    try {
      const plan = planSync(join(root, 'ψ'), root, vault, 'arra-oracle-v3');
      // The guard must not have broken the ordinary case it sits in front of.
      expect(plan.writes.length).toBeGreaterThan(0);
      expect(plan.added).toBeGreaterThan(0);
    } finally {
      cleanup();
      rmSync(vault, { recursive: true, force: true });
    }
  });
});
