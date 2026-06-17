import { describe, expect, test } from 'bun:test';
import { runStartupSelfTest } from '../../src/lifecycle/self-test.ts';

describe('startup self-test timeout hardening', () => {
  test('marks a stuck check failed and still runs later checks', async () => {
    const logs: string[] = [];
    const calls: string[] = [];

    const results = await runStartupSelfTest({
      timeoutMs: 10,
      checks: [
        { name: 'stuck', run: () => new Promise<void>(() => undefined) },
        { name: 'next', run: () => { calls.push('next'); } },
      ],
      log: (message) => logs.push(message),
    });

    expect(results).toEqual([
      { name: 'stuck', status: 'fail', message: 'timed out after 10ms' },
      { name: 'next', status: 'pass', message: 'ok' },
    ]);
    expect(calls).toEqual(['next']);
    expect(logs).toContain('[SelfTest] FAIL stuck — timed out after 10ms');
    expect(logs.at(-1)).toBe('[SelfTest] summary: 1 passed, 1 failed');
  });

  test('ignores invalid timeout values to preserve existing no-timeout behavior', async () => {
    const results = await runStartupSelfTest({
      timeoutMs: Number.NaN,
      checks: [{ name: 'quick', run: async () => undefined }],
      log: () => undefined,
    });

    expect(results).toEqual([{ name: 'quick', status: 'pass', message: 'ok' }]);
  });
});
