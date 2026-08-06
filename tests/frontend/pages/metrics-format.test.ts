import { describe, expect, test } from 'bun:test';
import { formatBytes, formatDuration } from '../../../frontend/src/pages/MetricsPage';

describe('metrics formatting helpers', () => {
  test('formats durations and bytes for dashboard cards', () => {
    expect(formatDuration(12.4)).toBe('12s');
    expect(formatDuration(125)).toBe('2m 5s');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(16 * 1024 * 1024)).toBe('16 MB');
  });
});
