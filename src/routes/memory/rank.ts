import { memoryConfidence, type MemoryConfidence } from './confidence.ts';
import type { MemoryRecord } from './store.ts';

export type RankedMemory<T extends MemoryRecord = MemoryRecord> = T & {
  confidence: MemoryConfidence;
  ranking: {
    score: number;
    components: { match: number; confidence: number; heat: number; validTime: number; entity: number };
    strategy: 'valid_time_confidence_heat_entity_match';
  };
};

export type RankMemoryOptions = {
  mode?: 'keyword' | 'semantic';
  asOf?: string | number;
  now?: Date;
  score?: (memory: MemoryRecord) => number | undefined;
  entityScore?: (memory: MemoryRecord) => number | undefined;
};

export function rankMemories<T extends MemoryRecord>(
  memories: T[],
  options: RankMemoryOptions = {},
): Array<RankedMemory<T>> {
  const now = options.now ?? new Date();
  const asOf = parseTime(options.asOf) ?? now.getTime();
  return memories.map((memory, index) => {
    const match = clamp(options.score?.(memory) ?? keywordScore(memory));
    const confidence = memoryConfidence(memory, { mode: options.mode ?? 'keyword', semanticScore: match, now });
    const heat = heatScore(memory, now);
    const validTime = validTimeScore(memory, asOf);
    const entity = clamp(options.entityScore?.(memory) ?? entitySignal(memory));
    const score = round((match * 0.38) + (confidence.score * 0.22) + (heat * 0.18) + (validTime * 0.1) + (entity * 0.12));
    return {
      ...memory,
      confidence,
      ranking: {
        score,
        components: { match: round(match), confidence: confidence.score, heat: round(heat), validTime: round(validTime), entity: round(entity) },
        strategy: 'valid_time_confidence_heat_entity_match',
      },
      __rankIndex: index,
    } as RankedMemory<T> & { __rankIndex: number };
  }).sort((a, b) => b.ranking.score - a.ranking.score || a.__rankIndex - b.__rankIndex)
    .map(({ __rankIndex: _rankIndex, ...memory }) => memory as RankedMemory<T>);
}

function keywordScore(memory: MemoryRecord): number {
  const signals = [memory.title, memory.source, ...(memory.tags ?? [])].filter(Boolean).length;
  return clamp(0.55 + Math.min(0.25, signals * 0.05));
}

function heatScore(memory: MemoryRecord, now: Date): number {
  const usage = safeNumber(memory.usageCount);
  const usageSignal = usage > 0 ? clamp(Math.log1p(usage) / Math.log1p(20)) : 0;
  const accessed = parseTime(memory.lastAccessedAt);
  const recency = accessed ? clamp(0.5 ** (Math.max(0, now.getTime() - accessed) / 2_592_000_000)) : 0;
  return (usageSignal * 0.7) + (recency * 0.3);
}

function validTimeScore(memory: MemoryRecord, asOf: number): number {
  const from = parseTime(memory.validFrom) ?? parseTime(memory.createdAt) ?? asOf;
  const to = parseTime(memory.validTo);
  if (from > asOf || (to !== undefined && to <= asOf)) return 0;
  const ageDays = Math.max(0, (asOf - from) / 86_400_000);
  const recency = 0.5 ** (ageDays / 365);
  const bounded = to === undefined ? 0 : 0.1;
  return clamp(0.75 + bounded + (recency * 0.15));
}

function entitySignal(memory: MemoryRecord): number {
  const value = (memory as Record<string, unknown>).entityScore
    ?? (memory as Record<string, unknown>).entityMatchScore
    ?? (memory as Record<string, unknown>).entity_match_score;
  return safeNumber(value);
}

function parseTime(value: string | number | undefined): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function safeNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clamp(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
