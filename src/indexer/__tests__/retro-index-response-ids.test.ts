/**
 * Barbara base-id-not-found defect (ORA-SHARED-20260820-03/04): index-retro
 * wrote real, findable rows, but the response only reported a document
 * COUNT — every stored id carries a "_1" / "_2__chunk_0" style suffix, so a
 * caller guessing at an unsuffixed base id got a deterministic "Document not
 * found" even though the data was fine. The fix: return the exact ids that
 * were written, so a caller never has to guess.
 */

import { afterAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-retro-response-ids-'));
process.env.ORACLE_DATA_DIR = path.join(tmp, 'data');
const dbPath = path.join(tmp, 'oracle.db');
const repoRoot = path.join(tmp, 'repo');

const { createDatabase, closeDb, resetDefaultDatabaseForTests } = await import('../../db/index.ts');
resetDefaultDatabaseForTests(dbPath);
const { indexRetrospectives, indexRetroFile } = await import('../retro-index.ts');

afterAll(() => {
  try { closeDb(); } catch { /* already closed */ }
  resetDefaultDatabaseForTests(':memory:');
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('retro-index response reports the exact ids it wrote', () => {
  test('indexRetrospectives returns ids that are each individually readable', async () => {
    const retroDir = path.join(repoRoot, 'ψ', 'memory', 'retrospectives', '2026-08', '20');
    fs.mkdirSync(retroDir, { recursive: true });
    fs.writeFileSync(path.join(retroDir, '16.16_inbox-backlog-triage.md'),
      '# retro\n\n## Summary\n\nsession body long enough to satisfy the retro parser minimum section length rule.\n');

    const result = await indexRetrospectives(repoRoot, dbPath);
    expect(result.ok).toBe(true);
    expect(result.ids).toBeInstanceOf(Array);
    expect(result.ids!.length).toBe(result.documents);
    expect(result.ids!.length).toBeGreaterThan(0);

    // No id may be the un-suffixed "base" — that's exactly the shape a caller
    // used to have to guess at and get "Document not found" for.
    for (const id of result.ids!) {
      expect(id === 'retro_16.16_inbox-backlog-triage').toBe(false);
    }

    const { sqlite } = createDatabase(dbPath);
    for (const id of result.ids!) {
      const row = sqlite.prepare('SELECT id FROM oracle_documents WHERE id = ?').get(id);
      expect(row).not.toBeNull();
    }
  });

  test('indexRetroFile returns ids for the single file it indexed', async () => {
    const retroDir = path.join(repoRoot, 'ψ', 'memory', 'retrospectives', '2026-08', '21');
    fs.mkdirSync(retroDir, { recursive: true });
    const filePath = path.join(retroDir, '09.00_single-file.md');
    fs.writeFileSync(filePath,
      '# retro\n\n## Summary\n\nsingle file body long enough to satisfy the retro parser minimum section length.\n');

    const result = await indexRetroFile(repoRoot, filePath, dbPath);
    expect(result.ok).toBe(true);
    expect(result.ids).toBeInstanceOf(Array);
    expect(result.ids!.length).toBe(result.documents);

    const { sqlite } = createDatabase(dbPath);
    for (const id of result.ids!) {
      const row = sqlite.prepare('SELECT id FROM oracle_documents WHERE id = ?').get(id);
      expect(row).not.toBeNull();
    }
  });
});
