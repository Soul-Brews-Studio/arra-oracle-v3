import { describe, expect, test } from 'bun:test';
import { isLoopback, isPrivateIp, peerIp, stampPeerIp, PEER_IP_HEADER } from '../net.ts';
import { expiryFrom, hashInviteCode, newInviteCode, newNodeToken, parseDuration, sameHash, timeLeft } from '../tokens.ts';

describe('private address check (hub door layer 2)', () => {
  test('accepts loopback, LAN, tailnet v4 and tailnet v6', () => {
    for (const ip of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255',
      '192.168.1.117', '100.64.0.1', '100.127.255.254', 'fd7a:115c:a1e0::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test('refuses public and look-alike addresses', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '100.128.0.1', '100.63.255.255', '192.169.0.1', '2001:db8::1', '', 'not-an-ip']) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });

  test('loopback is only 127/8 and ::1', () => {
    expect(isLoopback('127.9.9.9')).toBe(true);
    expect(isLoopback('100.64.0.1')).toBe(false);
    expect(isLoopback(null)).toBe(false);
  });

  test('the stamped peer address overwrites whatever the client sent', () => {
    const forged = new Request('http://x/api', { headers: { [PEER_IP_HEADER]: '127.0.0.1' } });
    expect(peerIp(stampPeerIp(forged, '8.8.8.8'))).toBe('8.8.8.8');
    expect(peerIp(stampPeerIp(forged, undefined))).toBeNull();
  });

  test('a stamped POST keeps its body (a Request copy hung on POST through Bun.serve)', async () => {
    const server = Bun.serve({ port: 0, fetch: async (raw, srv) => {
      const req = stampPeerIp(raw, srv.requestIP(raw)?.address);
      return new Response(`${peerIp(req)}|${await req.text()}`);
    } });
    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/`, { method: 'POST', body: 'hello', headers: { [PEER_IP_HEADER]: 'forged' } });
      const [ip, body] = (await res.text()).split('|');
      expect(isLoopback(ip)).toBe(true);
      expect(body).toBe('hello');
    } finally {
      server.stop(true);
    }
  });
});

describe('codes, tokens, durations', () => {
  test('invite codes are 3 groups of 4 and hash the same however they are typed', () => {
    const code = newInviteCode();
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(sameHash(hashInviteCode(code), hashInviteCode(` ${code.toLowerCase()} `))).toBe(true);
    expect(sameHash(hashInviteCode(code), hashInviteCode(newInviteCode()))).toBe(false);
  });

  test('node tokens are long and distinct', () => {
    const a = newNodeToken();
    expect(a.startsWith('arra_node_')).toBe(true);
    expect(a.length).toBeGreaterThan(40);
    expect(a).not.toBe(newNodeToken());
  });

  test('durations', () => {
    expect(parseDuration('15m')).toBe(900_000);
    expect(parseDuration('1h')).toBe(3_600_000);
    expect(parseDuration('7d')).toBe(604_800_000);
    expect(parseDuration('forever')).toBeNull();
    expect(() => parseDuration('soon')).toThrow('invalid duration');
    expect(() => parseDuration('0m')).toThrow('more than 0');
    const now = new Date('2026-11-25T00:00:00Z');
    expect(expiryFrom('15m', now)).toBe('2026-11-25T00:15:00.000Z');
    expect(expiryFrom('forever', now)).toBeNull();
  });

  test('time left reads well in a table', () => {
    const now = new Date('2026-11-25T00:00:00Z');
    expect(timeLeft(null, now)).toBe('forever');
    expect(timeLeft('2026-11-25T00:14:10Z', now)).toBe('15m left');
    expect(timeLeft('2026-11-24T23:00:00Z', now)).toBe('expired');
    expect(timeLeft('2026-12-02T00:00:00Z', now)).toBe('7d left');
  });
});
