import { useMemo, useState } from 'react';
import type { VectorSearchResponse } from '../../../../src/server/types';

type SimpleResult = VectorSearchResponse['results'][number];

export function simpleResultTitle(result: SimpleResult): string {
  return result.source_file || result.id || 'Untitled result';
}

export function simpleResultPreview(content: string, maxLength = 180): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact || 'No preview available.';
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function SimpleResultCard({ result, defaultExpanded = false }: {
  result: SimpleResult;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const title = simpleResultTitle(result);
  const preview = useMemo(() => simpleResultPreview(result.content), [result.content]);
  const concepts = Array.isArray(result.concepts) ? result.concepts.slice(0, 3) : [];

  return (
    <article className="rounded-2xl border border-border bg-surface p-4 text-left shadow-sm" aria-label={`Search result ${title}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-text">{title}</h3>
          <p className="mt-1 text-xs text-text-muted">{result.type || 'memory'}{result.model ? ` · ${result.model}` : ''}</p>
        </div>
        {typeof result.score === 'number' ? (
          <span className="rounded-full border border-accent-border px-2 py-1 text-xs font-semibold text-accent">
            {Math.round(result.score * 100)}%
          </span>
        ) : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-text-muted">{expanded ? result.content : preview}</p>

      {concepts.length ? (
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Result concepts">
          {concepts.map((concept) => (
            <span key={concept} className="rounded-full border border-border px-2 py-1 text-xs text-text-muted">{concept}</span>
          ))}
        </div>
      ) : null}

      <button
        type="button"
        className="focus-ring mt-4 rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text hover:border-accent-border"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? 'Hide details' : 'Show result'}
      </button>
    </article>
  );
}
