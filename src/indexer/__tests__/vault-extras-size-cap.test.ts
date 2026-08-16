/**
 * The byte budget on `collectVaultExtraDocuments` (#2800 salvage).
 *
 * `ψ/outbox/` is append-only by construction — every `/forward`, every fleet report, forever,
 * with no writer that prunes. The collector holds every document it returns in memory, and
 * `src/indexer/index.ts` then chunks all of them and queues a vector job per chunk. Without a
 * cap, one unattended outbox does not degrade the extras collector; it takes the whole index
 * run down with it, including `ψ/memory/` — which is the part nobody can afford to lose.
 *
 * So the contract under test is: **truncate loudly, never explode**. Everything under budget
 * still lands, and what got dropped is stated on the console rather than silently missing.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  VAULT_EXTRA_LIMITS,
  collectVaultExtraDocuments,
  type VaultExtraLimits,
} from '../collect-vault-extras.ts';
import type { IndexerConfig } from '../../types.ts';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) fs.rmSync(roots.pop()!, { recursive: true, force: true });
});

/** Bodies are unique per index so content-hash dedupe never masks a budget decision. */
function vault(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-extras-cap-'));
  roots.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.join(full, '..'), { recursive: true });
    fs.writeFileSync(full, body);
  }
  const config = {
    repoRoot: root,
    dbPath: ':memory:',
    chromaPath: '',
    sourcePaths: {
      resonance: 'ψ/memory/resonance',
      learnings: 'ψ/memory/learnings',
      retrospectives: 'ψ/memory/retrospectives',
      distillations: 'ψ/memory/distillations',
      learn: 'ψ/learn',
    },
  } as IndexerConfig;
  return (limits?: Partial<VaultExtraLimits>) =>
    collectVaultExtraDocuments({ config, seenContentHashes: new Set(), limits });
}

function note(marker: string, bytes: number): string {
  const head = `# note ${marker}\n\n`;
  return head + 'x'.repeat(Math.max(0, bytes - head.length)) + '\n';
}

describe('the shipped defaults are a real bound', () => {
  test('per-file and per-run caps are both set, and the run cap is the larger', () => {
    expect(VAULT_EXTRA_LIMITS.maxFileBytes).toBeGreaterThan(0);
    expect(VAULT_EXTRA_LIMITS.maxTotalBytes).toBeGreaterThan(VAULT_EXTRA_LIMITS.maxFileBytes);
  });
});

describe('one oversized file cannot become one enormous document', () => {
  test('a file over maxFileBytes is skipped', () => {
    const collect = vault({ 'ψ/outbox/huge.md': note('huge', 4096) });
    expect(collect({ maxFileBytes: 1024 })).toEqual([]);
  });

  test('its normal-sized siblings are still collected', () => {
    const collect = vault({
      'ψ/outbox/huge.md': note('huge', 4096),
      'ψ/outbox/small.md': note('small', 200),
      'ψ/crew/omar/CLAUDE.md': note('omar', 200),
    });
    const kept = collect({ maxFileBytes: 1024 }).map((doc) => doc.source_file).sort();
    expect(kept).toEqual(['ψ/crew/omar/CLAUDE.md', 'ψ/outbox/small.md']);
  });
});

describe('an unbounded tree degrades into a partial index, not an OOM', () => {
  const many = Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `ψ/outbox/${String(i).padStart(2, '0')}.md`,
      note(`n${i}`, 1000),
    ]),
  );

  test('collection stops adding files once the run budget is spent', () => {
    const collect = vault(many);
    const docs = collect({ maxFileBytes: 4096, maxTotalBytes: 3500 });
    expect(docs.length).toBeGreaterThan(0);
    expect(docs.length).toBeLessThan(12);
  });

  test('the whole tree lands when the budget is not the constraint', () => {
    const collect = vault(many);
    expect(collect({ maxFileBytes: 4096, maxTotalBytes: 1024 * 1024 })).toHaveLength(12);
  });

  test('the kept prefix is stable across runs rather than readdir-ordered', () => {
    const collect = vault(many);
    const limits = { maxFileBytes: 4096, maxTotalBytes: 3500 };
    const first = collect(limits).map((doc) => doc.source_file);
    expect(collect(limits).map((doc) => doc.source_file)).toEqual(first);
    // A genuine prefix of the sorted names — not "whatever readdir happened to yield".
    const expected = Object.keys(many).sort().slice(0, first.length);
    expect(first).toEqual(expected);
    expect(first.length).toBeLessThan(12);
  });

  test('a budget too small for even one file yields nothing instead of throwing', () => {
    const collect = vault(many);
    expect(collect({ maxFileBytes: 4096, maxTotalBytes: 10 })).toEqual([]);
  });
});

describe('truncation is announced, not silent', () => {
  test('skipped files produce a console warning naming both limits', () => {
    const collect = vault({ 'ψ/outbox/huge.md': note('huge', 4096) });
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      collect({ maxFileBytes: 1024 });
    } finally {
      console.warn = original;
    }
    expect(warnings.join('\n')).toContain('Vault-extras byte budget hit');
  });

  test('a run that skipped nothing stays quiet', () => {
    const collect = vault({ 'ψ/outbox/small.md': note('small', 200) });
    const original = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => { warnings.push(args.join(' ')); };
    try {
      collect({ maxFileBytes: 4096 });
    } finally {
      console.warn = original;
    }
    expect(warnings).toEqual([]);
  });
});
