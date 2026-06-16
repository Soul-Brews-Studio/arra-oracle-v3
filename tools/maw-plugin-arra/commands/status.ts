import { requestJson, resolveApiBase } from './http.ts';

type CollectionHealth = {
  ok?: boolean;
  status?: string;
  adapter?: string;
  model?: string;
  enabled?: boolean;
  error?: string;
};

type ConfigCollection = {
  key?: string;
  collection?: string;
  count?: number;
  adapter?: string;
  model?: string;
  enabled?: boolean;
  status?: string;
  ok?: boolean;
  error?: string;
};

type ConfigResponse = {
  collections?: ConfigCollection[];
  doc_counts?: Record<string, number>;
  health?: Record<string, CollectionHealth>;
  checked_at?: string;
};

type ModelsResponse = {
  models?: Record<string, { collection?: string; model?: string; adapter?: string; count?: number }>;
};

type HealthResponse = {
  status?: string;
  checked_at?: string;
};

function healthLabel(entry: CollectionHealth | undefined): string {
  if (!entry) return 'unknown';
  if (entry.status) return entry.status;
  return entry.ok === false ? 'down' : 'ok';
}

function collectionRows(config: ConfigResponse, models: ModelsResponse): string[] {
  const rows = (config.collections ?? []).map((item) => {
    const key = item.key || item.collection || 'unknown';
    const health = config.health?.[key];
    const docs = config.doc_counts?.[key] ?? item.count ?? 0;
    return {
      key,
      docs,
      adapter: item.adapter || health?.adapter || 'unknown',
      model: item.model || health?.model || 'unknown',
      enabled: item.enabled ?? health?.enabled,
      health: healthLabel(health ?? item),
      error: health?.error || item.error,
    };
  });

  if (rows.length) {
    return rows.map((row) => [
      `${row.key}: docs=${row.docs}`,
      `health=${row.health}`,
      `adapter=${row.adapter}`,
      `model=${row.model}`,
      row.enabled === false ? 'disabled' : '',
      row.error ? `error=${row.error}` : '',
    ].filter(Boolean).join(' '));
  }

  return Object.entries(models.models ?? {}).map(([key, item]) =>
    `${key}: docs=${item.count ?? 0} health=unknown adapter=${item.adapter ?? 'unknown'} model=${item.model ?? 'unknown'}`
  );
}

export async function runStatusCommand(): Promise<string> {
  const [config, models, health] = await Promise.all([
    requestJson<ConfigResponse>('/api/v1/vector/config'),
    requestJson<ModelsResponse>('/api/v1/vector/index/models'),
    requestJson<HealthResponse>('/api/v1/vector/health').catch((): HealthResponse => ({ status: 'unknown' })),
  ]);

  const lines = [
    `arra status: ${health.status ?? 'unknown'}`,
    `api: ${resolveApiBase()}`,
    config.checked_at || health.checked_at ? `checked: ${config.checked_at ?? health.checked_at}` : '',
    'collections:',
    ...collectionRows(config, models).map((line) => `  - ${line}`),
  ].filter(Boolean);

  return lines.join('\n');
}
