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
  lastProvider?: string;
  providers: Record<string, FallbackProviderStats>;
}

export interface EmbeddingFallbackChainOptions {
  backoffFactor?: number;
  initialBackoffMs?: number;
  logger?: (message: string) => void;
  maxBackoffMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class EmbeddingFallbackChain implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly backoffFactor: number;
  private readonly initialBackoffMs: number;
  private readonly logger: (message: string) => void;
  private readonly maxBackoffMs: number;
  private readonly providerStats: Record<string, FallbackProviderStats>;
  private readonly sleep: (ms: number) => Promise<void>;
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
    this.sleep = options.sleep ?? defaultSleep;
    this.providerStats = Object.fromEntries(providers.map((provider) => [
      provider.name,
      { attempts: 0, failures: 0, successes: 0 },
    ]));
  }

  async embed(texts: string[], type?: EmbedType): Promise<number[][]> {
    this.attempts += 1;
    let lastError: unknown;
    for (let index = 0; index < this.providers.length; index += 1) {
      const provider = this.providers[index];
      const stats = this.statsFor(provider.name);
      stats.attempts += 1;
      try {
        const vectors = await provider.embed(texts, type);
        stats.successes += 1;
        this.successes += 1;
        this.lastProvider = provider.name;
        this.logger(`[EmbeddingFallbackChain] provider '${provider.name}' succeeded`);
        return vectors;
      } catch (error) {
        lastError = error;
        stats.failures += 1;
        stats.lastError = errorMessage(error);
        this.failures += 1;
        if (index < this.providers.length - 1) await this.sleep(this.delayFor(index));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  getStats(): FallbackChainStats {
    return {
      attempts: this.attempts,
      failures: this.failures,
      successes: this.successes,
      lastProvider: this.lastProvider,
      providers: structuredClone(this.providerStats),
    };
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
