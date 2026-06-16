import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { globalSearchSurfaceLabel, searchAllSurfaces, type GlobalSearchResult } from '../global-search';
import { Spinner } from './AsyncState';

type SearchState = 'idle' | 'loading' | 'ready' | 'error';

function ResultAnchor({ result }: { result: GlobalSearchResult }) {
  const body = (
    <>
      <span className="rounded-full bg-teal-500/10 px-2 py-1 text-xs font-semibold text-teal-700 dark:bg-teal-300/10 dark:text-teal-200">
        {globalSearchSurfaceLabel(result.surface)}
      </span>
      <span className="min-w-0">
        <span className="block truncate font-semibold text-slate-950 dark:text-white">{result.title}</span>
        <span className="block truncate text-xs text-slate-500 dark:text-slate-400">{result.detail}</span>
      </span>
    </>
  );
  const className = 'focus-ring grid grid-cols-[auto_1fr] gap-3 rounded-xl border border-slate-200 bg-white/80 p-3 text-left transition hover:border-teal-500/40 dark:border-white/10 dark:bg-slate-950/70 dark:hover:border-teal-300/40';
  return result.href ? <Link className={className} to={result.href}>{body}</Link> : <div className={className}>{body}</div>;
}

export function GlobalSearchResults({ results }: { results: GlobalSearchResult[] }) {
  if (!results.length) return <p className="rounded-xl border border-dashed border-slate-200 p-3 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">No matching menu, plugin, or MCP tool surfaces.</p>;
  return (
    <ul className="grid gap-2">
      {results.map((result) => <li key={result.id}><ResultAnchor result={result} /></li>)}
    </ul>
  );
}

export function GlobalSearch() {
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
    <section className="grid gap-3" aria-label="Global frontend search">
      <form className="grid gap-2 sm:grid-cols-[1fr_auto]" role="search" onSubmit={submit}>
        <label className="sr-only" htmlFor="global-search">Search all surfaces</label>
        <input
          className="focus-ring min-w-0 rounded-xl border border-slate-300/80 bg-white/80 px-4 py-3 text-sm text-slate-950 placeholder:text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100 dark:placeholder:text-slate-600"
          id="global-search"
          placeholder="Search menu, plugins, MCP tools…"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        <button
          className="focus-ring rounded-xl border border-slate-300/80 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-200 dark:hover:border-teal-300/40"
          disabled={state === 'loading' || !trimmed}
          type="submit"
        >
          {state === 'loading' ? <Spinner label="Searching" /> : 'Search'}
        </button>
      </form>
      {state === 'error' ? <p className="rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">{error}</p> : null}
      {state === 'ready' ? (
        <div className="grid gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500 dark:text-slate-500">
            {results.length ? `${results.length} unified result${results.length === 1 ? '' : 's'} for “${lastQuery}”` : `No results for “${lastQuery}”`}
          </p>
          <GlobalSearchResults results={results} />
        </div>
      ) : null}
    </section>
  );
}
