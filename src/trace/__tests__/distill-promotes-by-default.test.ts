/**
 * Distilling a trace must produce the lesson, without being asked twice.
 *
 * `promoteToLearning` was `t.Optional(t.Boolean())` with no default anywhere
 * (`src/routes/traces/distill.ts:29`), so `distillTraceAwakening` took the `: undefined` branch:
 * the trace was marked `distilled`, `distilledToId` stayed null, and no artefact existed. The
 * status said the work was done and nothing had been produced — which is why the gap survived
 * long enough to be reported as "the promotion path is not implemented".
 *
 * It was implemented. It was just off by default.
 */
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'distill-default-'));
const ORIGINAL_DATA_DIR = process.env.ORACLE_DATA_DIR;
const ORIGINAL_REPO_ROOT = process.env.ORACLE_REPO_ROOT;

beforeAll(() => {
  process.env.ORACLE_DATA_DIR = TMP;
  process.env.ORACLE_REPO_ROOT = TMP;
});

afterAll(() => {
  if (ORIGINAL_DATA_DIR) process.env.ORACLE_DATA_DIR = ORIGINAL_DATA_DIR;
  else delete process.env.ORACLE_DATA_DIR;
  if (ORIGINAL_REPO_ROOT) process.env.ORACLE_REPO_ROOT = ORIGINAL_REPO_ROOT;
  else delete process.env.ORACLE_REPO_ROOT;
  try { rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
});

async function seedTrace(traceId: string) {
  const { db, traceLog } = await import('../../db/index.ts');
  const now = Date.now();
  db.insert(traceLog).values({
    traceId,
    query: 'why did we choose two database files',
    status: 'raw',
    createdAt: now,
    updatedAt: now,
  }).run();
  return { db, traceLog };
}

describe('distillTraceAwakening promotes by default', () => {
  test('an ordinary distill produces a real learningId — the whole point', async () => {
    const { distillTraceAwakening } = await import('../distill.ts');
    const traceId = `trace_default_${Date.now()}`;
    await seedTrace(traceId);

    // note: no promoteToLearning passed at all — this is the ordinary call
    const result = distillTraceAwakening({
      traceId,
      awakening: 'Two files, because the indexer backs up the whole DB before every run.',
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('distilled');
    expect(result.learningId).toBeTruthy();
    expect(typeof result.learningId).toBe('string');
  });

  test('the trace is linked to what it produced', async () => {
    const { distillTraceAwakening } = await import('../distill.ts');
    const { eq } = await import('drizzle-orm');
    const traceId = `trace_link_${Date.now()}`;
    const { db, traceLog } = await seedTrace(traceId);

    const result = distillTraceAwakening({ traceId, awakening: 'A lesson worth keeping.' });

    const row = db.select().from(traceLog).where(eq(traceLog.traceId, traceId)).get();
    expect(row?.status).toBe('distilled');
    expect(row?.distilledToId).toBe(result.learningId!);
  });

  test('promoteToLearning: false still opts out — the escape hatch survives', async () => {
    const { distillTraceAwakening } = await import('../distill.ts');
    const traceId = `trace_optout_${Date.now()}`;
    await seedTrace(traceId);

    const result = distillTraceAwakening({
      traceId,
      awakening: 'Marked distilled, deliberately without an artefact.',
      promoteToLearning: false,
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe('distilled');
    expect(result.learningId).toBeUndefined();
  });
});
