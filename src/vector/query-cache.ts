export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface QueryCacheOptions {
  ttlMs?: number;
  now?: () => number;
  maxEntries?: number;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_MAX_ENTRIES = 256;

export class QueryCache<T> {
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxEntries: number;
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(options: QueryCacheOptions = {}) {
    this.ttlMs = positiveNumber(options.ttlMs, DEFAULT_TTL_MS);
    this.now = options.now ?? Date.now;
    this.maxEntries = nonNegativeInteger(options.maxEntries, DEFAULT_MAX_ENTRIES);
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  stats(): { size: number; maxEntries: number; ttlMs: number } {
    return { size: this.entries.size, maxEntries: this.maxEntries, ttlMs: this.ttlMs };
  }
}

export function stableCacheKey(parts: Record<string, unknown>): string {
  return JSON.stringify(stableValue(parts));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isPlainRecord(value)) return value;
  return Object.keys(value).sort().map((key) => [key, stableValue(value[key])]);
}

function positiveNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}
