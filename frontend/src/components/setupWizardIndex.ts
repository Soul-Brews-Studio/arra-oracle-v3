import { apiFetch } from '../api';
import type { VectorConfig, VectorIndexSource } from './setupWizardTypes';

export type IndexStartBody = {
  model: string;
  source: VectorIndexSource;
  repoRoot?: string;
};

export function primaryCollectionKey(config: VectorConfig | null): string | null {
  const collections = Object.entries(config?.config?.collections ?? {});
  return collections.find(([, item]) => item.enabled !== false)?.[0] ?? collections[0]?.[0] ?? null;
}

export function buildIndexStartBody(
  config: VectorConfig | null,
  source: VectorIndexSource,
  repoRoot: string,
): IndexStartBody | { error: string } {
  const model = primaryCollectionKey(config);
  if (!model) return { error: 'No vector collection is configured yet. Open Vector Settings to add one.' };
  const path = repoRoot.trim();
  return {
    model,
    source,
    ...(path && source !== 'sqlite' ? { repoRoot: path } : {}),
  };
}

export async function requestVectorIndexStart(body: IndexStartBody): Promise<void> {
  await apiFetch('/api/v1/vector/index/start', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
