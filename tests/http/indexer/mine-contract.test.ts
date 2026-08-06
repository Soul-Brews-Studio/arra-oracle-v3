import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseMineArgs } from '../../../src/cli/mine.ts';
import { createDatabase } from '../../../src/db/index.ts';
import { chunkDocumentForIndexing } from '../../../src/indexer/chunker.ts';
import { mineFolder, stableMineDocId } from '../../../src/indexer/mine.ts';
import type { OracleDocument } from '../../../src/types.ts';

let tempRoot = '';

afterEach(() => {
  if (tempRoot && existsSync(tempRoot)) rmSync(tempRoot, { recursive: true });
  tempRoot = '';
});

function tmp(): string {
  tempRoot = mkdtempSync(join(tmpdir(), 'indexer-mine-'));
  return tempRoot;
}

function note(content: string): OracleDocument {
  return {
    id: 'note',
    type: 'learning',
    source_file: 'mine/notes/ops.md',
    content,
    concepts: ['ops'],
    created_at: 1,
    updated_at: 1,
  };
}

function minedRows(dbPath: string, sourceFile: string): Array<Record<string, unknown>> {
  const { sqlite, storage } = createDatabase(dbPath);
  try {
    return sqlite.prepare(`
      SELECT d.id, d.source_file AS sourceFile, d.created_by AS createdBy, d.concepts, f.content
      FROM oracle_documents d
      JOIN oracle_fts f ON f.id = d.id
      WHERE d.source_file = ?
      ORDER BY d.id
    `).all(sourceFile) as Array<Record<string, unknown>>;
  } finally {
    storage.close();
  }
}

describe('arra mine indexer contract', () => {
  test('parses the friendly mine verb from the canonical CLI module', () => {
    expect(parseMineArgs(['~/notes', '--dry-run', '--db-path=/tmp/oracle.db'])).toEqual({
      dir: '~/notes',
      dbPath: '/tmp/oracle.db',
      dryRun: true,
      watch: false,
      help: false,
    });
    expect(parseMineArgs(['-w', 'notes']).watch).toBe(true);
    expect(() => parseMineArgs(['notes', '--unknown'])).toThrow('unknown mine option: --unknown');
  });

  test('chunks on paragraph boundaries with stable indexes and line spans', () => {
    const text = [
      `alpha ${'a'.repeat(20)}`,
      `alpha detail ${'a'.repeat(20)}`,
      '',
      `beta ${'b'.repeat(20)}`,
      '',
      `gamma ${'c'.repeat(20)}`,
    ].join('\n');

    const chunks = chunkDocumentForIndexing(note(text), 87);

    expect(chunks.map((chunk) => chunk.id)).toEqual(['note__chunk_0', 'note__chunk_1']);
    expect(chunks.map((chunk) => chunk.chunk_index)).toEqual([0, 1]);
    expect(chunks.map((chunk) => [chunk.line_start, chunk.line_end])).toEqual([[1, 4], [6, 6]]);
    expect(chunks[0].content).toContain('beta');
    expect(chunks[1].content).toContain('gamma');
    expect(chunks.every((chunk) => chunk.content.length <= 87)).toBe(true);
  });

  test('mines a folder idempotently with deterministic chunk ids', async () => {
    const root = tmp();
    const dbPath = join(root, 'oracle.db');
    const notes = join(root, 'notes');
    const ops = join(notes, 'ops');
    mkdirSync(ops, { recursive: true });
    const notePath = join(ops, 'runbook.md');
    const para = (label: string, char: string) => `${label} ${char.repeat(330)}`;
    writeFileSync(notePath, [para('alpha', 'a'), '', para('beta', 'b'), '', para('gamma', 'c')].join('\n'));

    const first = await mineFolder({ dir: notes, dbPath });
    const second = await mineFolder({ dir: notes, dbPath });
    const id = stableMineDocId(notes, notePath);
    const rows = minedRows(dbPath, 'mine/notes/ops/runbook.md');

    expect(first).toMatchObject({ scanned: 1, stored: 2, skipped: 0, project: 'notes' });
    expect(second).toMatchObject({ scanned: 1, stored: 0, skipped: 1, project: 'notes' });
    expect(rows.map((row) => row.id)).toEqual([`${id}__chunk_0`, `${id}__chunk_1`]);
    expect(rows.every((row) => row.createdBy === 'mine')).toBe(true);
    expect(JSON.parse(String(rows[0].concepts))).toEqual(expect.arrayContaining(['notes', 'ops']));
  });
});
