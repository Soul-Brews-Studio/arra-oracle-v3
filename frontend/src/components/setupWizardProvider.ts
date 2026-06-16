import type { Provider, VectorConfig } from './setupWizardTypes';

export function recommendedProvider(providers: Provider[]): Provider | undefined {
  return providers.find((provider) => provider.available || provider.configured) ?? providers[0];
}

export function buildProviderConfigPatch(config: VectorConfig | null, provider: string): Record<string, unknown> {
  const collections = Object.fromEntries(
    Object.entries(config?.config?.collections ?? {}).map(([key, collection]) => [
      key,
      { ...collection, provider },
    ]),
  );
  const embedder = config?.config?.embedder && typeof config.config.embedder === 'object' && !Array.isArray(config.config.embedder)
    ? { ...config.config.embedder, default: provider }
    : { default: provider };
  return {
    embedder,
    ...(Object.keys(collections).length ? { collections } : {}),
  };
}
