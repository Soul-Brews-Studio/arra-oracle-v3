import { useCallback, useEffect, useState } from 'react';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { VectorConfigPanel } from '../components/VectorConfigPanel';
import { VectorFirstRunWizard } from '../components/VectorFirstRunWizard';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { VectorModelRecommendationCard } from '../components/VectorModelRecommendationCard';
import { VectorProviderServicePanel } from '../components/VectorProviderServicePanel';
import { VectorSearchToggle } from '../components/VectorSearchToggle';
import { fetchJson, parseVectorConfigResponse, toRows, type VectorConfigRow } from './vectorSettingsHelpers';

function VectorFirstRunWizardSection() {
  const [rows, setRows] = useState<VectorConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setError('');
    setLoading(true);
    try {
      const body = await fetchJson<unknown>('/api/v1/vector/config');
      setRows(toRows(parseVectorConfigResponse(body)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  return (
    <div className="grid gap-3">
      <VectorFirstRunWizard rows={rows} onRefresh={refresh} />
      {loading ? <LoadingPanel title="Loading first-run collections…" detail="Fetching /api/v1/vector/config." /> : null}
      {error ? <ErrorMessage title="Could not load first-run vector config." message={error} /> : null}
    </div>
  );
}

export function VectorSettingsPage() {
  return (
    <section className="grid gap-5" aria-labelledby="vector-settings-title">
      <header className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Vector settings</p>
        <h1 id="vector-settings-title" className="mt-2 text-3xl font-semibold text-text">Vector settings</h1>
        <p className="mt-2 text-sm text-text-muted">
          Configure adapters, embedding models and providers, storage services, first-run indexing, and backfill jobs.
        </p>
      </header>

      <VectorSearchToggle />
      <VectorFirstRunWizardSection />
      <VectorProviderServicePanel />
      <VectorModelRecommendationCard />
      <VectorConfigPanel />
      <VectorIndexPanel />
    </section>
  );
}
