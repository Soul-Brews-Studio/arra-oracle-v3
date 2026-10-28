import { describe, expect, test } from 'bun:test';
import { resolveServerHostname } from '../../src/server-host.ts';

describe('resolveServerHostname', () => {
  test('defaults to loopback when ORACLE_HOST is unset or blank', () => {
    expect(resolveServerHostname({})).toBe('127.0.0.1');
    expect(resolveServerHostname({ ORACLE_HOST: '  ' })).toBe('127.0.0.1');
  });

  test('uses ORACLE_HOST when set', () => {
    expect(resolveServerHostname({ ORACLE_HOST: '0.0.0.0' })).toBe('0.0.0.0');
  });

  test('a live server on the default does not answer on a non-loopback address', async () => {
    const server = Bun.serve({ port: 0, hostname: resolveServerHostname({}), fetch: () => new Response('ok') });
    try {
      expect(server.hostname).toBe('127.0.0.1');
      expect(await (await fetch(`http://127.0.0.1:${server.port}/`)).text()).toBe('ok');
    } finally {
      server.stop(true);
    }
  });
});
