import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { globalSearchSurfaceLabel, searchAllSurfaces, type GlobalSearchResult } from '../global-search';
import { Spinner } from './AsyncState';
import { StateNotice } from './StateNotice';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

function ResultAnchor({ result }: { result: GlobalSearchResult }) {
  const body = (
    <>
      <span className="rounded-full bg-accent-soft px-2 py-1 text-xs font-semibold text-accent dark:bg-accent-soft dark:text-accent">
        {globalSearchSurfaceLabel(result.surface)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-text">{result.title}</span>
        <span className="block truncate text-xs text-text-muted dark:text-text-muted">{result.detail}</span>
      </span>
    </>
  );
  const className = 'focus-ring grid grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-border bg-field p-3 text-left transition hover:border-accent-border hover:bg-surface-muted';
  const label = `Open ${result.title} ${globalSearchSurfaceLabel(result.surface)} result`;
  return result.href ? <Link aria-label={label} className={className} to={result.href}>{body}</Link> : <div className={className}>{body}</div>;
}

export function GlobalSearchResults({ results }: { results: GlobalSearchResult[] }) {
  if (!results.length) {
    return <StateNotice tone="warning" title="No matching surfaces." detail="Try a menu label, plugin name, MCP tool, route path, or action keyword." />;
  }
  return (
    <ul className="grid gap-2" aria-label="Global search results">
      {results.map((result) => <li key={result.id}><ResultAnchor result={result} /></li>)}
    </ul>
  );
}

export function GlobalSearch() {
  const resultsId = 'global-search-results';
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [state, setState] = useState<SearchState>('idle');
  const [error, setError] = useState('');
  const trimmed = query.trim();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmed) {
      setResults([]);
      setLastQuery('');
      setError('');
      setState('idle');
      return;
    }
    setState('loading');
    setError('');
    setLastQuery(trimmed);
    try {
      setResults(await searchAllSurfaces(trimmed));
      setState('ready');
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label="Global frontend search">
      <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="global-search">Search all surfaces</label>
        <input
          aria-controls={resultsId}
          className="focus-ring min-w-0 rounded-xl border border-border bg-field px-4 py-3 text-sm text-text placeholder:text-text-muted"
          id="global-search"
          placeholder="Search menu, plugins, MCP tools…"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <button
          className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-sm font-semibold text-text transition hover:border-accent-border hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === 'loading' || !trimmed}
          type="submit"
        >
          {state === 'loading' ? <Spinner label="Searching" /> : 'Search'}
        </button>
      </form>
      <div id={resultsId} className="grid gap-2" role="region" aria-busy={state === 'loading'} aria-live="polite" aria-label="Global search results">
        {state === 'error' ? <StateNotice tone="error" title="Global search failed." detail={error} /> : null}
        {state === 'ready' ? (
          <>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-text-muted dark:text-text-muted">
              {results.length ? `${results.length} unified result${results.length === 1 ? '' : 's'} for “${lastQuery}”` : `No results for “${lastQuery}”`}
            </p>
            <GlobalSearchResults results={results} />
          </>
        ) : null}
      </div>
    </section>
  );
}
