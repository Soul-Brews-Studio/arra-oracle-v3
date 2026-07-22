import { afterAll, describe, expect, mock, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-store-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
const vaultRoot = join(root, 'vault');
mkdirSync(root, { recursive: true });
mkdirSync(vaultRoot, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
mock.module('../../vault/discovery.ts', () => ({ getVaultPsiRoot: () => ({ path: vaultRoot }) }));
const { createTrace, getTrace, listTraces } = await import('../handler.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const corrupt = `trace-corrupt-${stamp}`;
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values({
  traceId: corrupt,
  query: 'corrupted json arrays stay readable',
  foundFiles: '{not-json',
  foundCommits: JSON.stringify({ nope: true }),
  childTraceIds: '{not-json',
  createdAt: now,
  updatedAt: now,
}).run();

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterAll(() => {
  dbMod.closeDb();
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
  rmSync(root, { recursive: true, force: true });
});

describe('trace storage edge hardening', () => {
  test('malformed JSON array columns parse as empty arrays', () => {
    const trace = getTrace(corrupt);

    expect(trace?.foundFiles).toEqual([]);
    expect(trace?.foundCommits).toEqual([]);
    expect(trace?.childTraceIds).toEqual([]);
  });

  test('missing parent ids do not create orphan parent links', () => {
    const result = createTrace({ query: `orphan parent ${stamp}`, parentTraceId: 'missing-parent' });
    const trace = getTrace(result.traceId);

    expect(result.depth).toBe(0);
    expect(trace?.parentTraceId).toBeNull();
  });

  test('runtime non-array dig point fields do not inflate persisted counts', () => {
    const result = createTrace({
      query: `non array dig points ${stamp}`,
      foundFiles: 'src/trace/store.ts' as any,
      foundCommits: { length: 2 } as any,
      foundIssues: 'issue-1' as any,
      foundRetrospectives: 'retro.md' as any,
      foundResonance: 'resonance.md' as any,
    });
    const trace = getTrace(result.traceId);

    expect(result.summary).toEqual({ fileCount: 0, commitCount: 0, issueCount: 0, totalDigPoints: 0 });
    expect(trace?.foundFiles).toEqual([]);
    expect(trace?.foundCommits).toEqual([]);
    expect(trace?.foundIssues).toEqual([]);
  });

  test('list pagination clamps unsafe values for direct handler callers', () => {
    const result = listTraces({ query: `orphan parent ${stamp}`, limit: -10, offset: Number.NaN });

    expect(result.traces).toHaveLength(1);
    expect(result.hasMore).toBe(false);
  });

  test('explicit empty and malformed project stop before learning file and trace row', () => {
    for (const project of ['', 'owner/repo', 'github.com/acme/widgets.git']) {
      const beforeRows = dbMod.sqlite.query('SELECT count(*) AS n FROM trace_log').get() as { n: number };
      const beforeFiles = Array.from(new Bun.Glob('**/*.md').scanSync(vaultRoot));
      expect(() => createTrace({ query: `invalid authority ${project}`, project, foundLearnings: ['must not write'] }))
        .toThrow('Invalid project authority');
      const afterRows = dbMod.sqlite.query('SELECT count(*) AS n FROM trace_log').get() as { n: number };
      expect(afterRows.n).toBe(beforeRows.n);
      expect(Array.from(new Bun.Glob('**/*.md').scanSync(vaultRoot))).toEqual(beforeFiles);
    }
  });

  test('omitted project writes universal and mixed-case project stores canonical authority', () => {
    const universal = createTrace({ query: 'omitted authority', foundLearnings: ['universal trace learning'] });
    const universalTrace = getTrace(universal.traceId);
    expect(universalTrace?.project).toBeNull();
    expect(universalTrace?.foundLearnings[0]).toStartWith('_universal/ψ/memory/learnings/');

    const canonical = createTrace({
      query: 'canonical authority', project: 'GitHub.com/Acme/Widgets', foundLearnings: ['project trace learning'],
    });
    const canonicalTrace = getTrace(canonical.traceId);
    expect(canonicalTrace?.project).toBe('github.com/acme/widgets');
    expect(canonicalTrace?.foundLearnings[0]).toStartWith('github.com/acme/widgets/ψ/memory/learnings/');
  });
});
