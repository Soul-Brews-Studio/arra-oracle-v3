import { useEffect, useState, type ReactNode } from 'react';
import { fetchSettingsSystem } from '../api';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import type { SettingsSystemResponse } from '../types';

type SettingsPageProps = {
  menuCount: number;
  pluginCount: number;
  surfaceCount: number;
  updatedAt: string;
  onRefresh: () => void;
};

function SettingCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</dt>
      <dd className="mt-2 break-words font-mono text-sm text-teal-200">{value}</dd>
      <dd className="mt-2 text-sm leading-6 text-slate-400">{detail}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label={title}>
      <h3 className="mb-3 text-lg font-semibold text-white">{title}</h3>
      {children}
    </section>
  );
}

function statusLabel(settings: SettingsSystemResponse) {
  const { migrations } = settings;
  if (!migrations.tablePresent) return 'migration table missing';
  return migrations.status === 'current' ? 'current' : `${migrations.pendingCount} pending`;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="settings-page-title">
        <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-300">Settings</p>
            <h2 id="settings-page-title" className="mt-2 text-2xl font-semibold text-white">Runtime configuration</h2>
            <p className="mt-2 text-sm text-slate-400">Storage backend, embedder configuration, and Drizzle migration status.</p>
          </div>
          <button aria-label="Refresh runtime settings" className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" type="button" onClick={refreshAll}>
            {loading ? <Spinner label="Refreshing" /> : 'Refresh settings'}
          </button>
        </div>

        <dl className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SettingCard label="API proxy" value="/api/* → :47778" detail="Vite forwards same-origin calls to the Elysia backend in development." />
          <SettingCard label="Frontend rows" value={`${menuCount} menu · ${pluginCount} plugins`} detail={`Last refreshed ${updatedAt}; use refresh after backend changes.`} />
          <SettingCard label="Plugin surfaces" value={surfaceCount} detail="Counts wasm, menu, server, and MCP surfaces exposed by plugin metadata." />
          <SettingCard label="Client routes" value="/menu /plugins /vector /mcp /settings" detail="React Router owns client navigation while backend endpoints stay canonical." />
        </dl>
      </section>

      {loading && !settings ? <LoadingPanel title="Loading settings…" detail="Fetching /api/settings/system." /> : null}
      {error ? <ErrorMessage title="Could not load runtime settings." message={error} /> : null}
      {settings ? <RuntimeSettings settings={settings} /> : null}
    </div>
  );
}

function RuntimeSettings({ settings }: { settings: SettingsSystemResponse }) {
  const { storage, embedder, migrations } = settings;
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Section title="Storage backend">
        <dl className="grid gap-3 text-sm">
          <SettingCard label="Active" value={storage.activeBackend} detail={`Configured ${storage.configuredBackend}; default ${storage.defaultBackend}.`} />
          <SettingCard label="Database" value={storage.dbPath} detail={`Data directory: ${storage.dataDir}`} />
          <SettingCard label="Repo root" value={storage.repoRoot} detail="Resolved runtime project root used by storage config." />
        </dl>
      </Section>

      <Section title="Embedder">
        <dl className="grid gap-3 text-sm">
          <SettingCard label="Backend" value={embedder.backend} detail={`Model ${embedder.model ?? 'none'}; dimensions ${embedder.dimensions ?? 'unknown'}.`} />
          <SettingCard label="Source" value={embedder.source} detail={`URL ${embedder.url ?? 'not configured'}; endpoint ${embedder.embeddingEndpoint || 'disabled'}.`} />
          <SettingCard label="Collections" value={embedder.collections.length} detail="Vector collection entries derived from vector-server config or defaults." />
        </dl>
      </Section>

      <Section title="DB migrations">
        <dl className="grid gap-3 text-sm">
          <SettingCard label="Status" value={statusLabel(settings)} detail={`${migrations.appliedCount}/${migrations.availableCount} migrations applied.`} />
          <SettingCard label="Latest known" value={migrations.latestKnown ?? 'none'} detail={`Latest applied at ${migrations.latestAppliedAt ?? 'not recorded'}.`} />
        </dl>
      </Section>

      <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 xl:col-span-3" aria-label="Vector collections">
        <h3 className="mb-3 text-lg font-semibold text-white">Vector collections</h3>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {embedder.collections.map((collection) => (
            <div key={collection.key} className="rounded-xl border border-white/10 bg-slate-950/60 p-4 text-sm">
              <p className="font-mono text-teal-200">{collection.key}</p>
              <p className="mt-2 text-slate-300">{collection.collection}</p>
              <p className="mt-1 text-slate-500">{collection.provider} · {collection.model} · {collection.adapter ?? 'adapter default'}</p>
              {collection.primary ? <p className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-purple-300">Primary</p> : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
