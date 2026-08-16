/**
 * The guard that keeps auto-start from making an outage worse.
 *
 * HTTP-proxy mode may legitimately point at another machine. If a *remote* Oracle is down and we
 * responded by spawning a *local* daemon, that daemon would open a different database, report
 * healthy, and answer every query with the wrong corpus — silently. A remote target that is down
 * must stay down and surface its own transport error.
 */
import { describe, expect, test } from 'bun:test';
import { ensureProxyTarget, isLocalDaemonTarget } from '../ensure-proxy-target.ts';
import { PORT } from '../../config.ts';

describe('isLocalDaemonTarget', () => {
  test('accepts the local daemon on our port', () => {
    expect(isLocalDaemonTarget(`http://localhost:${PORT}`)).toBe(true);
    expect(isLocalDaemonTarget(`http://127.0.0.1:${PORT}`)).toBe(true);
    expect(isLocalDaemonTarget(`http://[::1]:${PORT}/`)).toBe(true);
  });

  test('rejects a remote host even on our port — the case that would serve the wrong corpus', () => {
    expect(isLocalDaemonTarget(`http://black.local:${PORT}`)).toBe(false);
    expect(isLocalDaemonTarget(`https://oracle.example.com:${PORT}`)).toBe(false);
    expect(isLocalDaemonTarget(`http://192.168.1.123:${PORT}`)).toBe(false);
  });

  test('rejects localhost on a different port — that is someone else s server', () => {
    expect(isLocalDaemonTarget(`http://localhost:${PORT + 1}`)).toBe(false);
    expect(isLocalDaemonTarget('http://localhost')).toBe(false);
  });

  test('rejects garbage rather than throwing', () => {
    expect(isLocalDaemonTarget('not a url')).toBe(false);
    expect(isLocalDaemonTarget('')).toBe(false);
  });
});

describe('ensureProxyTarget', () => {
  test('is a no-op for a remote target: returns without attempting a local start', async () => {
    // If this ever tried to start a server it would hang on health polling or spawn a daemon;
    // resolving promptly is the assertion.
    await expect(ensureProxyTarget('http://black.local:47778')).resolves.toBeUndefined();
  });

  test('never throws, so an auto-start failure cannot turn a degraded Oracle into a dead one', async () => {
    await expect(ensureProxyTarget('nonsense://://')).resolves.toBeUndefined();
  });
});
