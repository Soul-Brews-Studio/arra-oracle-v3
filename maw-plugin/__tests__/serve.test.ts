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

  test('rejects invalid serve actions and ports', async () => {
    const badAction = await runServe({ pos: ['restart'], flags: {} }, runner, env());
    expect(badAction.ok).toBe(false);
    expect(badAction.error).toContain('serve action must be start, stop, or status');

    const badPort = await runServe({ pos: [], flags: { port: '99999' } }, runner, env());
    expect(badPort.ok).toBe(false);
    expect(badPort.error).toContain('--port must be a number from 1 to 65535');
  });
});
