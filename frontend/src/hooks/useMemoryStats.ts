import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '../api/oracle';
export const MEMORY_STATS_ENDPOINT = '/api/v1/memory/stats';

export interface MemoryStatsBuckets {
  cold: number;
  warm: number;
  hot: number;
}

export interface MemoryConfidenceHistogram {
  low: number;
  medium: number;
  high: number;
}

export interface MemoryStatsResponse {
  total: number;
  active: number;
  superseded: number;
  heat_distribution: MemoryStatsBuckets;
  confidence_histogram: MemoryConfidenceHistogram;
  supersede_chain: { linked: number; max_depth: number };
  valid_time_coverage: { count: number; percent: number };
}

type MemoryStatsFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

type UseMemoryStatsOptions = {
  endpoint?: string;
  fetcher?: MemoryStatsFetch;
  initialStats?: MemoryStatsResponse | null;
  initialLoading?: boolean;
};

export type UseMemoryStatsResult = {
  stats: MemoryStatsResponse | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
};

const emptyBuckets = { cold: 0, warm: 0, hot: 0 };
const emptyHistogram = { low: 0, medium: 0, high: 0 };

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function bucket(source: unknown, key: 'cold' | 'warm' | 'hot'): number {
  return Math.max(0, numberValue(record(source)[key]));
}

function histogram(source: unknown, key: 'low' | 'medium' | 'high'): number {
  return Math.max(0, numberValue(record(source)[key]));
}

export function normalizeMemoryStats(payload: unknown): MemoryStatsResponse {
  const data = record(payload);
  const chain = record(data.supersede_chain);
  const coverage = record(data.valid_time_coverage);
  return {
    total: Math.max(0, numberValue(data.total)),
    active: Math.max(0, numberValue(data.active)),
    superseded: Math.max(0, numberValue(data.superseded)),
    heat_distribution: {
      cold: bucket(data.heat_distribution, 'cold'),
      warm: bucket(data.heat_distribution, 'warm'),
      hot: bucket(data.heat_distribution, 'hot'),
    },
    confidence_histogram: {
      low: histogram(data.confidence_histogram, 'low'),
      medium: histogram(data.confidence_histogram, 'medium'),
      high: histogram(data.confidence_histogram, 'high'),
    },
    supersede_chain: {
      linked: Math.max(0, numberValue(chain.linked)),
      max_depth: Math.max(0, numberValue(chain.max_depth)),
    },
    valid_time_coverage: {
      count: Math.max(0, numberValue(coverage.count)),
      percent: Math.max(0, Math.min(1, numberValue(coverage.percent))),
    },
  };
}

export async function fetchMemoryStats({
  endpoint = MEMORY_STATS_ENDPOINT,
  fetcher,
}: Pick<UseMemoryStatsOptions, 'endpoint' | 'fetcher'> = {}): Promise<MemoryStatsResponse> {
  const request = fetcher ?? globalThis.fetch?.bind(globalThis);
  if (!request) throw new Error(`${endpoint} is unreachable: fetch is unavailable`);
  let response: Response;
  try {
    response = await request(apiUrl(endpoint), { headers: { accept: 'application/json' } });
  } catch (error) {
    throw new Error(`${endpoint} is unreachable: ${messageFor(error)}`);
  }
  const text = await response.text();
  let payload: unknown = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`${endpoint} returned invalid JSON`);
  }
  if (!response.ok) {
    const detail = typeof record(payload).error === 'string' ? record(payload).error : response.statusText;
    throw new Error(`${endpoint} returned ${response.status}${detail ? `: ${detail}` : ''}`);
  }
  return normalizeMemoryStats(payload);
}

export function useMemoryStats({
  endpoint = MEMORY_STATS_ENDPOINT,
  fetcher,
  initialStats = null,
  initialLoading = true,
}: UseMemoryStatsOptions = {}): UseMemoryStatsResult {
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<Omit<UseMemoryStatsResult, 'reload'>>({
    stats: initialStats,
    loading: initialLoading,
    error: null,
  });
  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  useEffect(() => {
    if (!initialLoading) setState({ stats: initialStats, loading: false, error: null });
  }, [initialLoading, initialStats]);

  useEffect(() => {
    let active = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    fetchMemoryStats({ endpoint, fetcher })
      .then((stats) => active && setState({ stats, loading: false, error: null }))
      .catch((error) => active && setState((current) => ({ ...current, loading: false, error: messageFor(error) })));
    return () => { active = false; };
  }, [endpoint, fetcher, reloadKey]);

  return { ...state, reload };
}

export const EMPTY_MEMORY_STATS: MemoryStatsResponse = {
  total: 0,
  active: 0,
  superseded: 0,
  heat_distribution: emptyBuckets,
  confidence_histogram: emptyHistogram,
  supersede_chain: { linked: 0, max_depth: 0 },
  valid_time_coverage: { count: 0, percent: 0 },
};
