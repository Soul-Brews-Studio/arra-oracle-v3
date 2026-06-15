import { useMemo, useState } from 'react';
import { searchVector } from '../api';
import type { SearchResult } from '../types';

function titleFor(result: SearchResult): string {
  return result.title || result.source_file || result.id;
}

function previewFor(result: SearchResult): string {
  const text = result.content || 'No preview returned.';
  return text.length > 320 ? `${text.slice(0, 320)}…` : text;
}

function scoreLabel(score?: number): string | null {
  if (typeof score !== 'number') return null;
  return `${Math.round(score * 100)}%`;
}

function ResultCard({ result }: { result: SearchResult }) {
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

export function VectorSearchWidget() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');

  const status = useMemo(() => {
    if (state === 'loading') return 'Searching vector memory…';
    if (state === 'idle') return 'Submit a semantic query to search /api/search?mode=vector.';
    if (state === 'error') return 'Vector search failed.';
    if (!results.length) return 'No vector matches found.';
    return `${results.length} shown${total > results.length ? ` of ${total}` : ''}`;
  }, [results.length, state, total]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setState('loading');
    setError('');
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
          {state === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <p className="mt-4 text-sm text-slate-500">{status}</p>
      {error ? <p className="mt-3 rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">{error}</p> : null}
      <div className="mt-5 grid gap-3">{results.map((result) => <ResultCard key={result.id} result={result} />)}</div>
    </section>
  );
}
