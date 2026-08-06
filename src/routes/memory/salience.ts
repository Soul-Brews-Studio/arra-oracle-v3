export type MemoryTier = 'core' | 'warm' | 'cold';

export type MemorySalienceInput = {
  tier?: string | null;
  createdAt: string;
  updatedAt: string;
  usageCount?: number | null;
  lastAccessedAt?: string | null;
};

export type MemorySalience = {
  tier: MemoryTier;
  heatScore: number;
  migration: 'stable' | 'promote' | 'demote';
};

const DAY_MS = 24 * 60 * 60 * 1000;
const CORE_THRESHOLD = 0.72;
const WARM_THRESHOLD = 0.22;
const CORE_HYSTERESIS = 0.56;
const COLD_HYSTERESIS = 0.28;
const TIERS = new Set<MemoryTier>(['core', 'warm', 'cold']);

export function normalizeMemoryTier(value: unknown, fallback: MemoryTier = 'warm'): MemoryTier {
  return typeof value === 'string' && TIERS.has(value as MemoryTier) ? value as MemoryTier : fallback;
}

export function memorySalience(input: MemorySalienceInput, now = new Date()): MemorySalience {
  const current = normalizeMemoryTier(input.tier);
  const heatScore = heatScoreFor(input, now);
  const tier = nextTier(current, heatScore);
  return { tier, heatScore, migration: migration(current, tier) };
}

export function heatScoreFor(input: MemorySalienceInput, now = new Date()): number {
  const usage = safeUsage(input.usageCount);
  const visitScore = usage ? clamp(Math.log1p(usage) / Math.log1p(24)) : 0;
  const lastAccessedDays = daysSince(input.lastAccessedAt, now);
  const accessRecency = lastAccessedDays === undefined ? 0 : decay(lastAccessedDays, 14);
  const updatedDays = daysSince(input.updatedAt || input.createdAt, now) ?? 0;
  const freshness = decay(updatedDays, 60);
  return round(clamp((visitScore * 0.5) + (accessRecency * 0.24) + (freshness * 0.26)));
}

function nextTier(current: MemoryTier, heat: number): MemoryTier {
  if (heat >= CORE_THRESHOLD || (current === 'core' && heat >= CORE_HYSTERESIS)) return 'core';
  if (heat >= WARM_THRESHOLD || (current === 'warm' && heat >= COLD_HYSTERESIS)) return 'warm';
  return 'cold';
}

function migration(from: MemoryTier, to: MemoryTier): MemorySalience['migration'] {
  if (from === to) return 'stable';
  return tierRank(to) > tierRank(from) ? 'promote' : 'demote';
}

function tierRank(tier: MemoryTier): number {
  return tier === 'core' ? 2 : tier === 'warm' ? 1 : 0;
}

function safeUsage(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function daysSince(value: string | null | undefined, now: Date): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, (now.getTime() - timestamp) / DAY_MS);
}

function decay(days: number, halfLifeDays: number): number {
  return clamp(0.5 ** (days / halfLifeDays));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
