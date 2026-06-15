import { useMemo, useState } from 'react';
import { searchVector } from '../api';
import { ErrorMessage, LoadingPanel, Spinner } from './AsyncState';
import { SearchResultCard } from './SearchResultCard';
import type { SearchResult } from '../types';

export function VectorSearchWidget({ onOpenResults }: { onOpenResults?: (query: string) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [lastQuery, setLastQuery] = useState('');

  const status = useMemo(() => {
    if (state === 'loading') return 'Searching vector memory…';
    if (state === 'idle') return 'Submit a semantic query to search /api/search?mode=vector.';
    if (state === 'error') return 'Vector search failed.';
    if (!results.length) return 'No vector matches found.';
    return `${results.length} shown${total > results.length ? ` of ${total}` : ''}`;
  }, [results.length, state, total]);

  async function runSearch(q: string) {
    if (!q) return;
    setState('loading');
    setError('');
    setLastQuery(q);
    try {
      const response = await searchVector(q);
      setResults(response.results);
      setTotal(response.total);
      setState('ready');
    } catch (err) {
      setResults([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runSearch(query.trim());
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-search-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector</p>
        <h2 id="vector-search-title" className="mt-2 text-2xl font-semibold text-white">Vector search</h2>
        <p className="mt-2 text-sm text-slate-400">Semantic search against Oracle memory through the Elysia API.</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row">
        <input
          className="focus-ring min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search vector memory…"
          type="search"
        />
        <button
          className="focus-ring rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state === 'loading' || !query.trim()}
          type="submit"
        >
          {state === 'loading' ? <Spinner label="Searching" /> : 'Search'}
        </button>
      </form>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500">{status}</p>
        <button
          className="focus-ring rounded-xl border border-white/10 px-3 py-2 text-sm text-slate-200 hover:border-teal-300/40 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!query.trim()}
          type="button"
          onClick={() => onOpenResults?.(query.trim())}
        >
          Open results page
        </button>
      </div>
      {state === 'loading' ? <div className="mt-3"><LoadingPanel title="Searching vector memory…" detail="Fetching /api/search?mode=vector." /></div> : null}
      {error ? (
        <div className="mt-3">
          <ErrorMessage
            title="Vector search failed."
            message={error}
            action={lastQuery ? <button className="focus-ring rounded-lg border border-red-200/30 px-3 py-2 font-semibold text-red-50 hover:bg-red-200/10" type="button" onClick={() => void runSearch(lastQuery)}>Retry search</button> : null}
          />
        </div>
      ) : null}
      <div className="mt-5 grid gap-3" aria-busy={state === 'loading'}>{state !== 'loading' ? results.map((result) => <SearchResultCard key={result.id} result={result} />) : null}</div>
    </section>
  );
}
