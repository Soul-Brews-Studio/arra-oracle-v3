import type { SettingsEmbedderCollection, VectorConfigHealth } from '../types';

type Collections = Record<string, SettingsEmbedderCollection>;
type HealthMap = Record<string, VectorConfigHealth>;

export type VectorConfigHealthStats = {
  total: number;
  enabled: number;
  healthy: number;
  down: number;
  disabled: number;
  summary: string;
};

function isEnabled(collection: SettingsEmbedderCollection): boolean {
  return collection.enabled !== false;
}

function rowEndpoint(collection: SettingsEmbedderCollection, health?: VectorConfigHealth): string {
  return collection.endpoint || health?.endpoint || 'no endpoint configured';
}

function rowAdapter(collection: SettingsEmbedderCollection, health?: VectorConfigHealth): string {
  return collection.adapter || health?.adapter || 'lancedb';
}

export function vectorConfigHealthStats(collections: Collections, health: HealthMap = {}): VectorConfigHealthStats {
  const rows = Object.entries(collections);
  const enabledRows = rows.filter(([, collection]) => isEnabled(collection));
  const healthy = enabledRows.filter(([key]) => health[key]?.ok).length;
  const disabled = rows.length - enabledRows.length;
  const down = enabledRows.length - healthy;
  return {
    total: rows.length,
    enabled: enabledRows.length,
    healthy,
    down,
    disabled,
    summary: `${healthy}/${enabledRows.length} enabled connections healthy · ${down} down · ${disabled} disabled`,
  };
}

export function VectorConfigHealthSummary({
  collections,
  health = {},
}: {
  collections: Collections;
  health?: HealthMap;
}) {
  const stats = vectorConfigHealthStats(collections, health);
  const downRows = Object.entries(collections).filter(([key, collection]) => isEnabled(collection) && !health[key]?.ok);

  return (
    <section className="mt-5 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="Vector connection health">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h4 className="font-semibold text-white">Connection health</h4>
          <p className="mt-1 text-sm text-slate-400">{stats.summary}</p>
        </div>
        <p className="rounded-full border border-teal-300/20 px-3 py-1 text-xs font-semibold text-teal-100">{stats.total} configured</p>
      </div>

      {downRows.length ? (
        <div className="mt-3 grid gap-2">
          {downRows.map(([key, collection]) => {
            const rowHealth = health[key];
            const adapter = rowAdapter(collection, rowHealth);
            return (
              <article key={key} className="rounded-xl border border-rose-300/20 bg-rose-300/10 p-3 text-sm">
                <p className="font-semibold text-rose-100">{key}: {adapter} connection down</p>
                <p className="mt-1 text-slate-300">{rowEndpoint(collection, rowHealth)}</p>
                <p className="mt-1 text-xs text-rose-200">{rowHealth?.error || `Start ${adapter} or update the service endpoint, then Test/Reload.`}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="mt-3 text-sm text-emerald-200">All enabled vector connections are healthy.</p>
      )}
    </section>
  );
}
