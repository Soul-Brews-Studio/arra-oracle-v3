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
const { getTraceChain, getTraceLinkedChain } = await import('../handler.ts');

const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const cycle = `trace-cycle-${stamp}`;
const linkedA = `trace-linked-a-${stamp}`;
const linkedB = `trace-linked-b-${stamp}`;
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
});
