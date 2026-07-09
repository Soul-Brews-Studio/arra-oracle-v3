/** Env/config resolver for the optional embedder capability. */
import { createEmbeddingProvider } from './embeddings.ts';
import type { EmbedderConfig, EmbeddingProvider, EmbeddingProviderType } from './types.ts';

const VALID = new Set<EmbeddingProviderType>([
  'none',
  'local',
  'remote',
  'chromadb-internal',
  'ollama',
  'openai',
  'gemini',
  'cloudflare-ai',
]);

export function resolveEmbeddingProviderType(
  configured?: EmbeddingProviderType,
): EmbeddingProviderType {
  return resolveEmbeddingProviderSelection(configured).provider;
}

export type EmbeddingProviderSelection = {
  provider: EmbeddingProviderType;
  source: 'configured' | 'legacy-env' | 'env' | 'auto-default';
  explicit: boolean;
};

export type EmbedderRuntimeStatus = {
  status: 'unknown' | 'connected' | 'degraded';
  provider: EmbeddingProviderType;
  source: EmbeddingProviderSelection['source'];
  explicit: boolean;
  checkedAt?: string;
  reason?: string;
  consecutiveFailures?: number;
};

type ProbePreset = { provider?: string; model?: string; endpoint?: string; embedder?: EmbedderConfig };
type ProbeOptions = { timeoutMs?: number; text?: string };
type RuntimeProbeOptions = ProbeOptions & { force?: boolean; preset?: ProbePreset; ttlMs?: number; probe?: () => Promise<EmbedderRuntimeStatus> };

let runtimeStatus: EmbedderRuntimeStatus | null = null;
let runtimeProbe: Promise<EmbedderRuntimeStatus> | null = null;

export function resolveEmbeddingProviderSelection(
  configured?: EmbeddingProviderType,
): EmbeddingProviderSelection {
  if (configured) return selection(normalizeProvider(configured), 'configured', true);

  const legacy = process.env.ORACLE_EMBEDDING_PROVIDER as EmbeddingProviderType | undefined;
  if (legacy?.trim()) return selection(normalizeProvider(legacy), 'legacy-env', true);

  const raw = firstFilled(process.env.ORACLE_EMBEDDER, process.env.ORACLE_EMBEDDER_BACKEND, process.env.EMBEDDER_TYPE);
  if (raw) return selection(normalizeProvider(raw), 'env', true);

  return selection('ollama', 'auto-default', false);
}

export function resolveEmbeddingModel(configured?: string): string | undefined {
  return configured || process.env.ORACLE_EMBEDDING_MODEL;
}

export function resolveEmbeddingFallbackChain(configured?: EmbeddingProviderType[]): EmbeddingProviderType[] {
  if (configured?.length) return configured.map(normalizeProvider);
  const raw = process.env.ORACLE_EMBEDDER_CHAIN || process.env.ORACLE_EMBEDDING_FALLBACK_CHAIN;
  if (!raw) return [];
  return raw.split(',').map((item) => normalizeProvider(item)).filter((item) => item !== 'none');
}

export function getEmbedderRuntimeStatus(): EmbedderRuntimeStatus {
  if (runtimeStatus) return runtimeStatus;
  const selected = resolveEmbeddingProviderSelection();
  return { status: 'unknown', ...selected };
}

export function setEmbedderRuntimeStatus(status: EmbedderRuntimeStatus): EmbedderRuntimeStatus {
  runtimeStatus = status;
  return status;
}

export function clearEmbedderRuntimeStatusForTests(): void {
  runtimeStatus = null;
  runtimeProbe = null;
}

export function formatEmbedderDegradedWarning(provider: string, reason: string): string {
  return `[Oracle] embedder ${provider} unreachable (${reason}) → degraded to FTS5-only`;
}

export async function probeConfiguredEmbedder(
  preset?: ProbePreset,
  options: ProbeOptions = {},
): Promise<EmbedderRuntimeStatus> {
  const embedder = preset?.embedder;
  const selection = resolveEmbeddingProviderSelection(
    (preset?.provider as EmbeddingProviderType | undefined) ?? embedder?.backend,
  );
  if (shouldReportNoEmbedder(selection)) {
    return setEmbedderRuntimeStatus(degraded(selection, noEmbedderReason(selection)));
  }
  try {
    if (selection.provider === 'chromadb-internal') {
      return setEmbedderRuntimeStatus({ status: 'connected', ...selection, checkedAt: new Date().toISOString() });
    }
    const provider = createEmbeddingProvider(selection.provider, resolveEmbeddingModel(embedder?.model ?? preset?.model), {
      url: embedder?.url ?? preset?.endpoint,
      dimensions: embedder?.dimensions,
      fallbackChain: resolveEmbeddingFallbackChain(embedder?.fallbackChain ?? (embedder?.fallback ? [embedder.fallback] : undefined)),
    });
    return await probeEmbeddingProvider(provider, selection, options);
  } catch (error) {
    return setEmbedderRuntimeStatus(degraded(selection, reasonOf(error)));
  }
}

