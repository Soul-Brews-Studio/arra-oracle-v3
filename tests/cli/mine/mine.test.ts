import { afterEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseMineArgs } from '../../../src/cli/mine.ts';
import { createDatabase } from '../../../src/db/index.ts';
import { oracleDocuments } from '../../../src/db/schema.ts';
import { mineFolder, stableMineDocId, watchMineFolder } from '../../../src/indexer/mine.ts';

let tempDir = '';

afterEach(() => {
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true });
  tempDir = '';
});

function tmp(): string {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-mine-'));
  return tempDir;
}

function rowsFor(dbPath: string, sourceFile: string): Array<Record<string, unknown>> {
  const { sqlite, storage } = createDatabase(dbPath);
  const rows = sqlite.prepare(`
    SELECT d.id, d.source_file AS sourceFile, d.project, d.concepts, f.content
    FROM oracle_documents d
    JOIN oracle_fts f ON f.id = d.id
    WHERE d.source_file = ?
    ORDER BY d.id
  `).all(sourceFile) as Array<Record<string, unknown>>;
  storage.close();
  return rows;
}

describe('arra mine folder ingest', () => {
  test('parses friendly command flags and rejects bad input', () => {
    expect(parseMineArgs(['notes', '--db-path', '/tmp/oracle.db'])).toEqual({
      dir: 'notes', dbPath: '/tmp/oracle.db', dryRun: false, watch: false, help: false,
    });
    expect(parseMineArgs(['--dry-run', '--watch', '--db-path=/tmp/oracle.db', 'notes']).dryRun).toBe(true);
    expect(parseMineArgs(['-w', 'notes']).watch).toBe(true);
    expect(() => parseMineArgs(['notes', '--bad'])).toThrow('unknown mine option: --bad');
    expect(() => parseMineArgs(['--db-path'])).toThrow('--db-path requires a path');
  });

  test('stores deterministic docs and skips unchanged reruns', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(path.join(notes, 'ops'), { recursive: true });
    const notePath = path.join(notes, 'ops', 'deploy.md');
    fs.writeFileSync(notePath, '# Deploy\n\nRollback checklist and deployment notes.');

    const first = await mineFolder({ dir: notes, dbPath });
    const second = await mineFolder({ dir: notes, dbPath });

    expect(first).toMatchObject({ scanned: 1, stored: 1, skipped: 0, project: 'notes' });
    expect(second).toMatchObject({ scanned: 1, stored: 0, skipped: 1, project: 'notes' });

    const id = stableMineDocId(notes, notePath);
    const { db, storage } = createDatabase(dbPath);
    const row = db.select().from(oracleDocuments).where(eq(oracleDocuments.id, id)).get();
    storage.close();

    expect(row?.sourceFile).toBe('mine/notes/ops/deploy.md');
    expect(row?.project).toBe('notes');
    expect(row?.createdBy).toBe('mine');
    expect(JSON.parse(row?.concepts ?? '[]')).toEqual(expect.arrayContaining(['notes', 'ops', 'deploy']));
  });

  test('stores long notes as deterministic paragraph chunks', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(path.join(notes, 'ops'), { recursive: true });
    const notePath = path.join(notes, 'ops', 'long.md');
    const para = (label: string, char: string) => `${label} ${char.repeat(330)}`;
    fs.writeFileSync(notePath, [para('alpha', 'a'), '', para('beta', 'b'), '', para('gamma', 'c')].join('\n'));

    const first = await mineFolder({ dir: notes, dbPath });
    const second = await mineFolder({ dir: notes, dbPath });

    expect(first).toMatchObject({ scanned: 1, stored: 2, skipped: 0 });
    expect(second).toMatchObject({ scanned: 1, stored: 0, skipped: 1 });

    const id = stableMineDocId(notes, notePath);
    const rows = rowsFor(dbPath, 'mine/notes/ops/long.md');
    expect(rows.map((row) => row.id)).toEqual([`${id}__chunk_0`, `${id}__chunk_1`]);
    expect(rows.every((row) => String(row.content).length <= 800)).toBe(true);
  });

  test('handles empty folders and binary-looking text files without storing docs', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(notes, { recursive: true });

    const empty = await mineFolder({ dir: notes, dbPath });
    expect(empty).toMatchObject({ scanned: 0, stored: 0, skipped: 0, project: 'notes' });

    const blob = path.join(notes, 'capture.txt');
    fs.writeFileSync(blob, Buffer.from([0x00, 0x01, 0x02, 0x03, 0x61]));
    const mined = await mineFolder({ dir: notes, dbPath });

    expect(mined).toMatchObject({ scanned: 1, stored: 0, skipped: 1, project: 'notes' });
    expect(rowsFor(dbPath, 'mine/notes/capture.txt')).toEqual([]);
  });

  test('chunks huge text files and keeps re-mine idempotent', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(notes, { recursive: true });
    const bigPath = path.join(notes, 'big.md');
    const paragraphs = Array.from({ length: 16 }, (_, i) => `## Part ${i}\n${'phoenix '.repeat(260)}`);
    fs.writeFileSync(bigPath, paragraphs.join('\n\n'), 'utf8');

    const first = await mineFolder({ dir: notes, dbPath });
    const second = await mineFolder({ dir: notes, dbPath });
    const rows = rowsFor(dbPath, 'mine/notes/big.md');

    expect(first.stored).toBeGreaterThan(1);
    expect(second).toMatchObject({ scanned: 1, stored: 0, skipped: 1 });
    expect(rows).toHaveLength(first.stored);
    expect(rows.every((row) => String(row.content).length <= 800)).toBe(true);
    expect(JSON.parse(String(rows[0].concepts))).toEqual(expect.arrayContaining(['big']));
  });

  test('re-mine removes stale chunks when a huge file becomes small', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(notes, { recursive: true });
    const note = path.join(notes, 'shrinks.md');
    fs.writeFileSync(note, 'alpha '.repeat(30_000), 'utf8');
    const first = await mineFolder({ dir: notes, dbPath });
    expect(first.stored).toBeGreaterThan(1);

    fs.writeFileSync(note, '# Shrunk\n\nsingle concise memory', 'utf8');
    const second = await mineFolder({ dir: notes, dbPath });
    const rows = rowsFor(dbPath, 'mine/notes/shrinks.md');

    expect(second).toMatchObject({ scanned: 1, stored: 1, skipped: 0 });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(stableMineDocId(notes, note));
    expect(String(rows[0].content)).toContain('single concise memory');
  });

  test('watch re-ingests changed files after the initial run', async () => {
    const root = tmp();
    const dbPath = path.join(root, 'oracle.db');
    const notes = path.join(root, 'notes');
    fs.mkdirSync(notes, { recursive: true });
    const notePath = path.join(notes, 'watch.md');
    fs.writeFileSync(notePath, 'first version');

    const controller = new AbortController();
    const results: number[] = [];
    const watchDone = watchMineFolder(
      { dir: notes, dbPath, debounceMs: 20, signal: controller.signal },
      (result) => {
        results.push(result.stored);
        if (results.length === 1) fs.writeFileSync(notePath, 'second version');
        if (results.length >= 2) controller.abort();
      },
    );

    await watchDone;

    expect(results).toEqual([1, 1]);
  });
});
