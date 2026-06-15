import { Link, useNavigate } from 'react-router-dom';
import { VectorSearchWidget } from '../components/VectorSearchWidget';
import { vectorDocumentsPath, vectorResultsPath } from '../routePaths';

export function VectorPage() {
  const navigate = useNavigate();
  return (
    <div className="grid gap-4">
      <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Documents</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Browse indexed documents</h2>
        <p className="mt-2 text-sm text-slate-400">Open the collection-level document browser for full content and metadata.</p>
        <Link className="focus-ring mt-4 inline-flex rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 hover:border-teal-300/40" to={vectorDocumentsPath()}>
          Open document browser
        </Link>
      </div>
      <VectorSearchWidget onOpenResults={(query) => navigate(vectorResultsPath(query))} />
    </div>
  );
}
