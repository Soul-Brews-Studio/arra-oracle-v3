/**
 * `ψ/inbox/` must actually be indexed (#2855).
 *
 * Nat's call: *"inbox เป็น knowledge ได้ index ได้เลย."* Before this, no collector reached it —
 * `collectDocuments` builds its root as `ψ/memory/${subdir}`, and the registered subdirs are
 * resonance/learnings/retrospectives/distillations, plus `ψ/learn` and the security corpus.
 * The ~235 inbox rows in the live corpus are fossils from a single 2026-06-07 batch with no
 * live writer since.
 *
 * The last test in this file is the one that matters most. A collector that exists but is never
 * called is exactly the defect shape of #2877: the fix was real, the test was green, and
 * production never reached the code.
 */
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectPsiInbox } from '../../src/indexer/collect-inbox.ts';
import { isPsiInboxSource } from '../../src/indexer/inbox-doc-source.ts';
import type { IndexerConfig } from '../../src/types.ts';

function fixture(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), 'psi-inbox-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
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
  const collect = () => collectPsiInbox({ config, seenContentHashes: new Set() });
  return { root, collect, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

const REPORT = `---
from: arra-oracle-v3
to: jan
timestamp: 2026-07-26 05:56 +07
---

# Overnight report

The indexer queued zero vector jobs because a drizzle raw-sql row is a positional array.
`;

describe('inbox markdown becomes indexed documents', () => {
  test('a report in ψ/inbox/ is collected', () => {
    const f = fixture({ 'ψ/inbox/2026-07-26_report.md': REPORT });
    try {
      const docs = f.collect();
      expect(docs.length).toBeGreaterThan(0);
      expect(docs[0]?.source_file).toBe('ψ/inbox/2026-07-26_report.md');
    } finally {
      f.cleanup();
    }
  });

  test('nested inbox subdirectories are walked, not just the top level', () => {
    // ψ/inbox/handoff/ is where every /forward writes. It was unindexed too.
    const f = fixture({ 'ψ/inbox/handoff/2026-07-26_05-55_overnight.md': REPORT });
    try {
      expect(f.collect().length).toBeGreaterThan(0);
    } finally {
      f.cleanup();
    }
  });

  test('an empty file produces nothing rather than an empty document', () => {
    const f = fixture({ 'ψ/inbox/blank.md': '   \n' });
    try {
      expect(f.collect()).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  test('identical content in two places is stored once', () => {
    // The same report is delivered to several oracles and copied between trees.
    const f = fixture({ 'ψ/inbox/a.md': REPORT, 'ψ/inbox/handoff/a.md': REPORT });
    try {
      expect(f.collect()).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });

  test('same basename in different directories does not collide on id', () => {
    /**
     * Inbox filenames repeat heavily across senders and dates. If the id came from the
     * basename, the second document would overwrite the first and the corpus would silently
     * hold one row where two belong.
     */
    const f = fixture({
      'ψ/inbox/report.md': `${REPORT}\nfirst copy\n`,
      'ψ/inbox/handoff/report.md': `${REPORT}\nsecond copy, different content\n`,
    });
    try {
      const ids = f.collect().map((d) => d.id);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      f.cleanup();
    }
  });
});

describe('the source predicate only claims inbox paths', () => {
  test('an inbox path matches', () => {
    expect(isPsiInboxSource('ψ/inbox/report.md')).toBe(true);
  });

  test('a project-first vault path matches too', () => {
    expect(isPsiInboxSource('github.com/owner/repo/ψ/inbox/report.md')).toBe(true);
  });

  test('a learnings path does not', () => {
    expect(isPsiInboxSource('ψ/memory/learnings/x.md')).toBe(false);
  });

  test('a directory merely starting with "inbox" does not', () => {
    expect(isPsiInboxSource('ψ/inbox-archive/x.md')).toBe(false);
  });
});

describe('the collector is actually registered', () => {
  test('src/indexer/index.ts calls collectPsiInbox', async () => {
    /**
     * The alternative is booting the whole indexer against a real corpus. The distinction is
     * one call site, and this is the call site — the thing that was missing for every inbox
     * file in the vault.
     */
    const source = await Bun.file(new URL('../../src/indexer/index.ts', import.meta.url)).text();
    expect(source).toContain('collectPsiInbox(shared)');
  });
});
