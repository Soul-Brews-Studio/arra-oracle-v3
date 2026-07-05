import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-trace-chain-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);
const { getTrace, getTraceChain, getTraceLinkedChain, linkTraces } = await import('../handler.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cycle = `trace-cycle-${stamp}`;
const linkedA = `trace-linked-a-${stamp}`;
const linkedB = `trace-linked-b-${stamp}`;
const linearA = `trace-linear-a-${stamp}`;
const linearB = `trace-linear-b-${stamp}`;
const brokenPrev = `trace-broken-prev-${stamp}`;
const now = Date.now();

dbMod.db.insert(dbMod.traceLog).values([
  {
    traceId: cycle,
    query: 'cyclic parent and child references',
    parentTraceId: cycle,
    childTraceIds: JSON.stringify([cycle]),
    createdAt: now,
    updatedAt: now,
  },
  {
    traceId: linkedA,
    query: 'linked cycle a',
    prevTraceId: linkedB,
    nextTraceId: linkedB,
    createdAt: now + 1,
    updatedAt: now + 1,
  },
  {
    traceId: linkedB,
    query: 'linked cycle b',
    prevTraceId: linkedA,
    nextTraceId: linkedA,
    createdAt: now + 2,
    updatedAt: now + 2,
  },
  {
    traceId: linearA,
    query: 'linear linked chain a',
    nextTraceId: linearB,
    createdAt: now + 3,
    updatedAt: now + 3,
  },
  {
    traceId: linearB,
    query: 'linear linked chain b',
    prevTraceId: linearA,
    createdAt: now + 4,
    updatedAt: now + 4,
  },
  {
    traceId: brokenPrev,
    query: 'linked chain with missing previous pointer',
    prevTraceId: `missing-${stamp}`,
    createdAt: now + 5,
    updatedAt: now + 5,
  },
]).run();

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

describe('trace chain cycle hardening', () => {
  test('parent and child self-cycles terminate with one summary', () => {
    const chain = getTraceChain(cycle);

    expect(chain.chain.map((trace) => trace.traceId)).toEqual([cycle]);
    expect(chain.totalDepth).toBe(0);
    expect(chain.hasAwakening).toBe(false);
  });

  test('linked-chain cycles terminate without duplicate records', () => {
    const result = getTraceLinkedChain(linkedA);

    expect(result.chain.map((trace) => trace.traceId).sort()).toEqual([linkedA, linkedB].sort());
    expect(new Set(result.chain.map((trace) => trace.traceId)).size).toBe(2);
  });

  test('linked-chain traversal keeps the requested trace when prev link is missing', () => {
    const result = getTraceLinkedChain(brokenPrev);

    expect(result.chain.map((trace) => trace.traceId)).toEqual([brokenPrev]);
    expect(result.position).toBe(0);
  });

  test('linking traces refuses to close a forward cycle', () => {
    const result = linkTraces(linearB, linearA);

    expect(result.success).toBe(false);
    expect(result.message).toContain('create a cycle');
    expect(getTrace(linearA)?.prevTraceId).toBeNull();
    expect(getTrace(linearB)?.nextTraceId).toBeNull();
  });
});
