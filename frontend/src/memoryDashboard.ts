import { apiFetch } from './api';
import type { ProvenanceSearchResult } from './components/searchResultView';

export type MemoryConfidence = {
  score: number;
  label?: string;
  freshness?: number;
  usageCount?: number;
  lastAccessedAgeDays?: number;
  components?: { match?: number; freshness?: number; provenance?: number; usage?: number };
  warnings?: string[];
  reasons?: string[];
};

export type RankedMemory = {
  id: string;
  content: string;
  title?: string;
  tags?: string[];
  source?: string;
  createdAt: string;
  updatedAt: string;
  validFrom?: string;
  validTo?: string;
  validUntil?: string;
  supersededAt?: string;
  supersededReason?: string;
  confidence: MemoryConfidence;
  ranking?: {
    score: number;
    components?: { match?: number; confidence?: number; heat?: number; validTime?: number };
    strategy?: string;
  };
};

export type MemoryRecallResponse = {
  query?: string;
  asOf?: string;
  total: number;
  items: RankedMemory[];
  error?: string;
};

export type MemoryDashboardSummary = {
  total: number;
  sourceCoverage: number;
  avgConfidence: number;
  avgHeat: number;
  avgProvenance: number;
  validWindowCount: number;
  highConfidenceCount: number;
};

function bounded(value: unknown): number {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0;
}

function average(items: RankedMemory[], signal: (memory: RankedMemory) => number): number {
  return items.length ? items.reduce((sum, item) => sum + signal(item), 0) / items.length : 0;
}

export function percentText(value: number): string {
  return `${Math.round(bounded(value) * 100)}%`;
}

export function memoryHeat(memory: RankedMemory): number {
  return bounded(memory.ranking?.components?.heat ?? memory.confidence.components?.usage);
}

export function validTimeScore(memory: RankedMemory): number {
  return bounded(memory.ranking?.components?.validTime ?? (memory.validFrom || memory.validTo || memory.validUntil ? 1 : 0.75));
}

export function memoryDashboardSummary(items: RankedMemory[]): MemoryDashboardSummary {
  return {
    total: items.length,
    sourceCoverage: average(items, (item) => item.source ? 1 : 0),
    avgConfidence: average(items, (item) => bounded(item.confidence.score)),
    avgHeat: average(items, memoryHeat),
    avgProvenance: average(items, (item) => bounded(item.confidence.components?.provenance)),
    validWindowCount: items.filter((item) => Boolean(item.validFrom || item.validTo || item.validUntil)).length,
    highConfidenceCount: items.filter((item) => item.confidence.label === 'high' || item.confidence.score >= 0.75).length,
  };
}

export function memoryPreview(content: string, maxLength = 220): string {
  const compact = content.replace(/\s+/g, ' ').trim() || 'No memory preview returned.';
  return compact.length > maxLength ? `${compact.slice(0, maxLength - 1).trimEnd()}…` : compact;
}

export function shortDate(value?: string): string {
  if (!value) return 'open';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : value;
}

export function validTimeWindow(memory: RankedMemory): string {
  const start = memory.validFrom || memory.createdAt;
  const end = memory.validTo || memory.validUntil;
  return end ? `valid ${shortDate(start)} → ${shortDate(end)}` : `valid since ${shortDate(start)}`;
}

export function memoryToSignalResult(memory: RankedMemory): ProvenanceSearchResult {
  return {
    id: memory.id,
    content: memory.content,
    title: memory.title,
    type: 'memory',
    source: 'memory',
    source_file: memory.source || `memory:${memory.id}`,
    concepts: memory.tags ?? [],
    score: memory.ranking?.score ?? memory.confidence.score,
    memorySource: memory.source,
    usageCount: memory.confidence.usageCount,
    confidence: {
      ...memory.confidence,
      components: { ...memory.confidence.components, usage: memoryHeat(memory) },
    },
    rankingScore: memory.ranking?.score,
    superseded_at: memory.supersededAt,
    superseded_reason: memory.supersededReason,
    valid_time: memory.validFrom || memory.createdAt,
    valid_until: memory.validTo || memory.validUntil,
    tags: memory.tags,
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  };
}

export async function fetchMemoryRecall(params: { q?: string; asOf?: string; limit?: number } = {}): Promise<MemoryRecallResponse> {
  const qs = new URLSearchParams({ limit: String(params.limit ?? 50) });
  if (params.q?.trim()) qs.set('q', params.q.trim());
  if (params.asOf?.trim()) qs.set('asOf', params.asOf.trim());
  const response = await apiFetch(`/api/memory/recall?${qs}`);
  const data = await response.json() as MemoryRecallResponse;
  if (!response.ok) throw new Error(data.error || `/api/memory/recall returned ${response.status}`);
  return { ...data, items: Array.isArray(data.items) ? data.items : [], total: Number.isFinite(data.total) ? data.total : 0 };
}