export async function readEmbedderRuntimeStatus(options: RuntimeProbeOptions = {}): Promise<EmbedderRuntimeStatus> {
  const ttlMs = positiveInt(process.env.ORACLE_EMBEDDER_STATUS_TTL_MS, options.ttlMs ?? 15_000);
  const checkedAt = runtimeStatus?.checkedAt ? Date.parse(runtimeStatus.checkedAt) : NaN;
  if (!options.force && runtimeStatus?.checkedAt && (!Number.isFinite(checkedAt) || Date.now() - checkedAt < ttlMs)) return runtimeStatus;
  if (runtimeProbe && !options.force) return runtimeProbe;
  runtimeProbe = (options.probe ? options.probe() : probeConfiguredEmbedder(options.preset, options))
    .finally(() => { runtimeProbe = null; });
  return runtimeProbe;
}

export function recordEmbedderRuntimeSuccess(selection: EmbeddingProviderSelection): EmbedderRuntimeStatus {
  return setEmbedderRuntimeStatus({ status: 'connected', ...selection, checkedAt: new Date().toISOString(), consecutiveFailures: 0 });
}

export function recordEmbedderRuntimeFailure(selection: EmbeddingProviderSelection, error: unknown): EmbedderRuntimeStatus {
  const failures = runtimeStatus?.provider === selection.provider ? (runtimeStatus.consecutiveFailures ?? 0) + 1 : 1;
  const threshold = positiveInt(process.env.ORACLE_EMBEDDER_FAILURE_THRESHOLD, 1);
  if (failures < threshold) {
    return setEmbedderRuntimeStatus({ ...getEmbedderRuntimeStatus(), ...selection, checkedAt: new Date().toISOString(), consecutiveFailures: failures });
  }
  return setEmbedderRuntimeStatus(degraded(selection, reasonOf(error), failures));
}

export function observeEmbeddingProvider(provider: EmbeddingProvider, selection: EmbeddingProviderSelection): EmbeddingProvider {
  return {
    get name() { return provider.name; },
    get dimensions() { return provider.dimensions; },
    async embed(texts, type) {
      try {
        const vectors = await provider.embed(texts, type);
        recordEmbedderRuntimeSuccess(selection);
        return vectors;
      } catch (error) {
        recordEmbedderRuntimeFailure(selection, error);
        throw error;
      }
    },
  };
}

export async function probeEmbeddingProvider(
  provider: EmbeddingProvider,
  selection: EmbeddingProviderSelection,
  options: ProbeOptions = {},
): Promise<EmbedderRuntimeStatus> {
  const timeoutMs = positiveInt(process.env.ORACLE_EMBEDDER_PROBE_TIMEOUT_MS, options.timeoutMs ?? 2_000);
  try {
    const pending = provider.embed([options.text ?? 'oracle embedder boot probe'], 'query');
    pending.catch(() => undefined);
    const vectors = await timeout(pending, timeoutMs);
    if (!vectors[0]?.length) throw new Error('probe returned no embedding');
    return setEmbedderRuntimeStatus({ status: 'connected', ...selection, checkedAt: new Date().toISOString() });
  } catch (error) {
    return setEmbedderRuntimeStatus(degraded(selection, reasonOf(error)));
  }
}

function normalizeProvider(raw?: string): EmbeddingProviderType {
  const value = (raw || 'none').trim().toLowerCase();
  if (value === 'disabled' || value === 'off' || value === 'zero') return 'none';
  if (value === 'http' || value === 'external') return 'remote';
  if (value === 'ollama-local') return 'local';
  if (VALID.has(value as EmbeddingProviderType)) return value as EmbeddingProviderType;

  console.warn(`[Embedder] Unknown provider '${raw}', falling back to none/FTS5.`);
  return 'none';
}

function firstFilled(...values: Array<string | undefined>): string | undefined {
  return values.map((value) => value?.trim()).find(Boolean);
}

function selection(
  provider: EmbeddingProviderType,
  source: EmbeddingProviderSelection['source'],
  explicit: boolean,
): EmbeddingProviderSelection {
  return { provider, source, explicit };
}

function degraded(selection: EmbeddingProviderSelection, reason: string, consecutiveFailures = 1): EmbedderRuntimeStatus {
  return { status: 'degraded', ...selection, reason: prettyReason(selection, reason), checkedAt: new Date().toISOString(), consecutiveFailures };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`probe timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function shouldReportNoEmbedder(selection: EmbeddingProviderSelection): boolean {
  if (selection.provider === 'none') return true;
  if (selection.provider !== 'ollama' && selection.provider !== 'local') return false;
  return !firstFilled(
    process.env.ORACLE_EMBEDDING_PROVIDER,
    process.env.ORACLE_EMBEDDER,
    process.env.ORACLE_EMBEDDER_BACKEND,
    process.env.EMBEDDER_TYPE,
    process.env.OLLAMA_BASE_URL,
    process.env.OLLAMA_HOST,
  );
}

function noEmbedderReason(selection: EmbeddingProviderSelection): string {
  return selection.provider === 'none' ? 'no embedder — FTS5-only' : 'no embedder configured/reachable — FTS5-only';
}

function prettyReason(selection: EmbeddingProviderSelection, reason: string): string {
  if (reason.includes('FTS5-only')) return reason;
  if (shouldReportNoEmbedder(selection)) return noEmbedderReason(selection);
  if (/required|missing|not configured|ECONNREFUSED|timed out|timeout|unable to connect|abort|failed to fetch/i.test(reason)) {
    return `no embedder configured/reachable — FTS5-only (${reason})`;
  }
  return reason;
}

function reasonOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, ' ').trim() || 'unknown';
}
