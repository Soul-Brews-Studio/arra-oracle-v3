import { useEffect, useMemo, useState } from 'react';
import { fetchSettingsSystem } from '../api';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import type { SettingsSystemResponse } from '../types';

type StoragePageProps = {
  initialSettings?: SettingsSystemResponse;
  fetcher?: () => Promise<SettingsSystemResponse>;
};

type DetailRow = {
  label: string;
  value: string | number;
  detail: string;
};

function display(value: string | number | null | undefined): string | number {
  return value === null || value === undefined || value === '' ? 'not configured' : value;
}

function migrationLabel(settings: SettingsSystemResponse): string {
  if (!settings.migrations.tablePresent) return 'table missing';
  return settings.migrations.status === 'current' ? 'current' : `${settings.migrations.pendingCount} pending`;
}

export function storageSummaryRows(settings: SettingsSystemResponse): DetailRow[] {
  return [
    {
      label: 'Active backend',
      value: display(settings.storage.activeBackend),
      detail: `Configured ${display(settings.storage.configuredBackend)}; default ${display(settings.storage.defaultBackend)}.`,
    },
    {
      label: 'Database path',
      value: display(settings.storage.dbPath),
      detail: 'SQLite or remote-backed database location reported by the runtime.',
    },
    {
      label: 'Data directory',
      value: display(settings.storage.dataDir),
      detail: 'Directory used for local files, indexes, and runtime storage state.',
    },
    {
      label: 'Repository root',
      value: display(settings.storage.repoRoot),
      detail: 'Resolved project root used when storage paths are relative.',
    },
    {
      label: 'Migration state',
      value: migrationLabel(settings),
      detail: `${settings.migrations.appliedCount}/${settings.migrations.availableCount} migrations applied.`,
    },
    {
      label: 'Latest known',
      value: display(settings.migrations.latestKnown),
      detail: `Latest applied at ${display(settings.migrations.latestAppliedAt)}.`,
    },
  ];
}

function DetailCard({ row }: { row: DetailRow }) {
  return (
    <article className="rounded-2xl border border-border bg-surface-muted p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{row.label}</p>
      <p className="mt-2 break-words font-mono text-sm text-accent">{row.value}</p>
      <p className="mt-2 text-sm leading-6 text-text-muted">{row.detail}</p>
    </article>
  );
}

export function StoragePage({ initialSettings, fetcher = fetchSettingsSystem }: StoragePageProps) {
  const [settings, setSettings] = useState<SettingsSystemResponse | null>(initialSettings ?? null);
  const [loading, setLoading] = useState(!initialSettings);
  const [error, setError] = useState('');

  async function loadStorageConfig() {
    setLoading(true);
    setError('');
    try {
      setSettings(await fetcher());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!initialSettings) void loadStorageConfig();
  }, []);

  const rows = useMemo(() => (settings ? storageSummaryRows(settings) : []), [settings]);
  const refresh = () => { void loadStorageConfig(); };

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="storage-page-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Storage</p>
            <h2 id="storage-page-title" className="mt-2 text-2xl font-semibold text-text">Storage backend</h2>
            <p className="mt-2 text-sm text-text-muted">Backend config viewer for /api/settings/system.</p>
            <p className="mt-2 text-sm text-text-muted">Review active backend, resolved paths, and migration readiness before enabling plugins.</p>
          </div>
          <button
            aria-label="Refresh storage backend config"
            className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border"
            type="button"
            onClick={refresh}
          >
            {loading ? <Spinner label="Refreshing storage" /> : 'Refresh storage'}
          </button>
        </div>
      </section>

      {loading && !settings ? <LoadingPanel title="Loading storage backend…" detail="Fetching /api/settings/system." /> : null}
      {error ? <ErrorMessage title="Could not load storage backend." message={error} /> : null}

      {settings ? (
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Storage backend details">
          {rows.map((row) => <DetailCard key={row.label} row={row} />)}
        </section>
      ) : null}
    </div>
  );
}
