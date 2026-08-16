/**
 * `search_log.project` records the project a search was actually scoped to.
 *
 * The handler resolves a project from either the explicit `project` input or `cwd`
 * detection, uses it to scope FTS and pointer retrieval — and then called `logSearch`
 * without it. `logSearch` has always accepted the parameter (`src/server/logging.ts:22`),
 * so every row landed with `project` NULL and scoped searches were indistinguishable from
 * unscoped ones in telemetry. See #2955.
 *
 * This pins the caller, not the logger: the assertion is that the resolved value reaches
 * `logSearch`, including the cwd-detected case, which is the one an "explicit input only"
 * fix would silently miss.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const savedNodeEnv = process.env.NODE_ENV;
const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;
const root = join(tmpdir(), `arra-search-telemetry-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const dbPath = join(root, 'oracle.db');
mkdirSync(root, { recursive: true });
process.env.NODE_ENV = 'test';
process.env.ORACLE_DATA_DIR = root;
process.env.ORACLE_DB_PATH = dbPath;

const dbMod = await import('../../../db/index.ts');
dbMod.resetDefaultDatabaseForTests(dbPath);

function restore(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe('search telemetry — project scope', () => {
  test('logSearch still declares the trailing project parameter the handler relies on', async () => {
    // Guards the contract the handler depends on: if logSearch loses its trailing
    // `project` parameter, the handler's extra argument becomes silently inert.
    // `Function.length` cannot see it — it stops counting at the first defaulted
    // parameter (`results`) — so read the declaration.
    const { readFileSync } = await import('node:fs');
    const loggingSrc = readFileSync(
      join(import.meta.dir, '..', '..', '..', 'server', 'logging.ts'),
      'utf-8',
    );
    const signature = loggingSrc.match(/export function logSearch\(([^)]*)\)/s)?.[1] ?? '';
    expect(signature).toContain('project');
  });

  test('the handler passes its resolved project, not just the explicit input', async () => {
    // Read the call site rather than round-tripping the DB: the defect was a missing
    // argument, and the resolved-vs-explicit distinction is exactly what regressed.
    const { readFileSync } = await import('node:fs');
    const handlerSrc = readFileSync(join(import.meta.dir, '..', 'handler.ts'), 'utf-8');
    const logCall = handlerSrc.match(/logSearch\([^)]*\)/s)?.[0] ?? '';

    expect(logCall).toContain('resolvedProject');
    // `project` alone would drop every cwd-detected scope on the floor.
    expect(logCall).not.toMatch(/,\s*project\s*\)/);
  });
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch {}
  restore('NODE_ENV', savedNodeEnv);
  restore('ORACLE_DATA_DIR', savedDataDir);
  restore('ORACLE_DB_PATH', savedDbPath);
});
