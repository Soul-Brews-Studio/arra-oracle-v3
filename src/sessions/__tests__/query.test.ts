/**
 * Session queries, against a fixture corpus shaped like a real jsonl-lens export.
 *
 * The fixture reproduces the property that drives the whole design: `tool` beats dominate by
 * volume and are mostly JSON, so conversation queries must exclude them by default — while
 * remaining reachable, because they carry the exact commands and paths that answer
 * "which session ran X".
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'lens-fixture-'));
const FIXTURE = join(TMP, 'all.db');
const ORIGINAL = process.env.ORACLE_LENS_DB;

beforeAll(async () => {
  const db = new Database(FIXTURE, { create: true });
  db.run(`
    CREATE TABLE sessions (id TEXT, project TEXT, path TEXT, size INTEGER, created TEXT, modified TEXT);
    CREATE TABLE beats (id INTEGER PRIMARY KEY, session_id TEXT, project TEXT, seq INTEGER,
                        ts TEXT, who TEXT, what TEXT, uuid TEXT, parent_uuid TEXT,
                        is_sidechain INTEGER, is_meta INTEGER);
  `);
  db.run(`INSERT INTO sessions VALUES ('s1','org/repo-a','/p/s1.jsonl',10,'2026-08-01T00:00:00Z','2026-08-02T00:00:00Z')`);
  db.run(`INSERT INTO sessions VALUES ('s2','org/repo-b','/p/s2.jsonl',10,'2026-08-03T00:00:00Z','2026-08-04T00:00:00Z')`);
  const beats: Array<[string, string, number, string, string, string]> = [
    ['s1', 'org/repo-a', 1, '2026-08-01T10:00:00Z', 'human', 'why did we choose two database files'],
    ['s1', 'org/repo-a', 2, '2026-08-01T10:01:00Z', 'assistant', 'because the indexer backs up the whole database'],
    ['s1', 'org/repo-a', 3, '2026-08-01T10:02:00Z', 'tool', 'Bash: {"command":"git subtree split --prefix=frontend"}'],
    ['s1', 'org/repo-a', 4, '2026-08-01T10:03:00Z', 'thinking', 'the ratio is what matters here'],
    ['s2', 'org/repo-b', 1, '2026-08-03T09:00:00Z', 'human', 'run the db:push migration'],
    ['s2', 'org/repo-b', 2, '2026-08-03T09:01:00Z', 'tool', 'Bash: {"command":"bun db:push"}'],
    ['s2', 'org/repo-b', 3, '2026-08-03T09:02:00Z', 'system', 'noise that is neither conversation nor tool'],
  ];
  for (const [sid, proj, seq, ts, who, what] of beats) {
    db.query(`INSERT INTO beats (session_id, project, seq, ts, who, what) VALUES (?,?,?,?,?,?)`)
      .run(sid, proj, seq, ts, who, what);
  }
  db.close();
  process.env.ORACLE_LENS_DB = FIXTURE;
  (await import('../lens.ts')).resetLens();
});

afterAll(async () => {
  if (ORIGINAL) process.env.ORACLE_LENS_DB = ORIGINAL;
  else delete process.env.ORACLE_LENS_DB;
  (await import('../lens.ts')).resetLens();
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('conversation excludes tool calls by default', () => {
  test('beatsForSession returns human/assistant/thinking, not tool or system', async () => {
    const { beatsForSession } = await import('../query.ts');
    const { available, beats } = beatsForSession('s1');
    expect(available).toBe(true);
    expect(beats.map((b) => b.who).sort()).toEqual(['assistant', 'human', 'thinking']);
  });

  test('includeTools reaches the command that answers "which session ran X"', async () => {
    const { beatsForSession } = await import('../query.ts');
    const { beats } = beatsForSession('s1', { includeTools: true });
    expect(beats.some((b) => b.who === 'tool' && b.what.includes('subtree split'))).toBe(true);
    // still no `system` — includeTools widens to tools, not to everything
    expect(beats.some((b) => b.who === 'system')).toBe(false);
  });
});

describe('searchBeats', () => {
  test('finds what was said, with session id and timestamp attached', async () => {
    const { searchBeats } = await import('../query.ts');
    const { beats } = searchBeats('two database files');
    expect(beats.length).toBe(1);
    expect(beats[0]!.session_id).toBe('s1');
    expect(beats[0]!.ts).toBe('2026-08-01T10:00:00Z');
  });

  test('a tool-only term is invisible by default and found with includeTools', async () => {
    const { searchBeats } = await import('../query.ts');
    expect(searchBeats('subtree split').beats.length).toBe(0);
    expect(searchBeats('subtree split', { includeTools: true }).beats.length).toBe(1);
  });

  test('underscores are literal, not LIKE wildcards', async () => {
    const { searchBeats } = await import('../query.ts');
    // `db:push` contains no underscore, but `_` must not match any character:
    // searching "db_push" must NOT find "db:push".
    expect(searchBeats('db_push', { includeTools: true }).beats.length).toBe(0);
    expect(searchBeats('db:push', { includeTools: true }).beats.length).toBeGreaterThan(0);
  });

  test('project and time filters narrow the result', async () => {
    const { searchBeats } = await import('../query.ts');
    expect(searchBeats('the', { project: 'org/repo-a' }).beats.every((b) => b.project === 'org/repo-a')).toBe(true);
    expect(searchBeats('migration', { from: '2026-08-02T00:00:00Z' }).beats.length).toBe(1);
    expect(searchBeats('migration', { to: '2026-08-02T00:00:00Z' }).beats.length).toBe(0);
  });
});

describe('listSessions and ranges', () => {
  test('sessions come back newest-first with turn counts', async () => {
    const { listSessions } = await import('../query.ts');
    const { sessions } = listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(sessions[1]!.beats).toBe(4);
  });

  test('beatsInRange spans sessions inside the window', async () => {
    const { beatsInRange } = await import('../query.ts');
    const { beats } = beatsInRange('2026-08-01T00:00:00Z', '2026-08-02T00:00:00Z');
    expect(beats.every((b) => b.session_id === 's1')).toBe(true);
    expect(beats.length).toBe(3);
  });
});
