import { describe, expect, test } from 'bun:test';
import { runArra } from '../index.ts';

describe('maw arra local CLI verb bridge', () => {
  test('delegates remaining built-in CLI verbs through the repo CLI entrypoint', async () => {
    const calls: any[] = [];
    const runner = async (cmd: string, args: string[], options?: any) => {
      calls.push({ cmd, args, options });
      if (cmd === 'ghq') return { code: 0, stdout: '/repo/arra-oracle-v3\n', stderr: '' };
      return { code: 0, stdout: 'exported markdown\n', stderr: '' };
    };

    const result = await runArra(['export', '--format', 'markdown'], async () => ({}), () => {}, {}, runner);

    expect(result).toEqual({ ok: true, output: 'exported markdown' });
    expect(calls).toContainEqual(expect.objectContaining({ cmd: 'ghq' }));
    expect(calls.at(-1)).toMatchObject({
      cmd: 'bun',
      args: ['run', 'cli/src/cli.ts', 'export', '--format', 'markdown'],
      options: expect.objectContaining({ cwd: '/repo/arra-oracle-v3', capture: true }),
    });
  });

  test('surfaces non-zero delegated CLI failures', async () => {
    const runner = async (cmd: string) => cmd === 'ghq'
      ? { code: 0, stdout: '/repo/arra-oracle-v3\n', stderr: '' }
      : { code: 2, stdout: '', stderr: 'bad export' };
    const result = await runArra(['export'], async () => ({}), () => {}, {}, runner);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('bad export');
  });
});
