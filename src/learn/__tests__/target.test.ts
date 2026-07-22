import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const roots: string[] = [];
function root() { const dir = join(tmpdir(), `arra-target-${Date.now()}-${Math.random()}`); roots.push(dir); mkdirSync(dir); return dir; }
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('learn target and identity seams', () => {
  test('resolves project-first, universal, and no-vault targets', async () => {
    const { resolveVaultLearnTarget } = await import('../target.ts');
    const vault = root();
    const fallback = root();
    expect(resolveVaultLearnTarget('github.com/acme/widgets', vault, 'ψ/memory/learnings', fallback)).toEqual({
      absDir: join(vault, 'github.com/acme/widgets/ψ/memory/learnings'),
      sourceFileRel: 'github.com/acme/widgets/ψ/memory/learnings',
      vaultRoot: vault, fallbackRoot: fallback, subdir: 'ψ/memory/learnings',
    });
    expect(resolveVaultLearnTarget(null, vault, 'ψ/memory/learnings', fallback).sourceFileRel)
      .toBe('_universal/ψ/memory/learnings');
    expect(resolveVaultLearnTarget(null, null, 'ψ/memory/learnings', fallback)).toEqual({
      absDir: join(fallback, 'ψ/memory/learnings'), sourceFileRel: 'ψ/memory/learnings',
      vaultRoot: null, fallbackRoot: fallback, subdir: 'ψ/memory/learnings',
    });
  });

  test('exclusive reservation retries EEXIST and global id collisions', async () => {
    const { reserveGeneratedLearning, resolveVaultLearnTarget } = await import('../target.ts');
    const target = resolveVaultLearnTarget('github.com/acme/widgets', root(), 'ψ/memory/learnings', root());
    mkdirSync(target.absDir, { recursive: true });
    await Bun.write(join(target.absDir, '2026-07-22_same.md'), 'occupied');
    const reserved = reserveGeneratedLearning({
      dateStr: '2026-07-22', slug: 'same', target,
      idExists: (id) => id.endsWith('-2'),
      content: (identity) => `id: ${identity.id}`,
    });
    expect(reserved.id).toBe('learning_2026-07-22_same-3');
    expect(reserved.sourceFile).toEndWith('/2026-07-22_same-3.md');
  });

  test('rejects symlinked target parents', async () => {
    const { reserveGeneratedLearning, resolveVaultLearnTarget } = await import('../target.ts');
    const vault = root();
    const outside = root();
    mkdirSync(join(vault, 'github.com/acme/widgets/ψ/memory'), { recursive: true });
    symlinkSync(outside, join(vault, 'github.com/acme/widgets/ψ/memory/learnings'));
    expect(() => reserveGeneratedLearning({
      dateStr: '2026-07-22', slug: 'blocked',
      target: resolveVaultLearnTarget('github.com/acme/widgets', vault, 'ψ/memory/learnings', root()),
      idExists: () => false, content: () => 'blocked',
    })).toThrow(/symlink/i);
  });

  test('target resolution rejects non-canonical and traversal projects before mkdir', async () => {
    const { resolveVaultLearnTarget } = await import('../target.ts');
    const vault = root();
    const outside = join(vault, '..', 'escaped-target');
    for (const project of ['../escaped-target', 'github.com/acme/widget space', 'github.com/acme/widgets.git']) {
      expect(() => resolveVaultLearnTarget(project, vault, 'ψ/memory/learnings', root())).toThrow(/project/i);
    }
    expect(existsSync(outside)).toBe(false);
  });

  test('generated allocation suffixes around project and flat orphan files', async () => {
    const { reserveGeneratedLearning, resolveVaultLearnTarget } = await import('../target.ts');
    const vault = root();
    const fallback = root();
    const target = resolveVaultLearnTarget('github.com/acme/project-b', vault, 'ψ/memory/learnings', fallback);
    const otherDir = join(vault, 'github.com/acme/project-a/ψ/memory/learnings');
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, '2026-07-22_orphan.md'), 'other-project orphan');
    mkdirSync(join(fallback, 'ψ/memory/learnings'), { recursive: true });
    writeFileSync(join(fallback, 'ψ/memory/learnings/2026-07-22_orphan-2.md'), 'flat orphan');
    const reserved = reserveGeneratedLearning({
      dateStr: '2026-07-22', slug: 'orphan', target, idExists: () => false,
      content: ({ id }) => id,
    });
    expect(reserved.id).toBe('learning_2026-07-22_orphan-3');
  });

  test('explicit allocation rejects project and flat orphan files', async () => {
    const { reserveExplicitLearning, resolveVaultLearnTarget } = await import('../target.ts');
    for (const location of ['project', 'flat']) {
      const vault = root();
      const fallback = root();
      const target = resolveVaultLearnTarget('github.com/acme/project-b', vault, 'ψ/memory/learnings', fallback);
      const orphanDir = location === 'project'
        ? join(vault, 'github.com/acme/project-a/ψ/memory/learnings')
        : join(fallback, 'ψ/memory/learnings');
      mkdirSync(orphanDir, { recursive: true });
      writeFileSync(join(orphanDir, 'learning_explicit_orphan.md'), 'orphan');
      const reserved = reserveExplicitLearning({
        id: 'learning_explicit_orphan', sourceFile: 'ψ/memory/learnings/learning_explicit_orphan.md',
        target, idExists: () => false, content: ({ id }) => id,
      });
      expect(reserved).toBeNull();
    }
  });
});
