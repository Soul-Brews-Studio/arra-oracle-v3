import { describe, expect, test } from 'bun:test';
import { serveCommandPlan } from '../../src/cli/commands/serve.ts';

describe('serve command adapter', () => {
  test('delegates default start to canonical serve CLI', () => {
    expect(serveCommandPlan(['serve'])).toEqual({ kind: 'delegate', args: [] });
    expect(serveCommandPlan(['serve', 'daemon', '--port', '5999'])).toEqual({
      kind: 'delegate',
      args: ['start', '--port', '5999'],
    });
  });

  test('keeps status and stop arguments intact', () => {
    expect(serveCommandPlan(['serve', 'status', '--json'])).toEqual({ kind: 'delegate', args: ['status', '--json'] });
    expect(serveCommandPlan(['serve', 'stop', '--port', '5999'])).toEqual({ kind: 'delegate', args: ['stop', '--port', '5999'] });
  });

  test('preserves foreground-only mode outside the canonical background CLI', () => {
    expect(serveCommandPlan(['serve', 'foreground'])).toEqual({ kind: 'foreground' });
    expect(serveCommandPlan(['serve', 'start', '--foreground'])).toEqual({ kind: 'foreground' });
  });

  test('rejects conflicting start mode flags before delegation', () => {
    expect(serveCommandPlan(['serve', 'start', '--foreground', '--background'])).toEqual({
      kind: 'error',
      message: 'Cannot use --foreground and --background together',
    });
  });
});
