import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiClient, type ApiClient, type MenuSearchResponse } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import { menuSearchPath } from '../routePaths';
import type { MenuItem } from '../types';

type PageState = 'idle' | 'loading' | 'ready' | 'error';
type SearchClient = Pick<ApiClient, 'menuSearch'>;

type SearchScope = 'all';

export type HighlightPart = {
  text: string;
  match: boolean;
};

export function highlightParts(text: string, query: string): HighlightPart[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [{ text, match: false }];

  const parts: HighlightPart[] = [];
  const haystack = text.toLocaleLowerCase();
  let cursor = 0;
  let index = haystack.indexOf(needle, cursor);

  while (index !== -1) {
    if (index > cursor) parts.push({ text: text.slice(cursor, index), match: false });
    const end = index + needle.length;
    parts.push({ text: text.slice(index, end), match: true });
    cursor = end;
    index = haystack.indexOf(needle, cursor);
  }

  if (cursor < text.length) parts.push({ text: text.slice(cursor), match: false });
  return parts.length ? parts : [{ text, match: false }];
}

export function menuSearchSummary(state: PageState, query: string, total: number): string {
  if (state === 'idle') return 'Enter a query to search the menu catalog.';
  if (state === 'loading') return `Searching menu for “${query}”…`;
  if (state === 'error') return 'Menu search failed.';
  return total ? `${total} menu result${total === 1 ? '' : 's'} for “${query}”.` : `No menu results found for “${query}”.`;
}

export async function searchMenuItems(query: string, client: SearchClient = apiClient): Promise<MenuSearchResponse> {
  return client.menuSearch(query.trim());
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) => part.match ? (
        <mark key={`${part.text}-${index}`} className="rounded bg-amber-300/25 px-0.5 text-amber-100">
          {part.text}
        </mark>
      ) : <span key={`${part.text}-${index}`}>{part.text}</span>)}
    </>
  );
}

function SearchInputCard({ query, loading, onQueryChange, onSubmit }: {
  query: string;
  loading: boolean;
  onQueryChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Search input card">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Menu search</p>
        <h1 id="menu-search-title" className="mt-2 text-3xl font-semibold text-white">Full-text menu search</h1>
        <p className="mt-2 text-sm text-slate-400">Search dashboard labels and paths through /api/menu/search?q=.</p>
      </div>
      <form aria-label="Menu search form" className="flex flex-col gap-3 sm:flex-row" role="search" onSubmit={onSubmit}>
        <input
          aria-label="Menu search query"
          className="focus-ring min-w-0 flex-1 rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600"
          placeholder="Search menu items…"
          type="search"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        <button className="focus-ring rounded-xl bg-teal-300 px-5 py-3 font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={loading || !query.trim()} type="submit">
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>
    </section>
  );
}

export function MenuSearchResults({ query, results, state }: { query: string; results: MenuItem[]; state: PageState }) {
  if (state === 'loading') return <LoadingPanel title="Searching menu…" detail="Fetching /api/menu/search?q= from the Elysia backend." />;
  if (state === 'idle') return <EmptyState text="Search labels and paths from /api/menu/search?q=." />;
  if (state === 'error') return null;
  if (!results.length) return <EmptyState text={`No menu results found for “${query}”.`} />;

  return (
    <ul className="grid gap-3" aria-label="Menu search results">
      {results.map((item) => (
        <li key={`${item.source ?? 'api'}:${item.path}:${item.label}`}>
          <a className="focus-ring block rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-teal-300/40" href={item.path}>
            <span className="text-lg font-semibold text-white"><HighlightedText text={item.label} query={query} /></span>
            <span className="mt-1 block text-sm text-slate-400"><HighlightedText text={item.path} query={query} /></span>
            <span className="mt-3 inline-flex rounded-full bg-teal-300/10 px-2 py-1 text-xs font-semibold uppercase tracking-[0.16em] text-teal-200">
              {item.group}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function SearchScopeCard({ scope, resultGroups, total }: { scope: SearchScope; resultGroups: string[]; total: number }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Search scope card">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Scope</p>
      <h2 className="mt-2 text-2xl font-semibold text-white">Search boundaries</h2>
      <p className="mt-2 text-sm text-slate-400">Current query scope is constrained to menu records.</p>
      <ul className="mt-5 grid gap-2 text-sm text-slate-300">
        <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Mode</span>
          <p className="mt-1 font-semibold text-white capitalize">{scope}</p>
        </li>
        <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Result groups</span>
          <p className="mt-1 font-semibold text-white">{resultGroups.length || '-'}{resultGroups.length ? ` (${resultGroups.join(', ')})` : ''}</p>
        </li>
        <li className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <span className="text-xs uppercase tracking-[0.16em] text-slate-500">Matches</span>
          <p className="mt-1 font-semibold text-white">{total}</p>
        </li>
      </ul>
    </section>
  );
}

function SearchResultsCard({
  query,
  results,
  state,
  summary,
  errorMessage,
}: {
  query: string;
  results: MenuItem[];
  state: PageState;
  summary: string;
  errorMessage: string;
}) {
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-label="Menu search results card">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Results</p>
        <h2 className="mt-2 text-2xl font-semibold text-white">Search results</h2>
        <p className="mt-2 text-sm text-slate-500">{summary}</p>
      </div>
      {state === 'error' ? <ErrorMessage title="Menu search failed." message={errorMessage} /> : null}
      <MenuSearchResults query={query} results={results} state={state} />
    </section>
  );
}

export function SearchPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const routeQuery = searchParams.get('q') ?? '';
  const [query, setQuery] = useState(routeQuery);
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<MenuItem[]>([]);
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState('');
  const [scope] = useState<SearchScope>('all');

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
      const response = await searchMenuItems(q);
      setResults(response.data);
      setState('ready');
    } catch (err) {
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => {
    setQuery(routeQuery);
    void runSearch(routeQuery);
  }, [routeQuery]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    navigate(menuSearchPath(nextQuery));
    if (nextQuery === routeQuery.trim()) void runSearch(nextQuery);
  }

  const summary = menuSearchSummary(state, activeQuery, results.length);
  const groups = useMemo(() => {
    const set = new Set<string>();
    for (const item of results) set.add(item.group);
    return [...set].sort();
  }, [results]);

  return (
    <div className="grid gap-5">
      <SearchInputCard query={query} loading={state === 'loading'} onQueryChange={setQuery} onSubmit={submit} />
      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        <SearchResultsCard
          query={activeQuery}
          results={results}
          state={state}
          summary={summary}
          errorMessage={error || 'Search request failed.'}
        />
        <SearchScopeCard scope={scope} resultGroups={groups} total={results.length} />
      </div>
    </div>
  );
}
