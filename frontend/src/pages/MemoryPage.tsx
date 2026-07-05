import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { searchMemoryHealth } from '../api';
import { fetchMemoryRecall, type MemoryRecallResponse, type RankedMemory } from '../memoryDashboard';
import { MemoryDashboardInsights } from '../components/MemoryDashboardInsights';
import { MemoryDashboardContent } from './MemoryDashboardPage';
import { MemoryHealthPanel } from '../components/MemoryHealthPanel';
import { SearchResultCard } from '../components/SearchResultCard';
import { memoryConsolidationPath, memoryPath, vectorResultsPath } from '../routePaths';
import type { SearchResponse, SearchResult } from '../types';

type PageState = 'idle' | 'loading' | 'ready' | 'error';
type MemorySearch = (query: string, limit?: number) => Promise<SearchResponse>;
type MemoryRecall = (params?: { q?: string; asOf?: string; limit?: number }) => Promise<MemoryRecallResponse>;

export function memoryHealthStatus(state: PageState, query: string, total: number): string {
  if (state === 'idle') return 'Search memory to inspect heat-score, recency, and recall signals.';
  if (state === 'loading') return `Building memory health view for “${query}”…`;
  if (state === 'error') return 'Memory health search failed.';
  return total ? `${total} memory result${total === 1 ? '' : 's'} feeding health signals for “${query}”.` : `No memory signals found for “${query}”.`;
}

function MemoryRouteLinks() {
  return (
    <div className="flex flex-wrap gap-2">
      <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" to="/vector/search">
        Vector preview
      </Link>
      <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" to={vectorResultsPath('')}>
        Search results
      </Link>
      <Link className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text hover:border-accent-border" to={memoryConsolidationPath()}>
        Consolidation queue
      </Link>
    </div>
  );
}

export function MemoryPage({ search = searchMemoryHealth, recall = fetchMemoryRecall }: { search?: MemorySearch; recall?: MemoryRecall }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(routeQuery);
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState('');
  const [dashboardItems, setDashboardItems] = useState<RankedMemory[]>([]);
  const [dashboardTotal, setDashboardTotal] = useState(0);
  const [dashboardAsOf, setDashboardAsOf] = useState<string | undefined>();
  const [dashboardState, setDashboardState] = useState<PageState>('idle');
  const [dashboardError, setDashboardError] = useState('');

  async function runSearch(nextQuery: string) {
    const q = nextQuery.trim();
    if (!q) {
      setActiveQuery('');
      setResults([]);
      setError('');
      setState('idle');
      return;
    }
    setState('loading');
    setError('');
    setActiveQuery(q);
    try {
      const response = await search(q, 20);
      setResults(response.results);
      setState('ready');
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  async function loadDashboard() {
    setDashboardState('loading');
    setDashboardError('');
    try {
      const response = await recall({ limit: 50 });
      setDashboardItems(response.items);
      setDashboardTotal(response.total);
      setDashboardAsOf(response.asOf);
      setDashboardState('ready');
    } catch (err) {
      setDashboardItems([]);
      setDashboardTotal(0);
      setDashboardError(err instanceof Error ? err.message : String(err));
      setDashboardState('error');
    }
  }

  useEffect(() => {
    setQuery(routeQuery);
    void runSearch(routeQuery);
  }, [routeQuery]);

  useEffect(() => { void loadDashboard(); }, []);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    navigate(memoryPath(nextQuery));
    if (nextQuery === routeQuery.trim()) void runSearch(nextQuery);
  }

  const status = useMemo(() => memoryHealthStatus(state, activeQuery, results.length), [activeQuery, results.length, state]);

  return (
    <div className="grid w-full min-w-0 gap-5">
      <MemoryDashboardContent items={dashboardItems} total={dashboardTotal} asOf={dashboardAsOf} state={dashboardState} error={dashboardError} />

      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-sm p-5 sm:p-6" aria-labelledby="memory-health-page-title">
        <div className="mb-5 flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent2">Memory</p>
            <h2 id="memory-health-page-title" className="mt-2 text-2xl font-semibold text-text">Memory health</h2>
            <p className="mt-2 text-sm text-text-muted">Inspect heat-score, last-recalled, and recall counts from Studio memory search results.</p>
          </div>
          <MemoryRouteLinks />
        </div>
        <form aria-label="Memory health search form" className="flex flex-col gap-3 sm:flex-row" role="search" onSubmit={submit}>
          <input
            aria-label="Memory search query"
            className="focus-ring min-w-0 flex-1 rounded-xl border border-border bg-field px-4 py-3 text-text placeholder:text-text-muted"
            placeholder="Search memory health…"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
          <button className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={state === 'loading' || !query.trim()} type="submit">
            {state === 'loading' ? 'Inspecting…' : 'Inspect health'}
          </button>
        </form>
        <p className="mt-4 text-sm text-text-muted">{status}</p>
        {error ? <p role="alert" className="mt-3 rounded-xl border border-err-border bg-err-bg p-3 text-sm text-err-text">{error}</p> : null}
      </section>

      <MemoryHealthPanel results={results} state={state} />
      <MemoryDashboardInsights results={results} />

      <section className="grid min-w-0 gap-3 lg:grid-cols-[repeat(2,minmax(0,1fr))]" aria-label="Memory heat result cards" aria-busy={state === 'loading'}>
        {results.map((result) => <SearchResultCard key={result.id} result={result} />)}
      </section>
    </div>
  );
}
