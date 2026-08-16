import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Database } from 'bun:sqlite';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-orphan-rescue-'));
const canonicalRoot = path.join(tmp, 'canonical');
fs.mkdirSync(path.join(canonicalRoot, 'ψ', 'memory', 'learnings'), { recursive: true });

const { buildOrphanRescuePlan, renderRescueFile, RescuePlanDenied, RESCUE_SCHEMA_VERSION } = await import('../orphan-rescue-plan.ts');
const { parseLearningFile } = await import('../parser.ts');
const { CANONICAL_SOURCE_ROOT_KEY } = await import('../prune-authority.ts');
const { enrichTextWithAcronyms } = await import('../../search/acronyms.ts');

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface SeedDoc {
  id: string; sourceFile: string; type?: string; project?: string | null;
  concepts?: string[] | string | null; createdAt?: number; updatedAt?: number;
  supersededBy?: string | null; supersededAt?: number | null;
  createdBy?: string | null; fts?: string[] | null;
}

function seedDb(docs: SeedDoc[], opts: { canonical?: string | null } = {}): Database {
  const db = new Database(':memory:');
  db.run(`CREATE TABLE oracle_documents (
    id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL DEFAULT 'default', type TEXT NOT NULL,
    source_file TEXT NOT NULL, concepts TEXT, created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, valid_time INTEGER,
    superseded_by TEXT, superseded_at INTEGER, superseded_reason TEXT, origin TEXT,
    project TEXT, created_by TEXT, usage_count INTEGER NOT NULL DEFAULT 0, last_accessed_at INTEGER
  )`);
  db.run('CREATE TABLE oracle_fts (id TEXT, content TEXT, concepts TEXT)');
  db.run('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER NOT NULL)');
  const canonical = opts.canonical === undefined ? canonicalRoot : opts.canonical;
  if (canonical) {
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 0)').run(CANONICAL_SOURCE_ROOT_KEY, canonical);
  }
  const ins = db.prepare(`INSERT INTO oracle_documents
    (id, type, source_file, concepts, created_at, updated_at, indexed_at, superseded_by, superseded_at, project, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`);
  const ftsIns = db.prepare('INSERT INTO oracle_fts (id, content) VALUES (?, ?)');
  for (const d of docs) {
    const concepts = Array.isArray(d.concepts) ? JSON.stringify(d.concepts) : d.concepts ?? JSON.stringify(['alpha']);
    ins.run(d.id, d.type ?? 'learning', d.sourceFile, concepts, d.createdAt ?? 1000, d.updatedAt ?? 2000,
      d.supersededBy ?? null, d.supersededAt ?? null,
      d.project === undefined ? 'github.com/ttt3p/nntn' : d.project, d.createdBy === undefined ? 'indexer' : d.createdBy);
    const bodies = d.fts === undefined ? [`recovered body for ${d.id}`] : d.fts;
    for (const body of bodies ?? []) ftsIns.run(d.id, body);
  }
  return db;
}

const plan = (db: Database) => buildOrphanRescuePlan({ sqlite: db, repoRoot: canonicalRoot, dbPath: ':memory:' });
const denialOf = (db: Database): string[] => {
  try { plan(db); } catch (e) { if (e instanceof RescuePlanDenied) return e.failures; throw e; }
  throw new Error('expected RescuePlanDenied');
};

describe('recovery envelope parser branch', () => {
  test('ordinary ## learning behavior unchanged without marker', () => {
    const docs = parseLearningFile('x.md', '---\narra_id: base\n---\n\nintro\n\n## Section A\n\nbody a\n\n## Section B\n\nbody b\n');
    expect(docs.length).toBe(2);
    expect(docs[0].id).toBe('base_1');
  });

  test('recovery-marked leading-## body stays one exact opaque doc', () => {
    const body = '## Looks like a section\n\nbut must stay opaque\n\n## Another';
    const rendered = renderRescueFile({
      newId: 'x-rescue', type: 'learning', project: 'github.com/ttt3p/nntn', concepts: ['alpha'],
      createdAt: 1000, updatedAt: 2000, oldId: 'x', oldSourceFile: 'ψ/memory/learnings/x.md', body,
    });
    const docs = parseLearningFile('x.md', rendered, 'dest.md');
    expect(docs.length).toBe(1);
    expect(docs[0].content).toBe(body);
    expect(docs[0].id).toBe('x-rescue');
    expect(docs[0].type).toBe('learning');
  });

  test('retro type survives the learning-path envelope', () => {
    const rendered = renderRescueFile({
      newId: 'r-rescue', type: 'retro', project: 'github.com/ttt3p/nntn', concepts: [],
      createdAt: 1000, updatedAt: 2000, oldId: 'r', oldSourceFile: 'ψ/memory/retrospectives/r.md', body: 'retro body',
    });
    const docs = parseLearningFile('r.md', rendered, 'dest.md');
    expect(docs.length).toBe(1);
    expect(docs[0].type).toBe('retro');
    expect(docs[0].content).toBe('retro body');
  });
});

