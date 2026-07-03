import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { searchVector } from '../api';
import { MemoryHealthPanel } from '../components/MemoryHealthPanel';
import { SearchResultCard } from '../components/SearchResultCard';
import { vectorResultsPath } from '../routePaths';
import type { SearchResult } from '../types';

type PageState = 'idle' | 'loading' | 'ready' | 'error';

export function VectorSearchResultsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState('');

  async function runSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) {
      setResults([]);
      setTotal(0);
      setActiveQuery('');
      setState('idle');
      return;
    }
    setState('loading');
    setError('');
    setActiveQuery(q);
    try {
      const response = await searchVector(q, 20);
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

  useEffect(() => {
    setQuery(initialQuery);
    void runSearch(initialQuery);
  }, [initialQuery]);

  const status = useMemo(() => {
    if (state === 'idle') return 'Enter a query to run a vector search.';
    if (state === 'loading') return `Searching for “${activeQuery}”…`;
    if (state === 'error') return 'Vector search failed.';
    if (!results.length) return `No vector matches found for “${activeQuery}”.`;
    return `${results.length} shown${total > results.length ? ` of ${total}` : ''} for “${activeQuery}”.`;
  }, [activeQuery, results.length, state, total]);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    if (!nextQuery) return;
    navigate(vectorResultsPath(nextQuery));
    if (nextQuery === initialQuery.trim()) void runSearch(nextQuery);
  }

  return (
    <section className="rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="vector-results-title">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Vector</p>
          <h1 id="vector-results-title" className="mt-2 text-3xl font-semibold text-text">Vector search results</h1>
          <p className="mt-2 text-sm text-text-muted">Full-page results from /api/search?mode=vector.</p>
        </div>
        <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" to="/vector">
          Back to vector search
        </Link>
      </div>

      <form aria-label="Full-page vector search form" onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Vector search query"
          className="focus-ring min-w-0 flex-1 rounded-xl border border-border bg-field px-4 py-3 text-text placeholder:text-text-muted"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search vector memory…"
          type="search"
        />
        <button aria-label="Run vector search" className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-solid disabled:cursor-not-allowed disabled:opacity-50" disabled={state === 'loading' || !query.trim()} type="submit">
          {state === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <p className="mt-4 text-sm text-text-muted">{status}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl border border-err-border bg-err-bg p-3 text-sm text-err-text">{error}</p> : null}
      <div className="mt-5">
        <MemoryHealthPanel results={results} state={state} />
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">{results.map((result) => <SearchResultCard key={result.id} result={result} />)}</div>
    </section>
  );
}
