import type { MemoryRecord } from './store.ts';

export type MemoryConfidence = {
  score: number;
  label: 'high' | 'medium' | 'low';
  ageDays: number;
  freshness: number;
  components: {
    match: number;
    freshness: number;
    provenance: number;
  };
  warnings: string[];
  reasons: string[];
};

type ConfidenceMode = 'keyword' | 'semantic';

type MemoryConfidenceOptions = {
  mode?: ConfidenceMode;
  now?: Date;
  semanticScore?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ANCHORED_HALF_LIFE_DAYS = 139;
const UNVALIDATED_HALF_LIFE_DAYS = 30;

export function memoryConfidence(
  memory: MemoryRecord,
  options: MemoryConfidenceOptions = {},
): MemoryConfidence {
  const now = options.now ?? new Date();
  const ageDays = daysSince(memory.updatedAt || memory.createdAt, now);
  const hasSource = Boolean(memory.source);
  const hasTags = Boolean(memory.tags?.length);
  const hasTitle = Boolean(memory.title);
  const halfLife = hasSource || hasTags ? ANCHORED_HALF_LIFE_DAYS : UNVALIDATED_HALF_LIFE_DAYS;
  const freshness = clamp(0.5 ** (ageDays / halfLife));
  const match = clamp(options.semanticScore ?? (options.mode === 'semantic' ? 0.6 : 0.65));
  const provenance = Math.min(1, (hasSource ? 0.45 : 0) + (hasTags ? 0.35 : 0) + (hasTitle ? 0.2 : 0));
  const score = round(clamp((match * 0.5) + (freshness * 0.3) + (provenance * 0.2)));

  return {
    score,
    label: score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low',
    ageDays: round(ageDays),
    freshness: round(freshness),
    components: {
      match: round(match),
      freshness: round(freshness),
      provenance: round(provenance),
    },
    warnings: warnings(ageDays, match, hasSource, hasTags),
    reasons: reasons(options.mode ?? 'keyword', hasSource, hasTags, halfLife),
  };
}

export const MEMORY_CONFIDENCE_STRATEGY = {
  stored: false,
  strategy: 'query-time-confidence',
  signals: ['match_score', 'freshness_decay', 'source', 'tags', 'title'],
};

function daysSince(value: string, now: Date): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, (now.getTime() - timestamp) / DAY_MS);
}

function reasons(mode: ConfidenceMode, hasSource: boolean, hasTags: boolean, halfLifeDays: number): string[] {
  return [
    'computed_at_query_time',
    `${mode}_match`,
    hasSource ? 'source_present' : 'source_missing',
    hasTags ? 'tags_present' : 'tags_missing',
    `freshness_half_life_${halfLifeDays}d`,
  ];
}

function warnings(ageDays: number, match: number, hasSource: boolean, hasTags: boolean): string[] {
  const list: string[] = [];
  if (!hasSource) list.push('missing_source');
  if (!hasTags) list.push('missing_tags');
  if (!hasSource && !hasTags) list.push('unanchored_memory');
  if (!hasSource && !hasTags && ageDays >= UNVALIDATED_HALF_LIFE_DAYS) list.push('stale_unvalidated');
  if (match < 0.45) list.push('low_match_score');
  return list;
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
