import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-distill-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { createTrace, getTrace } = await import('../handler.ts');
const { distillTraceAwakening } = await import('../distill.ts');

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

describe('trace awakening distill edge hardening', () => {
  test('blank awakenings do not update trace status', () => {
    const result = createTrace({ query: 'blank distill guard' });
    const distilled = distillTraceAwakening({ traceId: result.traceId, awakening: '   ' });

    expect(distilled).toEqual({ success: false, status: 'invalid', error: 'awakening is required' });
    expect(getTrace(result.traceId)?.status).toBe('raw');
  });

  test('awakening content is trimmed before persistence', () => {
    const result = createTrace({ query: 'trimmed distill content' });
    const distilled = distillTraceAwakening({
      traceId: result.traceId,
      awakening: '  Learned: trace awakenings should store clean text.  ',
      metadata: { source: 'edge-test' },
    });
    const trace = getTrace(result.traceId);

    expect(distilled.success).toBe(true);
    expect(trace?.status).toBe('distilled');
    expect(trace?.awakening?.startsWith('Learned:')).toBe(true);
    expect(trace?.awakening).toContain('"source": "edge-test"');
  });
});
