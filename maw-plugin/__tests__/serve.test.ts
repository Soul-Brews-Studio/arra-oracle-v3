import { mkdtempSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { runServe, type Runner } from '../serve.ts';

function env() {
  return { HOME: mkdtempSync('/tmp/arra-serve-test-'), ORACLE_ROOT: '/repo/arra-oracle-v3' };
}

const runner: Runner = async () => ({ code: 1, stdout: '', stderr: '' });

describe('maw arra serve command', () => {
  test('starts with ORACLE_ROOT and port override', async () => {
    const started: unknown[] = [];
    const result = await runServe({ pos: [], flags: { port: '47779' } }, runner, env(), {
      start: (cwd, startEnv) => {
        started.push({ cwd, port: startEnv.ORACLE_PORT });
        return 43210;
      },
      isAlive: () => false,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('started pid=43210 port=47779');
    expect(started).toEqual([{ cwd: '/repo/arra-oracle-v3', port: '47779' }]);
  });

  test('supports positional start stop status actions', async () => {
    const home = env();
    let alive = true;
    await runServe({ pos: ['start'], flags: {} }, runner, home, { start: () => 54321, isAlive: () => false });

    const status = await runServe({ pos: ['status'], flags: {} }, runner, home, {
      isAlive: () => alive,
      fetch: async () => new Response('{"status":"ok"}', { status: 200 }),
    });
    expect(status.output).toContain('alive pid=54321');
    expect(status.output).toContain('health: ok 200');

    const stop = await runServe({ pos: ['stop'], flags: {} }, runner, home, {
      isAlive: () => alive,
      kill: () => { alive = false; },
      sleep: async () => {},
    });
    expect(stop.output).toContain('stopped pid=54321');
  });

  test('supports --status and --stop flag actions directly', async () => {
    const home = env();
    let alive = true;
    await runServe({ pos: [], flags: {} }, runner, home, {
      start: () => 65432,
      isAlive: () => false,
    });

    const status = await runServe({ pos: [], flags: { status: true, port: '47779' } }, runner, home, {
      isAlive: () => alive,
      fetch: async (input) => new Response(String(input), { status: 200 }),
    });
    expect(status.ok).toBe(true);
    expect(status.output).toContain('alive pid=65432');
    expect(status.output).toContain('health: ok 200');
    expect(status.output).toContain('47779');

    const stopped = await runServe({ pos: [], flags: { stop: true } }, runner, home, {
      isAlive: () => alive,
      kill: () => { alive = false; },
      sleep: async () => {},
    });
    expect(stopped.ok).toBe(true);
    expect(stopped.output).toContain('stopped pid=65432');

    const after = await runServe({ pos: [], flags: { status: true } }, runner, home, {
      isAlive: () => alive,
      fetch: async () => new Response('', { status: 503 }),
    });
    expect(after.output).toContain('missing pid');
  });

  test('status reuses the tracked start port when --port is omitted', async () => {
    const home = env();
    const seen: string[] = [];
    await runServe({ pos: [], flags: { port: '47779' } }, runner, home, {
      start: () => 24680,
      isAlive: () => false,
    });

    const status = await runServe({ pos: ['status'], flags: {} }, runner, home, {
      isAlive: () => true,
      fetch: async (input) => {
        seen.push(String(input));
        return new Response('{"status":"ok"}', { status: 200 });
      },
    });

    expect(status.output).toContain('port: 47779');
    expect(status.output).toContain('root: /repo/arra-oracle-v3');
    expect(seen).toEqual(['http://127.0.0.1:47779/api/health']);
  });

  test('status remains compatible with legacy pid-only files', async () => {
    const legacy = env();
    await runServe({ pos: [], flags: {} }, runner, legacy, {
      start: () => 13579,
      isAlive: () => false,
    });
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    writeFileSync(join(legacy.HOME, '.arra-oracle-v2', 'server.pid'), '13579\n');

    const status = await runServe({ pos: ['status'], flags: {} }, runner, legacy, {
      isAlive: () => true,
      fetch: async (input) => new Response(String(input), { status: 200 }),
    });

    expect(status.output).toContain('alive pid=13579');
    expect(status.output).toContain('port: 47778');
  });


  test('starts from ghq locate when ORACLE_ROOT is unset', async () => {
    const calls: unknown[] = [];
    const rootless = { HOME: mkdtempSync('/tmp/arra-serve-test-') };
    const ghqRunner: Runner = async (cmd, args) => {
      calls.push([cmd, args]);
      return { code: 0, stdout: '/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3\n', stderr: '' };
    };

    const result = await runServe({ pos: ['start'], flags: {} }, ghqRunner, rootless, {
      start: (cwd) => {
        calls.push(['start', cwd]);
        return 77777;
      },
      isAlive: () => false,
    });

    expect(result.ok).toBe(true);
    expect(result.output).toContain('started pid=77777');
    expect(calls).toEqual([
      ['ghq', ['locate', 'Soul-Brews-Studio/arra-oracle-v3']],
      ['start', '/ghq/github.com/Soul-Brews-Studio/arra-oracle-v3'],
    ]);
  });


  test('rejects invalid serve actions and ports', async () => {
    const badAction = await runServe({ pos: ['restart'], flags: {} }, runner, env());
    expect(badAction.ok).toBe(false);
    expect(badAction.error).toContain('serve action must be start, stop, or status');

    const badPort = await runServe({ pos: [], flags: { port: '99999' } }, runner, env());
    expect(badPort.ok).toBe(false);
    expect(badPort.error).toContain('--port must be a number from 1 to 65535');
  });
});
