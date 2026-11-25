/** Hub UI display helpers (#3110): masking, tabs, relative time. */
import { describe, expect, test } from 'bun:test';
import { ago, GRANTS, maskIp, maskUrl, stateTone, tabFromHash } from '../../../frontend/src/hub/format';

describe('hub UI format', () => {
  test('addresses are masked to 100.x.x.x', () => {
    expect(maskIp('100.111.101.21')).toBe('100.x.x.x');
    expect(maskIp('::ffff:192.168.1.4')).toBe('192.x.x.x');
    expect(maskIp('fd7a:115c:a1e0::1')).toBe('fd7a:x');
    expect(maskIp(null)).toBe('-');
    expect(maskUrl('http://100.1.2.3:47778')).toBe('http://100.x.x.x:47778');
    expect(maskUrl('http://box.example.ts.net:47778')).not.toContain('example');
  });
  test('tabs come from the hash, unknown ones fall back to status', () => {
    expect(tabFromHash('#/nodes')).toBe('nodes');
    expect(tabFromHash('#invite')).toBe('invite');
    expect(tabFromHash('#/nope')).toBe('status');
    expect(tabFromHash('')).toBe('status');
  });
  test('grants match the CLI --for values', () => {
    expect([...GRANTS]).toEqual(['15m', '1h', '7d', 'forever']);
  });
  test('relative time and state colours', () => {
    const now = Date.parse('2026-11-25T10:00:00Z');
    expect(ago('2026-11-25T09:59:30Z', now)).toBe('30s ago');
    expect(ago('2026-11-25T07:00:00Z', now)).toBe('3h ago');
    expect(ago(null, now)).toBe('never');
    expect(stateTone('active')).toBe('success');
    expect(stateTone('expired')).toBe('warning');
    expect(stateTone('revoked')).toBe('danger');
    expect(stateTone('used')).toBe('neutral');
  });
});