describe('orphan rescue planner (readonly, deterministic)', () => {
  test('happy path: one active orphan plans with dual hashes and no side effects', () => {
    const db = seedDb([{ id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md', fts: ['CROO body A'] }]);
    const p = plan(db);
    expect(p.schemaVersion).toBe(RESCUE_SCHEMA_VERSION);
    expect(p.count).toBe(1);
    const row = p.rows[0];
    expect(row.newId).toBe('doc-a-rescue');
    expect(row.newSourceFile).toBe(`github.com/ttt3p/nntn/ψ/memory/learnings/orphan-rescue/${p.rescueSetId}/gone-a.md`);
    expect(row.enrichmentChangesContent).toBe(enrichTextWithAcronyms('CROO body A') !== 'CROO body A');
    expect(row.sourceBodySha256).not.toBe('');
    expect(fs.existsSync(path.join(canonicalRoot, 'ψ', 'memory', 'learnings', 'orphan-rescue'))).toBe(false);
  });

  test('deterministic despite row insert order; manifest hash covers destinations without cycle', () => {
    const docs: SeedDoc[] = [
      { id: 'doc-b', sourceFile: 'ψ/memory/learnings/gone-b.md', fts: ['body b'] },
      { id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md', fts: ['body a'] },
    ];
    const p1 = plan(seedDb(docs));
    const p2 = plan(seedDb([...docs].reverse()));
    expect(p1.candidateFingerprint).toBe(p2.candidateFingerprint);
    expect(p1.manifestSha256).toBe(p2.manifestSha256);
    expect(p1.rows.map(r => r.oldId)).toEqual(['doc-a', 'doc-b']);
    // rescueSetId derives from the fingerprint, not the manifest hash
    expect(p1.rescueSetId).toBe(p1.candidateFingerprint.slice(0, 16));
    expect(p1.manifestSha256.startsWith(p1.rescueSetId)).toBe(false);
    for (const r of p1.rows) expect(r.newSourceFile).toContain(`/orphan-rescue/${p1.rescueSetId}/`);
  });

  test('superseded and present-on-disk rows are not candidates', () => {
    fs.writeFileSync(path.join(canonicalRoot, 'ψ', 'memory', 'learnings', 'present.md'), 'x');
    const db = seedDb([
      { id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md' },
      { id: 'doc-sup', sourceFile: 'ψ/memory/learnings/gone-sup.md', supersededBy: 'doc-a', supersededAt: 5 },
      { id: 'doc-present', sourceFile: 'ψ/memory/learnings/present.md' },
      { id: 'doc-learn', sourceFile: 'ψ/memory/learnings/gone-learn.md', createdBy: 'oracle_learn' },
    ]);
    const p = plan(db);
    expect(p.rows.map(r => r.oldId)).toEqual(['doc-a']);
  });

  test.each([
    ['no canonical configured', { canonical: null }, {}, 'no canonical_source_root'],
    ['canonical mismatch', { canonical: path.join(tmp, 'elsewhere') }, {}, 'does not resolve'],
  ] as const)('denies: %s', (_label, seedOpts, _x, needle) => {
    const db = seedDb([{ id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md' }], seedOpts as { canonical?: string | null });
    try {
      plan(db);
      throw new Error('expected denial');
    } catch (e) {
      expect(e instanceof RescuePlanDenied).toBe(true);
      expect((e as InstanceType<typeof RescuePlanDenied>).failures.join('|')).toContain(needle);
    }
  });

  test('denies NULL project, FTS multiplicity 0 and 2, empty body, unsafe source, bad concepts, bad timestamps', () => {
    const failures = denialOf(seedDb([
      { id: 'p-null', sourceFile: 'ψ/memory/learnings/g1.md', project: null },
      { id: 'fts-0', sourceFile: 'ψ/memory/learnings/g2.md', fts: [] },
      { id: 'fts-2', sourceFile: 'ψ/memory/learnings/g3.md', fts: ['a', 'b'] },
      { id: 'fts-empty', sourceFile: 'ψ/memory/learnings/g4.md', fts: ['   '] },
      { id: 'unsafe', sourceFile: '../escape.md' },
      { id: 'concepts-bad', sourceFile: 'ψ/memory/learnings/g5.md', concepts: 'not-json' },
      { id: 'time-bad', sourceFile: 'ψ/memory/learnings/g6.md', createdAt: 0 },
    ]));
    const joined = failures.join('|');
    expect(joined).toContain('p-null: NULL/empty project');
    expect(joined).toContain('fts-0: FTS multiplicity 0');
    expect(joined).toContain('fts-2: FTS multiplicity 2');
    expect(joined).toContain('fts-empty: empty FTS content');
    expect(joined).toContain('unsafe: unsafe source path');
    expect(joined).toContain('concepts-bad: invalid concepts JSON');
    expect(joined).toContain('time-bad: invalid timestamps');
  });

  test('denies duplicate destination and existing destination', () => {
    const dup = denialOf(seedDb([
      { id: 'a1', sourceFile: 'ψ/memory/learnings/same-name.md' },
      { id: 'a2', sourceFile: 'ψ/memory/retrospectives/same-name.md' },
    ]));
    expect(dup.join('|')).toContain('duplicate destination');

    const db = seedDb([{ id: 'a1', sourceFile: 'ψ/memory/learnings/pre-existing.md' }]);
    const first = plan(db);
    const destAbs = path.join(canonicalRoot, first.rows[0].newSourceFile);
    fs.mkdirSync(path.dirname(destAbs), { recursive: true });
    fs.writeFileSync(destAbs, 'occupied');
    try {
      expect(denialOf(db).join('|')).toContain('destination already exists');
    } finally {
      fs.rmSync(path.join(canonicalRoot, 'github.com'), { recursive: true, force: true });
    }
  });

  test('fingerprint is metadata-sensitive: same content, different project => different identity', () => {
    const base: SeedDoc = { id: 'doc-m', sourceFile: 'ψ/memory/learnings/gone-m.md', fts: ['same body'] };
    const p1 = plan(seedDb([{ ...base, project: 'github.com/ttt3p/a' }]));
    const p2 = plan(seedDb([{ ...base, project: 'github.com/ttt3p/b' }]));
    expect(p1.candidateFingerprint).not.toBe(p2.candidateFingerprint);
    expect(p1.rescueSetId).not.toBe(p2.rescueSetId);
    expect(p1.manifestSha256).not.toBe(p2.manifestSha256);
  });

  test('fingerprint is sensitive to concepts and timestamps too', () => {
    const base: SeedDoc = { id: 'doc-m2', sourceFile: 'ψ/memory/learnings/gone-m2.md', fts: ['same body'] };
    const p1 = plan(seedDb([{ ...base, concepts: ['x'] }]));
    const p2 = plan(seedDb([{ ...base, concepts: ['y'] }]));
    const p3 = plan(seedDb([{ ...base, concepts: ['x'], createdAt: 1001 }]));
    expect(p1.candidateFingerprint).not.toBe(p2.candidateFingerprint);
    expect(p1.candidateFingerprint).not.toBe(p3.candidateFingerprint);
  });

  test('denies when the proposed id already exists in oracle_documents', () => {
    const failures = denialOf(seedDb([
      { id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md' },
      { id: 'doc-a-rescue', sourceFile: 'ψ/memory/learnings/present-rescued.md',
        supersededBy: 'x', supersededAt: 1 }, // inactive, but the ID is taken
    ]));
    expect(failures.join('|')).toContain('proposed id doc-a-rescue already exists in oracle_documents');
  });

  test('out-of-range integer timestamp is a controlled denial, not a raw Date error', () => {
    const failures = denialOf(seedDb([
      { id: 'doc-t', sourceFile: 'ψ/memory/learnings/gone-t.md', createdAt: 9_000_000_000_000_000 },
    ]));
    expect(failures.join('|')).toContain('doc-t: invalid timestamps');
  });

  test('denies a real (existing but different) canonical mismatch', () => {
    const other = path.join(tmp, 'other-real-root');
    fs.mkdirSync(other, { recursive: true });
    const db = seedDb([{ id: 'doc-a', sourceFile: 'ψ/memory/learnings/gone-a.md' }], { canonical: other });
    try {
      plan(db);
      throw new Error('expected denial');
    } catch (e) {
      expect(e instanceof RescuePlanDenied).toBe(true);
      expect((e as InstanceType<typeof RescuePlanDenied>).failures.join('|')).toContain('does not match');
    }
  });

  test('output containment resolves symlinks: outside link into canonical is refused', async () => {
    const { assertOutputOutsideCanonical } = await import('../../scripts/plan-orphan-rescue.ts');
    const linkDir = path.join(tmp, 'sneaky-link');
    fs.symlinkSync(canonicalRoot, linkDir);
    try {
      expect(() => assertOutputOutsideCanonical(path.join(linkDir, 'manifest.json'), canonicalRoot))
        .toThrow('outside the canonical knowledge tree');
      expect(() => assertOutputOutsideCanonical(path.join(tmp, 'no-such-dir', 'manifest.json'), canonicalRoot))
        .toThrow('parent directory does not exist');
      const ok = assertOutputOutsideCanonical(path.join(tmp, 'manifest.json'), canonicalRoot);
      expect(ok.endsWith('manifest.json')).toBe(true);
    } finally {
      fs.rmSync(linkDir, { force: true });
    }
  });

  test('leading-## body round-trips exactly through the recovery envelope in a full plan', () => {
    const body = '## Incident\n\nsection-like content survives\n\n## Fix\n\nmore';
    const p = plan(seedDb([{ id: 'sec', sourceFile: 'ψ/memory/learnings/sec.md', fts: [body] }]));
    expect(p.count).toBe(1);
    const rendered = renderRescueFile({
      newId: p.rows[0].newId, type: p.rows[0].type, project: p.rows[0].project, concepts: p.rows[0].concepts,
      createdAt: p.rows[0].createdAt, updatedAt: p.rows[0].updatedAt,
      oldId: p.rows[0].oldId, oldSourceFile: p.rows[0].oldSourceFile, body,
    });
    expect(parseLearningFile('sec.md', rendered, p.rows[0].newSourceFile)[0].content).toBe(body);
  });
});
