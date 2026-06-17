import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { apiClient, type ApiClient, type VectorIndexModelsResponse } from '../api/client';
import type { VectorSearchResponse } from '../../../src/server/types';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type VectorSearchResult = VectorSearchResponse['results'][number];
type VectorSearchClient = Pick<ApiClient, 'vectorIndexModels' | 'vectorSearch'>;

export type VectorSearchCollection = {
  key: string;
  collection: string;
  model: string;
  adapter: string;
  count?: number;
};

const FALLBACK_COLLECTIONS: VectorSearchCollection[] = [
  { key: 'bge-m3', collection: 'oracle_knowledge_bge_m3', model: 'bge-m3', adapter: 'lancedb' },
  { key: 'nomic', collection: 'oracle_knowledge', model: 'nomic-embed-text', adapter: 'lancedb' },
  { key: 'qwen3', collection: 'oracle_knowledge_qwen3', model: 'qwen3-embedding', adapter: 'lancedb' },
];

export function collectionsFromModels(response?: VectorIndexModelsResponse | null): VectorSearchCollection[] {
  const entries = Object.entries(response?.models ?? {});
  if (!entries.length) return FALLBACK_COLLECTIONS;
  return entries
    .map(([key, value]) => ({
      key,
      collection: value.collection || key,
      model: value.model || key,
      adapter: value.adapter || 'unknown',
      count: value.count,
    }))
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

export function contentPreview(content: string, maxLength = 180): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact;
  return `${compact.slice(0, maxLength - 1).trimEnd()}…`;
}

export function distanceLabel(result: Pick<VectorSearchResult, 'distance' | 'score'>): string {
  if (typeof result.distance === 'number' && Number.isFinite(result.distance)) return result.distance.toFixed(3);
  if (typeof result.score === 'number' && Number.isFinite(result.score)) return `${(result.score * 100).toFixed(1)}%`;
  return '—';
}

export function distancePercent(result: Pick<VectorSearchResult, 'distance' | 'score'>): number {
  if (typeof result.score === 'number' && Number.isFinite(result.score)) return Math.max(0, Math.min(100, result.score * 100));
  if (typeof result.distance === 'number' && Number.isFinite(result.distance)) return Math.max(0, Math.min(100, (1 / (1 + Math.max(0, result.distance))) * 100));
  return 0;
}

function titleFor(result: VectorSearchResult): string {
  return ('title' in result && typeof result.title === 'string' && result.title) || result.source_file || result.id;
}

function conceptsFor(result: VectorSearchResult): string[] {
  return Array.isArray(result.concepts) ? result.concepts.filter((item) => typeof item === 'string') : [];
}

function collectionLabel(item: VectorSearchCollection): string {
  const count = typeof item.count === 'number' ? ` · ${item.count.toLocaleString()} docs` : '';
  return `${item.key} · ${item.collection}${count}`;
}

function ResultCard({ result }: { result: VectorSearchResult }) {
  const percent = distancePercent(result);
  const concepts = conceptsFor(result);
  return (
    <article className="rounded-2xl border border-border bg-slate-900/70 p-4 shadow-lg shadow-black/20">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-text">{titleFor(result)}</h2>
          <p className="mt-1 text-sm leading-6 text-text-muted">{contentPreview(result.content)}</p>
        </div>
        <span className="rounded-full border border-accent-border px-2 py-1 text-xs font-semibold text-accent">
          distance {distanceLabel(result)}
        </span>
      </div>
      <div className="mt-4" aria-label="Vector distance score">
        <div className="h-2 overflow-hidden rounded-full bg-slate-800">
          <span className="block h-full rounded-full bg-gradient-to-r from-teal-400 to-cyan-300" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <dl aria-label="Vector result metadata" className="mt-4 grid gap-2 text-xs text-text-muted sm:grid-cols-3">
        <div><dt className="font-semibold text-text-muted">type</dt><dd>{result.type || '—'}</dd></div>
        <div><dt className="font-semibold text-text-muted">source_file</dt><dd className="break-all">{result.source_file || '—'}</dd></div>
        <div><dt className="font-semibold text-text-muted">model</dt><dd>{result.model || 'selected collection'}</dd></div>
        {concepts.length ? <div className="sm:col-span-3"><dt className="font-semibold text-text-muted">concepts</dt><dd className="mt-1 flex flex-wrap gap-1">{concepts.map((concept) => <span key={concept} className="rounded-full border border-accent-border px-2 py-0.5 text-accent">{concept}</span>)}</dd></div> : null}
      </dl>
    </article>
  );
}

export function VectorSearchPage({ client = apiClient }: { client?: VectorSearchClient }) {
  const [collections, setCollections] = useState(FALLBACK_COLLECTIONS);
  const [collectionKey, setCollectionKey] = useState(FALLBACK_COLLECTIONS[0].key);
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [results, setResults] = useState<VectorSearchResult[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    client.vectorIndexModels()
      .then((response) => {
        if (cancelled) return;
        const next = collectionsFromModels(response);
        setCollections(next);
        setCollectionKey((current) => next.some((item) => item.key === current) ? current : next[0].key);
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [client]);

  const status = useMemo(() => {
    if (state === 'idle') return 'Enter a query and choose a collection to preview vector matches.';
    if (state === 'loading') return `Searching “${activeQuery}”…`;
    if (state === 'error') return 'Vector search failed.';
    if (!results.length) return `No vector matches found for “${activeQuery}”.`;
    return `${results.length} shown${total > results.length ? ` of ${total}` : ''} for “${activeQuery}”.`;
  }, [activeQuery, results.length, state, total]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    setState('loading');
    setError('');
    setActiveQuery(q);
    try {
      const response = await client.vectorSearch({ q, limit: 20, model: collectionKey });
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
    <section className="rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-search-preview-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Vector</p>
        <h1 id="vector-search-preview-title" className="mt-2 text-3xl font-semibold text-text">Vector search preview</h1>
        <p className="mt-2 text-sm text-text-muted">Preview semantic matches from /api/v1/vector/search by collection.</p>
      </div>

      <form aria-label="Vector search preview form" onSubmit={submit} className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_18rem_auto]">
        <input aria-label="Vector search query" className="focus-ring min-w-0 rounded-xl border border-border bg-field px-4 py-3 text-text placeholder:text-slate-600" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vector memory…" type="search" />
        <select aria-label="Vector collection" className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text" value={collectionKey} onChange={(event) => setCollectionKey(event.target.value)}>
          {collections.map((collection) => <option key={collection.key} value={collection.key}>{collectionLabel(collection)}</option>)}
        </select>
        <button aria-label="Submit vector search" className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={state === 'loading' || !query.trim()} type="submit">
          {state === 'loading' ? 'Searching…' : 'Search'}
        </button>
      </form>

      <p className="mt-4 text-sm text-text-muted">{status}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl border border-err-border bg-err-bg p-3 text-sm text-err-text">{error}</p> : null}
      <div className="mt-5 grid gap-3 lg:grid-cols-2" aria-busy={state === 'loading'}>
        {state !== 'loading' ? results.map((result) => <ResultCard key={result.id} result={result} />) : null}
      </div>
    </section>
  );
}
