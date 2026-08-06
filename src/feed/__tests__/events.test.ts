import { describe, expect, test } from 'bun:test';
import { formatLocalFeedLine, normalizeFeedLimit, parseLocalEvent, parseMawEvent } from '../events.ts';

describe('feed event helpers', () => {
  test('strictly normalizes limits', () => {
    expect(normalizeFeedLimit(undefined)).toBe(50);
    expect(normalizeFeedLimit(' 3 ')).toBe(3);
    expect(normalizeFeedLimit('3abc')).toBe(50);
    expect(normalizeFeedLimit('0')).toBe(50);
    expect(normalizeFeedLimit('500')).toBe(200);
  });

  test('parses tenant and legacy local events with delimiter-heavy messages', () => {
    const tenant = parseLocalEvent('2026-06-17 10:00:00 | t1 | oracle | host | notice | project | s1 » message with | pipe and » marker');
    const legacy = parseLocalEvent('2026-06-17 10:00:01 | legacy | host | notice | project | s2 » legacy with | pipe', 'fallback');

    expect(tenant).toMatchObject({ tenant_id: 't1', oracle: 'oracle', session_id: 's1', message: 'message with | pipe and » marker' });
    expect(legacy).toMatchObject({ tenant_id: 'fallback', oracle: 'legacy', session_id: 's2', message: 'legacy with | pipe' });
  });

  test('formats local lines without allowing blank required fields or line injection', () => {
    expect(() => formatLocalFeedLine({ timestamp: '2026-06-17 10:00:00', tenantId: 't1', oracle: ' ', host: 'h', event: 'notice' }))
      .toThrow('oracle is required');

    const line = formatLocalFeedLine({
      timestamp: '2026-06-17 10:00:00',
      tenantId: 't1',
      oracle: 'or\nacle',
      host: 'h',
      event: 'notice | bad',
      project: 'proj » bad',
      sessionId: 's\r\n1',
      message: 'line one\nline two with | pipe and » marker',
    });
    const parsed = parseLocalEvent(line);

    expect(line).not.toContain('\nline two');
    expect(parsed).toMatchObject({
      oracle: 'or acle',
      event: 'notice bad',
      project: 'proj bad',
      session_id: 's 1',
      message: 'line one line two with | pipe and » marker',
    });
  });

  test('parses maw events only when required fields are nonblank strings', () => {
    expect(parseMawEvent({ oracle: ' ', event: 'notice' })).toBeUndefined();
    expect(parseMawEvent({ oracle: 'claude', event: ' notice ', tenantId: ' t1 ', ts: '2026-06-17T01:02:03Z' }))
      .toMatchObject({ oracle: 'claude', event: 'notice', tenant_id: 't1', timestamp: '2026-06-17 01:02:03' });
  });
});
