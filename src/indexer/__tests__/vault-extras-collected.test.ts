/**
 * #2800 (@Anurak112), second half — the vault trees no collector reached.
 *
 * Sibling of `crew-psi-discovery.test.ts`, which pins the `memory/` half that landed in
 * #2854. This file pins the rest: `ψ/outbox`, a crew member's non-memory subtrees, and the
 * `CLAUDE.md` that says who that member is.
 *
 * The two things worth more than "does it find the file":
 *  - `ORACLE_INDEX_CREW` gates the crew half and **only** the crew half. `ψ/outbox` is not a
 *    crew tree; a lever that switches off more than its name says is the #2822 / #2846
 *    defect wearing a different hat.
 *  - ids are namespaced by path hash. `CLAUDE.md` exists under every member, so a
 *    basename-derived id would silently keep one identity file and drop the rest.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { collectVaultExtraDocuments } from '../collect-vault-extras.ts';
import type { IndexerConfig, OracleDocument } from '../../types.ts';

const NOTE = '# Handoff\n\nThe queue drained before the embedder came back.\n';

function fixture(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-extras-'));
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
  const collect = (seen = new Set<string>()): OracleDocument[] =>
    collectVaultExtraDocuments({ config, seenContentHashes: seen });
  return { root, collect, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

function sources(docs: OracleDocument[]): string[] {
  return [...new Set(docs.map((doc) => doc.source_file))].sort();
}

const previous = process.env.ORACLE_INDEX_CREW;
afterEach(() => {
  if (previous === undefined) delete process.env.ORACLE_INDEX_CREW;
  else process.env.ORACLE_INDEX_CREW = previous;
});

describe('the outgoing half of fleet correspondence is indexed', () => {
  test('a note in ψ/outbox/ is collected', () => {
    const f = fixture({ 'ψ/outbox/2026-08-16_report.md': NOTE });
    try {
      expect(sources(f.collect())).toEqual(['ψ/outbox/2026-08-16_report.md']);
    } finally {
      f.cleanup();
    }
  });

  test('nested outbox subdirectories are walked, not just the top level', () => {
    const f = fixture({ 'ψ/outbox/handoff/2026-08-16_05-55.md': NOTE });
    try {
      expect(f.collect().length).toBeGreaterThan(0);
    } finally {
      f.cleanup();
    }
  });

  test('an empty file produces nothing rather than an empty document', () => {
    const f = fixture({ 'ψ/outbox/blank.md': '   \n' });
    try {
      expect(f.collect()).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  test('a vault with none of these trees is not an error', () => {
    const f = fixture({ 'ψ/memory/learnings/only-this.md': NOTE });
    try {
      expect(f.collect()).toEqual([]);
    } finally {
      f.cleanup();
    }
  });
});

describe('a crew member is indexed beyond their memory/ brain', () => {
  test("the member's CLAUDE.md identity file is collected", () => {
    const f = fixture({ 'ψ/crew/omar/CLAUDE.md': '# omar\n\nOwns the vector queue.\n' });
    try {
      expect(sources(f.collect())).toEqual(['ψ/crew/omar/CLAUDE.md']);
    } finally {
      f.cleanup();
    }
  });

  test('subtrees beyond the three the PR listed are walked too', () => {
    // learn/inbox/outbox were the enumerated three; an allow-list would drop writing/.
    const f = fixture({
      'ψ/crew/omar/learn/repo.md': `${NOTE}learn\n`,
      'ψ/crew/omar/inbox/from-jeera.md': `${NOTE}inbox\n`,
      'ψ/crew/omar/outbox/to-jeera.md': `${NOTE}outbox\n`,
      'ψ/crew/omar/writing/essay.md': `${NOTE}writing\n`,
    });
    try {
      expect(sources(f.collect())).toEqual([
        'ψ/crew/omar/inbox/from-jeera.md',
        'ψ/crew/omar/learn/repo.md',
        'ψ/crew/omar/outbox/to-jeera.md',
        'ψ/crew/omar/writing/essay.md',
      ]);
    } finally {
      f.cleanup();
    }
  });

  test('memory/ is left to collectDocuments rather than collected twice', () => {
    const f = fixture({ 'ψ/crew/omar/memory/learnings/a.md': NOTE });
    try {
      expect(f.collect()).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  test('the crew roster README is collected', () => {
    const f = fixture({ 'ψ/crew/README.md': '# crew\n\nomar, jeera.\n' });
    try {
      expect(sources(f.collect())).toEqual(['ψ/crew/README.md']);
    } finally {
      f.cleanup();
    }
  });

  test('a crew document is attributed to crew/<member>', () => {
    const f = fixture({ 'ψ/crew/omar/outbox/to-jeera.md': NOTE });
    try {
      expect(f.collect()[0]?.project).toBe('crew/omar');
    } finally {
      f.cleanup();
    }
  });

  test('same basename under two members does not collide on id', () => {
    const f = fixture({
      'ψ/crew/omar/CLAUDE.md': '# omar\n\nOwns the vector queue.\n',
      'ψ/crew/jeera/CLAUDE.md': '# jeera\n\nOwns the retro cadence.\n',
    });
    try {
      const ids = f.collect().map((doc) => doc.id);
      expect(ids).toHaveLength(2);
      expect(new Set(ids).size).toBe(2);
    } finally {
      f.cleanup();
    }
  });
});

describe('ORACLE_INDEX_CREW gates the crew half and nothing else', () => {
  const tree = {
    'ψ/crew/omar/CLAUDE.md': '# omar\n\nOwns the vector queue.\n',
    'ψ/outbox/report.md': NOTE,
  };

  test('both halves are collected by default', () => {
    delete process.env.ORACLE_INDEX_CREW;
    const f = fixture(tree);
    try {
      expect(sources(f.collect())).toEqual(['ψ/crew/omar/CLAUDE.md', 'ψ/outbox/report.md']);
    } finally {
      f.cleanup();
    }
  });

  for (const value of ['0', 'false', 'off', 'no', 'FALSE', ' Off ']) {
    test(`ORACLE_INDEX_CREW=${JSON.stringify(value)} drops crew but keeps ψ/outbox`, () => {
      // The raw `=== '0'` this replaced would have indexed crew for five of these six.
      process.env.ORACLE_INDEX_CREW = value;
      const f = fixture(tree);
      try {
        expect(sources(f.collect())).toEqual(['ψ/outbox/report.md']);
      } finally {
        f.cleanup();
      }
    });
  }

  test('ORACLE_INDEX_CREW=1 leaves both enabled', () => {
    process.env.ORACLE_INDEX_CREW = '1';
    const f = fixture(tree);
    try {
      expect(sources(f.collect())).toHaveLength(2);
    } finally {
      f.cleanup();
    }
  });
});

describe('deduplication and registration', () => {
  test('identical content in two places is stored once', () => {
    const f = fixture({ 'ψ/outbox/a.md': NOTE, 'ψ/crew/omar/outbox/a.md': NOTE });
    try {
      expect(f.collect()).toHaveLength(1);
    } finally {
      f.cleanup();
    }
  });

  test('content an earlier collector already claimed is skipped', () => {
    const f = fixture({ 'ψ/outbox/a.md': NOTE });
    try {
      expect(f.collect(new Set([Bun.hash(NOTE).toString(36)]))).toEqual([]);
    } finally {
      f.cleanup();
    }
  });

  test('src/indexer/index.ts actually calls the collector', async () => {
    // #2800 shipped none of this; a collector nothing calls is the #2877 shape.
    const source = await Bun.file(new URL('../index.ts', import.meta.url)).text();
    expect(source).toContain('collectVaultExtraDocuments(shared)');
  });
});
