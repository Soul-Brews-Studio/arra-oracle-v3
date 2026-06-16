import { expect, test } from 'bun:test';
import { waitForProcessesExit } from '../../src/process-manager/index.ts';

test('waiting for process exit treats empty pid lists as already done', async () => {
  expect(await waitForProcessesExit([], 0)).toBe(true);
});

test('waiting for process exit ignores invalid pids', async () => {
  expect(await waitForProcessesExit([0, -1, Number.NaN], 0)).toBe(true);
});
