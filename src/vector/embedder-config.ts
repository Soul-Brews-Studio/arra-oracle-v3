/** Env/config resolver for the optional embedder capability. */
import type { EmbeddingProviderType } from './types.ts';

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
  if (configured) return configured;

  const legacy = process.env.ORACLE_EMBEDDING_PROVIDER as EmbeddingProviderType | undefined;
  if (legacy) return normalizeProvider(legacy);

  return normalizeProvider(process.env.ORACLE_EMBEDDER || process.env.ORACLE_EMBEDDER_BACKEND || process.env.EMBEDDER_TYPE);
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

function normalizeProvider(raw?: string): EmbeddingProviderType {
  const value = (raw || 'none').trim().toLowerCase();
  if (value === 'disabled' || value === 'off' || value === 'zero') return 'none';
  if (value === 'http' || value === 'external') return 'remote';
  if (value === 'ollama-local') return 'local';
  if (VALID.has(value as EmbeddingProviderType)) return value as EmbeddingProviderType;

  console.warn(`[Embedder] Unknown provider '${raw}', falling back to none/FTS5.`);
  return 'none';
}
