import { VectorConfigPanel } from '../components/VectorConfigPanel';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { VectorModelRecommendationCard } from '../components/VectorModelRecommendationCard';
import { VectorProviderServicePanel } from '../components/VectorProviderServicePanel';
import { VectorSearchToggle } from '../components/VectorSearchToggle';

export function VectorSettingsPage() {
  return (
    <section className="grid gap-5" aria-labelledby="vector-settings-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector settings</p>
        <h1 id="vector-settings-title" className="mt-2 text-3xl font-semibold text-white">Vector settings</h1>
        <p className="mt-2 text-sm text-slate-400">
          Configure adapters, embedding models, vector search, storage services, and backfill jobs.
        </p>
      </header>

      <VectorSearchToggle />
      <VectorProviderServicePanel />
      <VectorModelRecommendationCard />
      <VectorConfigPanel />
      <VectorIndexPanel />
    </section>
  );
}
