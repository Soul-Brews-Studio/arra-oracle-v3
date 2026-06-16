import type { EmbeddingProviderType } from './types.ts';

export type CostWindow = 'daily' | 'weekly' | 'monthly';
export type CostProvider = Extract<EmbeddingProviderType, 'openai' | 'gemini' | 'ollama' | 'local' | 'remote' | 'cloudflare-ai'>;

export interface UsageEvent {
  apiCalls: number;
  inputTokens: number;
  provider: CostProvider;
  timestamp: string;
}

export interface UsageRecordInput {
  apiCalls?: number;
  inputTokens: number;
  provider: CostProvider;
  timestamp?: Date | string;
}

export interface ProviderCostSummary {
  apiCalls: number;
  estimatedUsd: number;
  inputTokens: number;
  provider: CostProvider;
}

export interface CostBreakdown {
  apiCalls: number;
  estimatedUsd: number;
  inputTokens: number;
  providers: Record<string, ProviderCostSummary>;
  window: CostWindow;
}

const DEFAULT_RATES: Record<CostProvider, number> = {
  openai: 0.02,
  gemini: 0,
  ollama: 0,
  local: 0,
  remote: 0,
  'cloudflare-ai': 0.008,
};

export class CostEstimator {
  private readonly events: UsageEvent[] = [];
  private readonly now: () => Date;
  private readonly rates: Record<CostProvider, number>;

  constructor(options: { now?: () => Date; rates?: Partial<Record<CostProvider, number>> } = {}) {
    this.now = options.now ?? (() => new Date());
    this.rates = { ...DEFAULT_RATES, ...options.rates };
  }

  record(input: UsageRecordInput): UsageEvent {
    const event = {
      provider: input.provider,
      inputTokens: Math.max(0, Math.floor(input.inputTokens)),
      apiCalls: Math.max(1, Math.floor(input.apiCalls ?? 1)),
      timestamp: normalizeDate(input.timestamp ?? this.now()).toISOString(),
    };
    this.events.push(event);
    return event;
  }

  getBreakdown(reference = this.now()): Record<CostWindow, CostBreakdown> {
    return {
      daily: this.summarize('daily', startOfDay(reference)),
      weekly: this.summarize('weekly', daysAgo(reference, 7)),
      monthly: this.summarize('monthly', daysAgo(reference, 30)),
    };
  }

  getRates(): Record<CostProvider, number> {
    return { ...this.rates };
  }

  getUsage(): UsageEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  private summarize(window: CostWindow, since: Date): CostBreakdown {
    const providers: Record<string, ProviderCostSummary> = {};
    for (const event of this.events) {
      if (normalizeDate(event.timestamp) < since) continue;
      const summary = providers[event.provider] ??= {
        provider: event.provider,
        inputTokens: 0,
        apiCalls: 0,
        estimatedUsd: 0,
      };
      summary.inputTokens += event.inputTokens;
      summary.apiCalls += event.apiCalls;
      summary.estimatedUsd = costFor(summary.inputTokens, this.rates[event.provider]);
    }
    const totals = Object.values(providers).reduce((acc, item) => ({
      inputTokens: acc.inputTokens + item.inputTokens,
      apiCalls: acc.apiCalls + item.apiCalls,
      estimatedUsd: acc.estimatedUsd + item.estimatedUsd,
    }), { inputTokens: 0, apiCalls: 0, estimatedUsd: 0 });
    return {
      window,
      inputTokens: totals.inputTokens,
      apiCalls: totals.apiCalls,
      estimatedUsd: roundUsd(totals.estimatedUsd),
      providers,
    };
  }
}

function costFor(tokens: number, ratePerMillion: number): number {
  return roundUsd((tokens / 1_000_000) * ratePerMillion);
}

function daysAgo(reference: Date, days: number): Date {
  return new Date(reference.getTime() - days * 24 * 60 * 60 * 1000);
}

function normalizeDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function roundUsd(value: number): number {
  return Number(value.toFixed(6));
}

function startOfDay(reference: Date): Date {
  return new Date(reference.getFullYear(), reference.getMonth(), reference.getDate());
}
