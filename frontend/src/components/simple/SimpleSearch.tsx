import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { apiClient, type ApiClient } from '../../api/client';
import { SimpleResultCard } from './SimpleResultCard';
import type { VectorSearchResponse } from '../../../../src/server/types';

export const SIMPLE_SEARCH_DEBOUNCE_MS = 600;
export const SIMPLE_SEARCH_LIMIT = 5;
export const SIMPLE_SEARCH_EXAMPLES = ['deployment notes', 'vector memory', 'recent lessons'];
export const SIMPLE_SEARCH_EMPTY = 'Nothing found, try different words';

type SimpleSearchResult = VectorSearchResponse['results'][number];
type SimpleSearchState = 'idle' | 'loading' | 'ready' | 'error';
export type SimpleSearchClient = Pick<ApiClient, 'vectorSearch'>;

export function visibleSimpleResults(results: SimpleSearchResult[]): SimpleSearchResult[] {
  return results.slice(0, SIMPLE_SEARCH_LIMIT);
}

export function simpleSearchStatus(state: SimpleSearchState, query: string, count: number): string {
  if (state === 'loading') return `Searching “${query}”…`;
  if (state === 'error') return 'Search had trouble. Try different words or retry.';
  if (state === 'ready' && count === 0) return SIMPLE_SEARCH_EMPTY;
  if (state === 'ready') return `${count} result${count === 1 ? '' : 's'} found.`;
  return 'Search your Oracle memory. Results appear here.';
}

export function SimpleSearch({ client = apiClient }: { client?: SimpleSearchClient }) {
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<SimpleSearchResult[]>([]);
  const [state, setState] = useState<SimpleSearchState>('idle');
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback(async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q) {
      setActiveQuery('');
      setResults([]);
      setError('');
      setState('idle');
      return;
    }

    const requestId = ++requestRef.current;
    setActiveQuery(q);
    setState('loading');
    setError('');
    try {
      const response = await client.vectorSearch({ q, limit: SIMPLE_SEARCH_LIMIT });
      if (requestId !== requestRef.current) return;
      setResults(visibleSimpleResults(Array.isArray(response.results) ? response.results : []));
      setState('ready');
    } catch (err) {
      if (requestId !== requestRef.current) return;
      setResults([]);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [client]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => void runSearch(query), SIMPLE_SEARCH_DEBOUNCE_MS);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [query, runSearch]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (timerRef.current) clearTimeout(timerRef.current);
    void runSearch(query);
  }

  function chooseExample(example: string) {
    setQuery(example);
  }

  const status = simpleSearchStatus(state, activeQuery || query.trim(), results.length);

  return (
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="simple-search-title">
      <div className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Search</p>
        <h2 id="simple-search-title" className="mt-2 text-2xl font-semibold text-text">Ask your Oracle</h2>
        <p className="mt-2 text-sm text-text-muted">Type a few words. Search results stay on this page.</p>
      </div>

      <form aria-label="Simple search form" onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
        <input
          aria-label="Simple search query"
          className="focus-ring h-12 min-w-0 flex-1 rounded-xl border border-border bg-field px-4 text-base text-text placeholder:text-slate-600"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memory…"
          type="search"
        />
        <button
          className="focus-ring h-11 rounded-xl bg-accent-solid px-5 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={state === 'loading' || !query.trim()}
          type="submit"
        >
          Search
        </button>
      </form>

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Example searches">
        {SIMPLE_SEARCH_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            className="focus-ring rounded-full border border-border px-3 py-2 text-sm text-text hover:border-accent-border"
            onClick={() => chooseExample(example)}
          >
            {example}
          </button>
        ))}
      </div>

      <p className="mt-4 text-sm text-text-muted" aria-live="polite">{status}</p>
      {error ? <p role="alert" className="mt-2 text-sm text-err-text">{error}</p> : null}

      <div className="mt-5 grid gap-3" aria-busy={state === 'loading'}>
        {state !== 'loading' ? results.map((result) => <SimpleResultCard key={result.id} result={result} />) : null}
      </div>
    </section>
  );
}
