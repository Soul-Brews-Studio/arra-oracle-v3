import { Badge } from './Badge';
import { MemorySignalBadges } from './MemoryHealthPanel';
import { SearchResultSignals } from './SearchResultSignals';
import { previewFor, scoreLabel, titleFor, type ProvenanceSearchResult } from './searchResultView';

export function SearchResultCard({ result }: { result: ProvenanceSearchResult }) {
  const score = scoreLabel(result.score);
  return (
    <article className="min-w-0 rounded-2xl border border-border bg-surface p-4 transition hover:border-accent-border">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="break-all font-mono text-sm text-accent">{titleFor(result)}</h3>
        <div className="flex flex-wrap justify-end gap-2">
          {score ? <Badge tone="accent" ariaLabel={`Result score ${score}`}>{score}</Badge> : null}
          <MemorySignalBadges result={result} />
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-text-muted">{previewFor(result)}</p>
      <SearchResultSignals result={result} />
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
        {result.type ? <span>type: {result.type}</span> : null}
        {result.source ? <span>source: {result.source}</span> : null}
        {result.project ? <span>project: {result.project}</span> : null}
      </div>
    </article>
  );
}
