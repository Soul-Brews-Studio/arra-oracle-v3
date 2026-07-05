import type { EmbedderConfig } from './types.ts';
import type { VectorCollectionConfig, VectorModelRegistryEntry, VectorServerConfig } from './config-types.ts';

function embedderFor(config: VectorServerConfig, col: VectorCollectionConfig): EmbedderConfig | undefined {
  const generated = col.embedder?.backend === 'ollama' && col.embedder.model === col.model && col.provider === 'ollama';
  const merged = config.embedder && generated ? { ...col.embedder, ...config.embedder }
    : config.embedder || col.embedder ? { ...config.embedder, ...col.embedder } : undefined;
  const primary = col.embedder && !generated
    ? col.embedder.backend ?? col.embedder.default ?? config.embedder?.backend ?? config.embedder?.default
    : config.embedder?.backend ?? config.embedder?.default ?? col.embedder?.backend ?? col.embedder?.default;
  if (merged) return { ...merged, backend: primary ?? 'none', model: merged.model ?? col.model };
  const provider = col.provider.toLowerCase();
  if (provider === 'ollama') return { backend: 'ollama', model: col.model };
  if (provider === 'local') return { backend: 'local', model: col.model };
  if (provider === 'openai' || provider === 'gemini' || provider === 'cloudflare-ai') return { backend: provider, model: col.model };
  if (provider === 'remote') return { backend: 'remote', model: col.model };
  if (provider === 'none') return { backend: 'none' };
  return undefined;
}

export function resolveServiceEndpoint(config: VectorServerConfig, serviceName?: string): string | undefined {
  if (!serviceName) return undefined;
  const svc = config.storage?.services[serviceName];
  return svc?.type === 'proxy' ? svc.endpoint : undefined;
}

export function configToModels(config: VectorServerConfig): Record<string, VectorModelRegistryEntry> {
  const out: Record<string, VectorModelRegistryEntry> = {};
  for (const [key, col] of Object.entries(config.collections)) {
    if (col.enabled === false) continue;
    out[key] = {
      collection: col.collection,
      model: col.model,
      adapter: col.adapter || 'lancedb',
      provider: col.provider,
      service: col.service,
      endpoint: col.endpoint || resolveServiceEndpoint(config, col.service),
      pythonVersion: col.pythonVersion,
      qdrantUrl: col.qdrantUrl,
      qdrantApiKey: col.qdrantApiKey,
      dataPath: col.dataPath || config.dataPath || undefined,
      embedder: embedderFor(config, col),
    };
  }
  return out;
}
