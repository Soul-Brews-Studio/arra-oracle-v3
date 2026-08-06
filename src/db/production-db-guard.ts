/**
 * A test must never open the user's real database.
 *
 * `defaultDbPath()` returns `':memory:'` under `NODE_ENV=test`, but only *after* an
 * `ORACLE_DB_PATH` check that returns first. Set that variable — as any shell that runs the
 * server does — and every test importing the `db` singleton writes to live data instead.
 *
 * This is not hypothetical. `tests/http/health/stats.test.ts` was created 2026-06-16, one day
 * before the `':memory:'` guard existed (b1806554, 2026-06-17). In that window it wrote
 * `vault_repo = 'coverage-vault'` into `~/.arra-oracle-v2/oracle.db`. Its `afterAll` restores
 * whatever it read at import time, so once the fixture leaked, every later run read it back and
 * faithfully restored it. The vault pointed at a repo that does not exist for the next 40 days,
 * and `syncVault` was inert the whole time. Nothing failed; nothing said anything.
 *
 * The guard throws rather than silently redirecting to `':memory:'`. A test that would corrupt
 * live data has a bug in it, and the 40 days above are what silent handling costs.
 *
 * Temp paths stay allowed — many tests legitimately point `ORACLE_DB_PATH` at a `mkdtemp`
 * directory and need it honoured. Only the production data directory is refused.
 */
import path from 'node:path';

/** True when `candidate` resolves to `dir` itself or anything beneath it. */
function isInside(dir: string, candidate: string): boolean {
  const rel = path.relative(path.resolve(dir), path.resolve(candidate));
  // '' means the same path. A '..' prefix or an absolute result means outside — which also
  // rules out the `/foo` vs `/foobar` prefix trap that a plain startsWith() would fall into.
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Refuse an explicit database path that points into the user's real data directory while
 * running under test. Returns the path unchanged when it is safe to use.
 */
export function assertNotProductionDb(envPath: string, productionDir: string): string {
  if (process.env.NODE_ENV !== 'test') return envPath;
  if (envPath === ':memory:') return envPath;
  if (!isInside(productionDir, envPath)) return envPath;

  throw new Error(
    `Refusing to open the production database from a test.\n` +
      `  ORACLE_DB_PATH = ${envPath}\n` +
      `  production data dir = ${productionDir}\n` +
      `A test that writes here mutates real user data, and the damage outlives the run: a ` +
      `setting leaked this way in June 2026 survived 40 days because the test restored the ` +
      `value it had itself written. Point ORACLE_DB_PATH at a temp directory, or unset it.`,
  );
}
