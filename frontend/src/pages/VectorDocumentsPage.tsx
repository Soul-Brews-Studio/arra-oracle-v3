import { useEffect, useMemo, useState } from 'react';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type VectorCollection = {
  key: string;
  collection: string;
  model?: string;
  adapter?: string;
  count?: number;
};

type VectorDocument = {
  id: string;
  content: string;
  type?: string;
  source_file?: string;
  metadata?: Record<string, unknown>;
};

type DocumentsResponse = {
  documents: VectorDocument[];
  total: number;
  page: number;
  limit: number;
  hasNext: boolean;
};

const PAGE_LIMIT = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' }, signal });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return data as T;
}

export function contentPreview(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  return compact.length > 100 ? `${compact.slice(0, 100)}…` : compact;
}

export function normalizeVectorCollections(payload: unknown): VectorCollection[] {
  const raw = isRecord(payload) ? payload.models : payload;
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      const row = isRecord(item) ? item : {};
      const collection = str(row.collection, str(row.name, str(row.key, `collection-${index + 1}`)));
      return { key: str(row.key, collection), collection, model: str(row.model), adapter: str(row.adapter), count: optionalNum(row.count) };
    });
  }
  if (!isRecord(raw)) return [];
  return Object.entries(raw).map(([key, value]) => {
    const row = isRecord(value) ? value : {};
    return { key, collection: str(row.collection, key), model: str(row.model), adapter: str(row.adapter), count: optionalNum(row.count) };
  });
}

export function normalizeVectorDocuments(payload: unknown, fallbackPage: number, fallbackLimit: number): DocumentsResponse {
  const row = isRecord(payload) ? payload : {};
  const rawDocs = Array.isArray(row.documents) ? row.documents : Array.isArray(row.items) ? row.items : [];
  const documents = rawDocs.map((item, index): VectorDocument => {
    const doc = isRecord(item) ? item : {};
    const metadata = isRecord(doc.metadata) ? doc.metadata : undefined;
    return {
      id: str(doc.id, `document-${index + 1}`),
      content: str(doc.content, str(doc.document)),
      type: str(doc.type, str(metadata?.type, '—')),
      source_file: str(doc.source_file, str(doc.sourceFile, str(metadata?.source_file, '—'))),
      metadata,
    };
  });
  const total = num(row.total, documents.length);
  const page = num(row.page, fallbackPage);
  const limit = num(row.limit, fallbackLimit);
  const hasNext = typeof row.hasNext === 'boolean' ? row.hasNext : page * limit < total;
  return { documents, total, page, limit, hasNext };
}

function metadataText(document: VectorDocument): string {
  return JSON.stringify(document.metadata ?? {}, null, 2);
}

export function VectorDocumentsPage() {
  const [collections, setCollections] = useState<VectorCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [documents, setDocuments] = useState<VectorDocument[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetchJson('/api/vector/index/models', controller.signal)
      .then((data) => {
        const next = normalizeVectorCollections(data);
        setCollections(next);
        setCollection((current) => current || next[0]?.collection || '');
      })
      .catch((err) => { if (!isAbort(err)) setError(err instanceof Error ? err.message : String(err)); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!collection) return;
    const controller = new AbortController();
    const qs = new URLSearchParams({ collection, page: String(page), limit: String(PAGE_LIMIT) });
    setState('loading');
    setError('');
    fetchJson(`/api/vector/documents?${qs}`, controller.signal)
      .then((data) => {
        const next = normalizeVectorDocuments(data, page, PAGE_LIMIT);
        setDocuments(next.documents);
        setTotal(next.total);
        setHasNext(next.hasNext);
        setExpandedId(null);
        setState('ready');
      })
      .catch((err) => {
        if (isAbort(err)) return;
        setDocuments([]);
        setTotal(0);
        setHasNext(false);
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
    return () => controller.abort();
  }, [collection, page]);

  const status = useMemo(() => {
    if (!collection) return 'Select a vector collection to browse documents.';
    if (state === 'loading') return `Loading page ${page} from ${collection}…`;
    if (state === 'error') return 'Could not load vector documents.';
    if (!documents.length) return `No documents found in ${collection}.`;
    return `Showing ${documents.length} of ${total} documents from ${collection}.`;
  }, [collection, documents.length, page, state, total]);

  function chooseCollection(next: string) {
    setCollection(next);
    setPage(1);
  }

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-documents-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Vector</p>
        <h1 id="vector-documents-title" className="mt-2 text-3xl font-semibold text-white">Vector documents</h1>
        <p className="mt-2 text-sm text-slate-400">Browse indexed document content and metadata by collection.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-2 text-sm font-medium text-slate-300">
          Collection
          <select aria-label="Vector collection" className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100" value={collection} onChange={(event) => chooseCollection(event.target.value)}>
            {collections.length ? collections.map((item) => (
              <option key={item.collection} value={item.collection}>{item.key} · {item.collection}{item.count !== undefined ? ` (${item.count})` : ''}</option>
            )) : <option value="">No collections loaded</option>}
          </select>
        </label>
        <p className="text-sm text-slate-500">Page {page} · limit {PAGE_LIMIT}</p>
      </div>

      <p className="mt-4 text-sm text-slate-500">{status}</p>
      {error ? <p role="alert" className="mt-3 rounded-xl border border-red-400/30 bg-red-950/40 p-3 text-sm text-red-100">{error}</p> : null}

      <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-sm">
          <thead className="bg-white/5 text-xs uppercase tracking-[0.18em] text-slate-400">
            <tr><th className="px-4 py-3">ID</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Source file</th><th className="px-4 py-3">Preview</th></tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-slate-200" aria-busy={state === 'loading'}>
            {documents.map((document) => {
              const expanded = expandedId === document.id;
              return (
                <tr key={document.id} role="button" tabIndex={0} aria-expanded={expanded} className="cursor-pointer align-top hover:bg-white/[0.04]" onClick={() => setExpandedId(expanded ? null : document.id)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setExpandedId(expanded ? null : document.id); } }}>
                  <td className="px-4 py-3 font-mono text-xs text-teal-200">{document.id}</td>
                  <td className="px-4 py-3 text-slate-300">{document.type || '—'}</td>
                  <td className="px-4 py-3 text-slate-300">{document.source_file || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{expanded ? <div className="grid gap-3"><p className="whitespace-pre-wrap text-slate-200">{document.content}</p><pre className="overflow-x-auto rounded-xl bg-slate-900 p-3 text-xs text-slate-300">{metadataText(document)}</pre></div> : contentPreview(document.content)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={page <= 1 || state === 'loading'} type="button" onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
        <span className="text-sm text-slate-500">{total ? `Rows ${(page - 1) * PAGE_LIMIT + 1}-${Math.min(page * PAGE_LIMIT, total)} of ${total}` : 'No rows'}</span>
        <button className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200 disabled:cursor-not-allowed disabled:opacity-50" disabled={!hasNext || state === 'loading'} type="button" onClick={() => setPage((value) => value + 1)}>Next</button>
      </div>
    </section>
  );
}
