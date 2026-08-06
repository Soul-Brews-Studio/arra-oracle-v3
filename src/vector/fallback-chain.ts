import type { EmbeddingProvider, EmbedType } from './types.ts';

export interface FallbackProviderStats {
  attempts: number;
  failures: number;
  successes: number;
  lastError?: string;
}

export interface FallbackChainStats {
  attempts: number;
  failures: number;
  successes: number;
  activeProvider?: string;
  lastProvider?: string;
  providers: Record<string, FallbackProviderStats>;
}

export interface FallbackChainEvent {
  from: string;
  to?: string;
  error: string;
}

export interface EmbeddingFallbackChainOptions {
  backoffFactor?: number;
  initialBackoffMs?: number;
  logger?: (message: string) => void;
  maxBackoffMs?: number;
  onFallback?: (event: FallbackChainEvent) => void;
  sleep?: (ms: number) => Promise<void>;
  sticky?: boolean;
}

export class EmbeddingFallbackChain implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly backoffFactor: number;
  private readonly initialBackoffMs: number;
  private readonly logger: (message: string) => void;
  private readonly maxBackoffMs: number;
  private readonly onFallback?: (event: FallbackChainEvent) => void;
  private readonly providerStats: Record<string, FallbackProviderStats>;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly sticky: boolean;
  private activeIndex = 0;
  private attempts = 0;
  private failures = 0;
  private successes = 0;
  private lastProvider: string | undefined;

  constructor(
    private readonly providers: readonly EmbeddingProvider[],
    options: EmbeddingFallbackChainOptions = {},
  ) {
    if (providers.length === 0) throw new Error('EmbeddingFallbackChain requires at least one provider');
    this.name = providers.map((provider) => provider.name).join('>');
    this.dimensions = providers[0].dimensions;
    this.backoffFactor = options.backoffFactor ?? 2;
    this.initialBackoffMs = options.initialBackoffMs ?? 100;
    this.logger = options.logger ?? ((message) => console.info(message));
    this.maxBackoffMs = options.maxBackoffMs ?? 2_000;
    this.onFallback = options.onFallback;
    this.sleep = options.sleep ?? defaultSleep;
    this.sticky = options.sticky ?? true;
    this.providerStats = Object.fromEntries(providers.map((provider) => [
      provider.name,
      { attempts: 0, failures: 0, successes: 0 },
    ]));
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.attempts += 1;
    let lastError: unknown;
    const order = this.providerOrder();
    for (let attemptIndex = 0; attemptIndex < order.length; attemptIndex += 1) {
      const index = order[attemptIndex];
      const provider = this.providers[index];
      const stats = this.statsFor(provider.name);
      stats.attempts += 1;
      try {
        const vectors = await provider.embed(texts, type);
        stats.successes += 1;
        this.successes += 1;
        if (this.sticky) this.activeIndex = index;
        this.lastProvider = provider.name;
        this.logger(`[EmbeddingFallbackChain] provider '${provider.name}' succeeded`);
        return vectors;
      } catch (error) {
        lastError = error;
        const message = errorMessage(error);
        stats.failures += 1;
        stats.lastError = message;
        this.failures += 1;
        const next = this.providers[order[attemptIndex + 1]];
        this.logFallback({ from: provider.name, to: next?.name, error: message });
        if (next) await this.sleep(this.delayFor(attemptIndex));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  getStats(): FallbackChainStats {
    return {
      attempts: this.attempts,
      failures: this.failures,
      successes: this.successes,
      activeProvider: this.providers[this.activeIndex]?.name,
      lastProvider: this.lastProvider,
      providers: structuredClone(this.providerStats),
    };
  }

  private logFallback(event: FallbackChainEvent): void {
    this.onFallback?.(event);
    if (event.to) {
      this.logger(`[EmbeddingFallbackChain] provider '${event.from}' failed (${event.error}); falling back to '${event.to}'`);
      return;
    }
    this.logger(`[EmbeddingFallbackChain] provider '${event.from}' failed (${event.error}); no fallback provider remains`);
  }

  private providerOrder(): number[] {
    return this.providers.map((_, offset) => (this.activeIndex + offset) % this.providers.length);
  }

  private delayFor(failureIndex: number): number {
    return Math.min(
      this.initialBackoffMs * this.backoffFactor ** failureIndex,
      this.maxBackoffMs,
    );
  }

  private statsFor(provider: string): FallbackProviderStats {
    return this.providerStats[provider] ??= { attempts: 0, failures: 0, successes: 0 };
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
