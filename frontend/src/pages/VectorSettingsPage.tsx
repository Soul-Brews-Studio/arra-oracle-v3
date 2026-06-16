import { Link } from 'react-router-dom';
import { VectorConfigPanel } from '../components/VectorConfigPanel';
import { VectorIndexPanel } from '../components/VectorIndexPanel';
import { VectorModelRecommendationCard } from '../components/VectorModelRecommendationCard';
import { VectorProviderServicePanel } from '../components/VectorProviderServicePanel';
import { VectorSearchToggle } from '../components/VectorSearchToggle';
import { vectorIndexPath } from '../routePaths';

function FirstRunWizardCard() {
  return (
    <section className="rounded-3xl border border-purple-300/20 bg-purple-300/10 p-5 sm:p-6" aria-labelledby="vector-first-run-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-purple-200">First-run wizard</p>
      <h2 id="vector-first-run-title" className="mt-2 text-2xl font-semibold text-white">Provider → vault → first index</h2>
      <p className="mt-2 text-sm text-purple-100/80">
        The setup wizard appears automatically when FTS docs are empty and vector search is disabled. Use the Index Manager to watch first-run backfill progress.
      </p>
      <Link className="focus-ring mt-4 inline-flex rounded-xl border border-purple-200/40 px-4 py-2 text-sm font-semibold text-purple-100 hover:bg-purple-200/10" to={vectorIndexPath()}>
        Open Index Manager
      </Link>
    </section>
  );
}

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
      <FirstRunWizardCard />
      <VectorProviderServicePanel />
      <VectorModelRecommendationCard />
      <VectorConfigPanel />
      <VectorIndexPanel />
    </section>
  );
}
