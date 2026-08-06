import { describe, expect, test } from 'bun:test';
import {
  activeRequestCount,
  drainingResponseFor,
  runShutdownSteps,
  trackRequest,
  waitForActiveRequests,
} from '../../src/lifecycle/shutdown.ts';

describe('shutdown controller', () => {
  test('waits for tracked in-flight requests before reporting drained', async () => {
    let release!: () => void;
    const pending = trackRequest(() => new Promise<void>((resolve) => { release = resolve; }));

    expect(activeRequestCount()).toBe(1);
    const waiting = waitForActiveRequests(250, 0);
    await sleep(30);
    expect(activeRequestCount()).toBe(1);
    release();
    await pending;
    expect(await waiting).toBe(true);
    expect(activeRequestCount()).toBe(0);
  });

  test('treats invalid wait durations as immediate timeout instead of hanging', async () => {
    let release!: () => void;
    const pending = trackRequest(() => new Promise<void>((resolve) => { release = resolve; }));

    expect(await waitForActiveRequests(Number.NaN, -1)).toBe(false);
    release();
    await pending;
    expect(activeRequestCount()).toBe(0);
  });

  test('releases tracked requests when handlers reject', async () => {
    await expect(trackRequest(async () => {
      throw new Error('handler failed');
    })).rejects.toThrow('handler failed');

    expect(activeRequestCount()).toBe(0);
  });

  test('returns 503 for new non-health requests while draining', async () => {
    const blocked = drainingResponseFor(new Request('http://local/api/search?q=x'), { draining: true });
    const health = drainingResponseFor(new Request('http://local/api/health'), { draining: true });

    expect(blocked?.status).toBe(503);
    expect(blocked?.headers.get('Retry-After')).toBe('5');
    expect(await blocked?.json()).toMatchObject({ status: 'draining', draining: true });
    expect(health).toBeNull();
  });

  test('honors caller-provided health paths while draining', () => {
    const health = drainingResponseFor(new Request('http://local/internal/live'), {
      draining: true,
      healthPaths: ['/internal/live'],
    });
    const blocked = drainingResponseFor(new Request('http://local/api/health'), {
      draining: true,
      healthPaths: ['/internal/live'],
    });

    expect(health).toBeNull();
    expect(blocked?.status).toBe(503);
  });

  test('normalizes malformed Retry-After values while draining', () => {
    const nan = drainingResponseFor(new Request('http://local/api/search'), {
      draining: true,
      retryAfterSeconds: Number.NaN,
    });
    const fractional = drainingResponseFor(new Request('http://local/api/search'), {
      draining: true,
      retryAfterSeconds: 2.2,
    });

    expect(nan?.headers.get('Retry-After')).toBe('5');
    expect(fractional?.headers.get('Retry-After')).toBe('3');
  });

  test('runs every cleanup step and reports any cleanup failures', async () => {
    const calls: string[] = [];
    const warnings: string[] = [];

    await expect(runShutdownSteps([
      { name: 'first', run: () => calls.push('first') },
      { name: 'second', run: () => { calls.push('second'); throw new Error('boom'); } },
      { name: 'third', run: async () => { calls.push('third'); } },
    ], (message) => warnings.push(message))).rejects.toThrow('second: boom');

    expect(calls).toEqual(['first', 'second', 'third']);
    expect(warnings.join('\n')).toContain('second cleanup failed: boom');
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
