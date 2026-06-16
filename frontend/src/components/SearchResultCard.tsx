import type { SearchResult } from '../types';
import { previewFor, scoreLabel, titleFor } from './searchResultView';

export function SearchResultCard({ result }: { result: SearchResult }) {
  const score = scoreLabel(result.score);
  return (
    <article className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 transition hover:border-teal-300/30">
      <div className="flex items-start justify-between gap-3">
        <h3 className="break-all font-mono text-sm text-teal-200">{titleFor(result)}</h3>
        {score ? <span className="rounded-full bg-teal-300/10 px-2 py-1 text-xs font-semibold text-teal-200">{score}</span> : null}
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-400">{previewFor(result)}</p>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
        {result.type ? <span>type: {result.type}</span> : null}
        {result.source ? <span>source: {result.source}</span> : null}
        {result.project ? <span>project: {result.project}</span> : null}
      </div>
    </article>
  );
}
