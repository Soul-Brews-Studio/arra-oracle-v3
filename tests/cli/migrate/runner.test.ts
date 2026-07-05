import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  migrateCommand,
  runDrizzleMigrations,
  type CommandRunner,
} from '../../../src/cli/commands/migrate.ts';
import { runCli } from '../_run.ts';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});

function isolatedEnv(): Record<string, string> {
  const root = mkdtempSync(join(tmpdir(), 'arra-migrate-cli-'));
  roots.push(root);
  return { HOME: join(root, 'home'), ORACLE_DATA_DIR: join(root, 'data'), ORACLE_REPO_ROOT: root };
}

describe('Drizzle migration runner', () => {
  test('runs generate then push in order', async () => {
    const calls: string[][] = [];
    const output: string[] = [];
    const runner: CommandRunner = async (command) => {
      calls.push(command);
      return { code: 0, stdout: `${command.at(-1)} ok\n`, stderr: '' };
    };

    const result = await runDrizzleMigrations({ runner, stdout: msg => output.push(msg), stderr: msg => output.push(msg) });

    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      ['bunx', 'drizzle-kit', 'generate'],
      ['bunx', 'drizzle-kit', 'push'],
    ]);
    expect(output.join('')).toContain('[migrate] migrations generated and pushed');
  });

  test('stops before push when generate exits non-zero', async () => {
    const calls: string[][] = [];
    const errors: string[] = [];
    const runner: CommandRunner = async (command) => {
      calls.push(command);
      return { code: 7, stdout: '', stderr: 'schema error\n' };
    };

    const result = await runDrizzleMigrations({ runner, stdout: () => undefined, stderr: msg => errors.push(msg) });

    expect(result.ok).toBe(false);
    expect(calls).toEqual([['bunx', 'drizzle-kit', 'generate']]);
    expect(result.steps[0]?.code).toBe(7);
    expect(errors.join('')).toContain('schema error');
    expect(errors.join('')).toContain('generate failed with exit code 7');
  });

  test('surfaces spawn errors as command failures', async () => {
    const errors: string[] = [];
    const result = await runDrizzleMigrations({
      runner: async () => { throw new Error('spawn failed'); },
      stdout: () => undefined,
      stderr: msg => errors.push(msg),
    });

    expect(result.ok).toBe(false);
    expect(result.steps[0]?.code).toBeNull();
    expect(result.steps[0]?.error).toBe('spawn failed');
    expect(errors.join('')).toContain('spawn failed');
  });



  test('CLI help exposes the migrate command without running drizzle-kit', async () => {
    const result = await runCli(['migrate', '--help'], isolatedEnv());

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage: arra-cli migrate');
    expect(result.stdout).toContain('run Drizzle migration generate and push');
  }, 15_000);

  test('migrateCommand returns non-zero for unknown flags without running commands', async () => {
    let ran = false;
    const errors: string[] = [];
    const code = await migrateCommand(['--bad'], {
      runner: async () => { ran = true; return { code: 0, stdout: '', stderr: '' }; },
      stdout: () => undefined,
      stderr: msg => errors.push(msg),
    });

    expect(code).toBe(1);
    expect(ran).toBe(false);
    expect(errors.join('')).toContain('unknown migrate option: --bad');
  });
});
