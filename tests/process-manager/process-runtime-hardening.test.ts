import { afterEach, expect, test } from 'bun:test';
import {
  getLogger,
  getPlatformTimeout,
  isProcessAlive,
  setLogger,
  spawnDaemon,
  type Logger,
} from '../../src/process-manager/index.ts';

const originalLogger = getLogger();

afterEach(() => {
  setLogger(originalLogger);
});

test('process liveness rejects malformed pids before probing the OS', () => {
  for (const pid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(isProcessAlive(pid)).toBe(false);
  }
});

test('platform timeout clamps malformed base durations', () => {
  expect(getPlatformTimeout(Number.NaN)).toBe(0);
  expect(getPlatformTimeout(-50)).toBe(0);
});

test('daemon spawning rejects blank script paths', () => {
  const warnings: string[] = [];
  setLogger(noopLogger((message) => warnings.push(message)));

  expect(spawnDaemon({ scriptPath: '   ' })).toBeUndefined();
  expect(warnings).toContain('Failed to spawn daemon');
});

function noopLogger(onWarn: (message: string) => void): Logger {
  return {
    debug: () => {},
    info: () => {},
    warn: (_category, message) => onWarn(message),
    error: () => {},
    success: () => {},
  };
}
