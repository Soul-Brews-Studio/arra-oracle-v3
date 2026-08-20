/**
 * Proves the FTS+vector fusion formula is now single-sourced: server/handlers.ts
 * (HTTP path) and tools/search/helpers.ts (MCP path) both delegate to
 * search/fusion.ts's combineResults instead of running independently-drifting
 * formulas. Repair pass ORA-SHARED-20260820-07 — see
 * docs/agentic-os/evidence/2026-08-20-oracle-incident-decision-state.md
 * ("Seat-search discrepancy CLASSIFIED").
 *
 * Test isolation (invariant 1): importing server/handlers.ts pulls in
 * db/index.ts, which opens a module-level sqlite connection at import time —
 * so HOME/ORACLE_DATA_DIR/ORACLE_DB_PATH/ORACLE_VECTOR_DB_PATH are sandboxed
 * BEFORE the dynamic import, and the resolved path is asserted under the
 * sandbox before any test runs.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'arra-fusion-dedupe-'));
const originalEnv = {
  HOME: process.env.HOME,
  ORACLE_DATA_DIR: process.env.ORACLE_DATA_DIR,
  ORACLE_DB_PATH: process.env.ORACLE_DB_PATH,
  ORACLE_VECTOR_DB_PATH: process.env.ORACLE_VECTOR_DB_PATH,
};

let fusionCombine: typeof import('../fusion.ts').combineResults;
let helpersCombine: typeof import('../../tools/search/helpers.ts').combineResults;
let handlersCombine: typeof import('../../server/handlers.ts').combineSearchResults;

beforeAll(async () => {
  process.env.HOME = tempRoot;
  process.env.ORACLE_DATA_DIR = tempRoot;
  process.env.ORACLE_DB_PATH = path.join(tempRoot, 'oracle.db');
  process.env.ORACLE_VECTOR_DB_PATH = path.join(tempRoot, 'vector-db');

  ({ combineResults: fusionCombine } = await import('../fusion.ts'));
  ({ combineResults: helpersCombine } = await import('../../tools/search/helpers.ts'));
  ({ combineSearchResults: handlersCombine } = await import('../../server/handlers.ts'));

  const config = await import('../../config.ts');
  expect(config.ORACLE_DATA_DIR).toBe(tempRoot);
});

afterAll(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

// The classification's reproducer: a retro doc that matches on both FTS
// keyword and vector-semantic legs (source of the seat-search ranking miss).
const BARBARA_DOC_ID = 'retro_16.16_inbox-backlog-triage-and-maw-index-counter-anomaly_1';

function ftsRow(id: string, score: number) {
  return { id, type: 'retro', content: 'inbox backlog triage maw index counter anomaly', source_file: 'psi/retro.md', concepts: [], score };
}

function vectorRow(id: string, score: number) {
  return { id, type: 'retro', content: 'inbox backlog triage maw index counter anomaly', source_file: 'psi/retro.md', concepts: [], score, distance: 1 - score, model: 'bge-m3' };
}

describe('fusion consolidation — HTTP and MCP paths agree', () => {
  test('server/handlers.ts, tools/search/helpers.ts, and search/fusion.ts produce byte-identical output for the same inputs', () => {
    const fts = [ftsRow(BARBARA_DOC_ID, 0.83), ftsRow('fts-only-doc', 0.6)];
    const vector = [vectorRow(BARBARA_DOC_ID, 0.71), vectorRow('vector-only-doc', 0.5)];

    const fromFusion = fusionCombine(fts, vector);
    const fromHelpers = helpersCombine(fts as any, vector as any);
    const fromHandlers = handlersCombine(fts as any, vector as any);

    expect(JSON.stringify(fromHelpers)).toBe(JSON.stringify(fromFusion));
    expect(JSON.stringify(fromHandlers)).toBe(JSON.stringify(fromFusion));
  });

  test('barbara-doc reproducer: hybrid match outranks either single-leg match, same score on every path', () => {
    const fts = [ftsRow(BARBARA_DOC_ID, 0.83), ftsRow('fts-only-doc', 0.9)];
    const vector = [vectorRow(BARBARA_DOC_ID, 0.71), vectorRow('vector-only-doc', 0.9)];

    const expectedHybridScore = Number((((0.5 * 0.83) + (0.5 * 0.71)) * 1.1).toFixed(6));

    for (const combine of [fusionCombine, helpersCombine as typeof fusionCombine, handlersCombine as typeof fusionCombine]) {
      const combined = combine(fts as any, vector as any);
      const barbara = combined.find((r) => r.id === BARBARA_DOC_ID);
      expect(barbara).toBeDefined();
      expect(barbara!.source).toBe('hybrid');
      expect(barbara!.score).toBeCloseTo(expectedHybridScore, 6);
      // Hybrid beats both single-source-only results at higher raw scores —
      // this is the exact ranking behavior the classification flagged as
      // divergent between the two formerly-separate formulas.
      expect(barbara!.score).toBeGreaterThan(0.9 * 0.5);
    }
  });

  test('fts-only and vector-only results score deterministically the same on every path', () => {
    const fts = [ftsRow('fts-only-doc', 0.6)];
    const vector = [vectorRow('vector-only-doc', 0.5)];

    const results = [fusionCombine, helpersCombine as typeof fusionCombine, handlersCombine as typeof fusionCombine]
      .map((combine) => combine(fts as any, vector as any));

    for (const combined of results) {
      expect(combined.find((r) => r.id === 'fts-only-doc')!.score).toBeCloseTo(0.3, 6);
      expect(combined.find((r) => r.id === 'vector-only-doc')!.score).toBeCloseTo(0.25, 6);
    }
  });
});
