/**
 * A test must not be able to open the user's real database.
 *
 * `defaultDbPath()` returns `':memory:'` under `NODE_ENV=test` — but only after an
 * `ORACLE_DB_PATH` check that returns first, so setting that variable bypasses the safety net
 * entirely and every test importing the `db` singleton writes to live data.
 *
 * The cost is measured, not hypothetical. `tests/http/health/stats.test.ts` was created
 * 2026-06-16 (e96e0412); the `':memory:'` guard landed 2026-06-17 (b1806554) — one day later.
 * In that window the test wrote `vault_repo = 'coverage-vault'` into the real database. Its
 * `afterAll` restores whatever it read at import time, so once the fixture leaked, every later
 * run read it back and dutifully restored it. `coverage-vault` is not a repo that exists, so
 * `syncVault` has been inert for 40 days. Nothing failed. Nothing reported anything.
 *
 * The distinction these tests pin is the one that matters: a temp path stays allowed, because
 * plenty of tests legitimately point `ORACLE_DB_PATH` at a `mkdtemp` directory. Only the real
 * data directory is refused.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { assertNotProductionDb } from '../../src/db/production-db-guard.ts';

const PROD = '/Users/someone/.arra-oracle-v2';
const previousNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe('under test, the production database is refused', () => {
  test('the exact production db file throws', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertNotProductionDb(join(PROD, 'oracle.db'), PROD)).toThrow(/production database/i);
  });

  test('anything nested beneath the data dir throws too', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertNotProductionDb(join(PROD, 'nested', 'deep.db'), PROD)).toThrow();
  });

  test('the data dir itself throws', () => {
    process.env.NODE_ENV = 'test';
    expect(() => assertNotProductionDb(PROD, PROD)).toThrow();
  });

  test('the message names the offending path, so the failure is actionable', () => {
    process.env.NODE_ENV = 'test';
    // A guard that fires without saying which path tripped it just moves the debugging cost.
    expect(() => assertNotProductionDb(join(PROD, 'oracle.db'), PROD)).toThrow(/oracle\.db/);
  });
});

describe('the paths tests legitimately use stay allowed', () => {
  test('a temp directory is returned unchanged', () => {
    process.env.NODE_ENV = 'test';
    const tmp = '/tmp/oracle-test-abc/oracle.db';
    expect(assertNotProductionDb(tmp, PROD)).toBe(tmp);
  });

  test(':memory: is allowed', () => {
    process.env.NODE_ENV = 'test';
    expect(assertNotProductionDb(':memory:', PROD)).toBe(':memory:');
  });

  test('a sibling whose name merely starts with the data dir is NOT inside it', () => {
    process.env.NODE_ENV = 'test';
    // The startsWith() trap: '/Users/someone/.arra-oracle-v2-backup' shares a string prefix with
    // the data dir but is a different directory. A prefix check would refuse it wrongly.
    const sibling = `${PROD}-backup/oracle.db`;
    expect(assertNotProductionDb(sibling, PROD)).toBe(sibling);
  });

  test('relative traversal that escapes the data dir is allowed', () => {
    process.env.NODE_ENV = 'test';
    const escaped = join(PROD, '..', 'elsewhere', 'oracle.db');
    expect(assertNotProductionDb(escaped, PROD)).toBe(escaped);
  });
});

describe('outside tests, nothing is refused', () => {
  test('production itself may open the production database', () => {
    process.env.NODE_ENV = 'production';
    const real = join(PROD, 'oracle.db');
    // The whole point of the real path is that the server uses it.
    expect(assertNotProductionDb(real, PROD)).toBe(real);
  });

  test('an unset NODE_ENV is not treated as test', () => {
    delete process.env.NODE_ENV;
    const real = join(PROD, 'oracle.db');
    expect(assertNotProductionDb(real, PROD)).toBe(real);
  });
});
