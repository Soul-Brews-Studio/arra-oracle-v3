import { useEffect, useState, type ReactNode } from 'react';
import { fetchSettingsSystem } from '../api';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { VectorConfigPanel } from '../components/VectorConfigPanel';
import { VectorProviderServicePanel } from '../components/VectorProviderServicePanel';
import { VectorSearchToggle } from '../components/VectorSearchToggle';
import type { SettingsSystemResponse } from '../types';

type SettingsPageProps = {
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
  onRefresh: () => void;
};

function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="glass min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-label={title}>
      <h3 className="text-lg font-semibold text-text">{title}</h3>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function SettingPair({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-text-muted">{label}</dt>
      <dd className="mt-2 break-words font-mono text-sm text-accent">{value}</dd>
      <dd className="mt-2 break-words text-sm leading-6 text-text-muted">{detail}</dd>
    </div>
  );
}

function statusLabel(settings: SettingsSystemResponse): string {
  const { migrations } = settings;
  if (!migrations.tablePresent) return 'migration table missing';
  return migrations.status === 'current' ? 'current' : `${migrations.pendingCount} pending`;
}

function formatRoutesText(surfaceCount: number): string {
  return `/menu /plugins /forum /vector /mcp /settings`;
}

export function SettingsPage({ menuCount, pluginCount, surfaceCount, updatedAt, onRefresh }: SettingsPageProps) {
  const [settings, setSettings] = useState<SettingsSystemResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  async function loadSystemSettings() {
    setLoading(true);
    setError('');
    try {
      setSettings(await fetchSettingsSystem());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSystemSettings(); }, []);

  const refreshAll = () => {
    onRefresh();
    void loadSystemSettings();
  };

  return (
    <div className="grid gap-5">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="settings-page-title">
        <div className="mb-5 flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Settings</p>
            <h2 id="settings-page-title" className="mt-2 text-2xl font-semibold text-text">Runtime configuration</h2>
            <p className="mt-2 text-sm text-text-muted">Storage backend, embedder configuration, and Drizzle migration status.</p>
            <p className="mt-2 break-words text-sm text-text-muted">Route map: {formatRoutesText(surfaceCount)}</p>
          </div>
          <button aria-label="Refresh runtime settings" className="focus-ring shrink-0 rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" type="button" onClick={refreshAll}>
            {loading ? <Spinner label="Refreshing" /> : 'Refresh settings'}
          </button>
        </div>

        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SettingPair
            label="Frontend routes"
            value={formatRoutesText(surfaceCount)}
            detail="React routes and API surfaces available in this build."
          />
          <SettingPair
            label="Frontend inventory"
            value={`${menuCount} menu · ${pluginCount} plugins`}
            detail={`Last refreshed ${updatedAt}; use refresh after backend changes.`}
          />
          <SettingPair
            label="Plugin surfaces"
            value={surfaceCount}
            detail="Counts wasm, menu, server, and MCP surfaces exposed by plugin metadata."
          />
          <SettingPair
            label="Updated at"
            value={updatedAt}
            detail="Backend health and runtime counters sampled from /api/settings/system."
          />
        </dl>
      </section>

      {loading && !settings ? <LoadingPanel title="Loading settings…" detail="Fetching /api/settings/system." /> : null}
      {error ? <ErrorMessage title="Could not load runtime settings." message={error} /> : null}

      <section className="grid gap-5 xl:grid-cols-2" aria-label="Vector backend configuration">
        <div className="xl:col-span-2">
          <VectorSearchToggle />
        </div>

        <div className="xl:col-span-2">
          <VectorProviderServicePanel />
        </div>

        <div className="xl:col-span-2">
          <VectorConfigPanel />
        </div>
      </section>

      {settings ? (
        <section className="grid gap-5 xl:grid-cols-2">
          <SectionCard title="Storage backend">
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingPair
                label="Active backend"
                value={settings.storage.activeBackend}
                detail={`Configured ${settings.storage.configuredBackend}; default ${settings.storage.defaultBackend}.`}
              />
              <SettingPair
                label="Database"
                value={settings.storage.dbPath}
                detail={`Data directory: ${settings.storage.dataDir}`}
              />
              <SettingPair
                label="Repository"
                value={settings.storage.repoRoot}
                detail="Resolved runtime project root used by storage config."
              />
            </div>
          </SectionCard>

          <SectionCard title="Embedder">
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingPair
                label="Backend"
                value={settings.embedder.backend}
                detail={`Model ${settings.embedder.model ?? 'none'} · dimensions ${settings.embedder.dimensions ?? 'unknown'}.`}
              />
              <SettingPair
                label="Source URL"
                value={settings.embedder.source}
                detail={`Embedding endpoint: ${settings.embedder.embeddingEndpoint || 'disabled'}.`}
              />
              <SettingPair
                label="Endpoint"
                value={settings.embedder.url ?? 'not configured'}
                detail={`Remote URL used for vector embeddings.`}
              />
              <SettingPair
                label="Collections"
                value={settings.embedder.collections.length}
                detail="Vector collection entries derived from vector-server config or defaults."
              />
            </div>
          </SectionCard>

          <SectionCard title="DB migrations">
            <div className="grid gap-3 sm:grid-cols-2">
              <SettingPair
                label="Status"
                value={statusLabel(settings)}
                detail={`${settings.migrations.appliedCount}/${settings.migrations.availableCount} migrations applied.`}
              />
              <SettingPair
                label="Latest known"
                value={settings.migrations.latestKnown ?? 'none'}
                detail={`Latest applied at ${settings.migrations.latestAppliedAt ?? 'not recorded'}.`}
              />
              <SettingPair
                label="Table present"
                value={settings.migrations.tablePresent ? 'yes' : 'no'}
                detail={settings.migrations.tablePresent ? 'Migration metadata table exists.' : 'Migration table missing from database.'}
              />
              <SettingPair
                label="Pending"
                value={settings.migrations.pendingCount}
                detail={`${settings.migrations.status === 'pending' ? 'Pending migrations are waiting to run.' : 'No migrations pending.'}`}
              />
            </div>
          </SectionCard>

          <SectionCard title="Vector collections">
            <div className="grid gap-3 sm:grid-cols-2">
              {settings.embedder.collections.map((collection) => (
                <article key={collection.key} className="min-w-0 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4">
                  <p className="break-all font-mono text-sm text-accent">{collection.key}</p>
                  <p className="mt-2 break-words text-sm text-text">{collection.collection}</p>
                  <p className="mt-1 break-words text-sm text-text-muted">{collection.provider} · {collection.model} · {collection.adapter ?? 'adapter default'}</p>
                  {collection.primary ? <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-accent2">Primary</p> : null}
                </article>
              ))}
            </div>
          </SectionCard>
        </section>
      ) : null}
    </div>
  );
}
