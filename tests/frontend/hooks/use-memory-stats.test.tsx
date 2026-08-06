import { describe, expect, test } from 'bun:test';
import { fetchMemoryStats, normalizeMemoryStats, useMemoryStats } from '../../../frontend/src/hooks/useMemoryStats';
import { htmlFor } from '../_render';

const payload = {
  total: 4,
  active: 3,
  superseded: 1,
  heat_distribution: { cold: 1, warm: 1, hot: 2 },
  confidence_histogram: { low: 1, medium: 2, high: 1 },
  supersede_chain: { linked: 1, max_depth: 2 },
  valid_time_coverage: { count: 2, percent: 0.5 },
};

function StatsProbe() {
  const state = useMemoryStats({ initialStats: payload, initialLoading: false, fetcher: async () => new Response('{}') });
  return <span>{state.loading ? 'loading' : 'ready'}:{state.stats?.total}:{state.stats?.heat_distribution.hot}</span>;
}

describe('useMemoryStats hook and endpoint contract', () => {
  test('normalizes sparse memory stats payloads to dashboard-safe buckets', () => {
    expect(normalizeMemoryStats({ total: '2', heat_distribution: { hot: '1' }, valid_time_coverage: { percent: 2 } })).toEqual({
      total: 2,
      active: 0,
      superseded: 0,
      heat_distribution: { cold: 0, warm: 0, hot: 1 },
      confidence_histogram: { low: 0, medium: 0, high: 0 },
      supersede_chain: { linked: 0, max_depth: 0 },
      valid_time_coverage: { count: 0, percent: 1 },
    });
  });

  test('fetches /api/v1/memory/stats with JSON accept header', async () => {
    const calls: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
    const stats = await fetchMemoryStats({
      fetcher: (input, init) => {
        calls.push({ input, init });
        return new Response(JSON.stringify(payload), { status: 200 });
      },
    });

    expect(stats).toEqual(payload);
    expect(new URL(String(calls[0]?.input)).pathname).toBe('/api/v1/memory/stats');
    expect((calls[0]?.init?.headers as Record<string, string>).accept).toBe('application/json');
  });

  test('renders initial hook state for the dashboard shell', () => {
    expect(htmlFor(<StatsProbe />)).toContain('ready:4:2');
  });

  test('reports invalid JSON and non-ok stats responses', async () => {
    await expect(fetchMemoryStats({ fetcher: () => new Response('{bad') })).rejects.toThrow('/api/v1/memory/stats returned invalid JSON');
    await expect(fetchMemoryStats({ fetcher: () => new Response('{"error":"offline"}', { status: 503 }) })).rejects.toThrow('/api/v1/memory/stats returned 503: offline');
  });
});
