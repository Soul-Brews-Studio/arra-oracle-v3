import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../AsyncState';
import { BackendSelector, DEFAULT_BACKEND_URL, normalizeBackendUrl } from './BackendSelector';

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
type TestState = 'idle' | 'testing' | 'connected' | 'failed';

export type ExportAppCollection = {
  name: string;
  count: number;
  description?: string;
};

type ConnectionTestProps = {
  initialBackendUrl?: string;
  fetcher?: Fetcher;
};

type RawCollection = {
  name?: unknown;
  key?: unknown;
  collection?: unknown;
  title?: unknown;
  count?: unknown;
  docs?: unknown;
  docCount?: unknown;
  documentCount?: unknown;
  description?: unknown;
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function apiUrl(backendUrl: string, path: string): string {
  return new URL(path, `${normalizeBackendUrl(backendUrl)}/`).toString();
}

function readCollection(raw: RawCollection, index: number): ExportAppCollection {
  const name = text(raw.name) || text(raw.key) || text(raw.collection) || text(raw.title) || `collection-${index + 1}`;
  return {
    name,
    count: numberValue(raw.count ?? raw.docs ?? raw.docCount ?? raw.documentCount),
    description: text(raw.description) || undefined,
  };
}

export function normalizeCollections(payload: unknown): ExportAppCollection[] {
  const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const list = Array.isArray(payload)
    ? payload
    : [record.collections, record.items, record.data].find(Array.isArray) ?? [];
  return list
    .filter((item): item is RawCollection => Boolean(item) && typeof item === 'object')
    .map(readCollection)
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function readJson(response: Response): Promise<unknown> {
  const textBody = await response.text();
  return textBody ? JSON.parse(textBody) : {};
}

function statusClass(state: TestState): string {
  if (state === 'connected') return 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100';
  if (state === 'failed') return 'border-red-300/30 bg-red-300/10 text-red-100';
  return 'border-amber-300/30 bg-amber-300/10 text-amber-100';
}

function statusLabel(state: TestState): string {
  if (state === 'connected') return 'Connected';
  if (state === 'failed') return 'Disconnected';
  if (state === 'testing') return 'Testing';
  return 'Not tested';
}

function CollectionList({ collections }: { collections: ExportAppCollection[] }) {
  if (!collections.length) return <p className="text-sm text-slate-500">No export collections were returned.</p>;
  return (
    <ul className="grid gap-2" aria-label="Available export collections">
      {collections.map((collection) => (
        <li key={collection.name} className="rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold text-white">{collection.name}</p>
              {collection.description ? <p className="mt-1 text-xs text-slate-500">{collection.description}</p> : null}
            </div>
            <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
              {collection.count.toLocaleString()} docs
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ConnectionTest({ initialBackendUrl = DEFAULT_BACKEND_URL, fetcher = globalThis.fetch?.bind(globalThis) }: ConnectionTestProps) {
  const [backendUrl, setBackendUrl] = useState(() => normalizeBackendUrl(initialBackendUrl));
  const [state, setState] = useState<TestState>('idle');
  const [message, setMessage] = useState('Enter a backend URL and test the export app API.');
  const [collections, setCollections] = useState<ExportAppCollection[]>([]);

  const totalDocs = useMemo(() => collections.reduce((total, item) => total + item.count, 0), [collections]);

  async function testConnection() {
    if (!fetcher) {
      setState('failed');
      setMessage('fetch is unavailable in this runtime.');
      return;
    }
    const normalized = normalizeBackendUrl(backendUrl);
    setBackendUrl(normalized);
    setState('testing');
    setMessage(`Testing ${normalized}...`);
    try {
      const health = await fetcher(apiUrl(normalized, '/api/v1/health'), { headers: { accept: 'application/json' } });
      if (!health.ok) throw new Error(`/api/v1/health returned ${health.status}`);

      const collectionResponse = await fetcher(apiUrl(normalized, '/api/v1/export/app/collections'), {
        headers: { accept: 'application/json' },
      });
      if (!collectionResponse.ok) throw new Error(`/api/v1/export/app/collections returned ${collectionResponse.status}`);

      const nextCollections = normalizeCollections(await readJson(collectionResponse));
      setCollections(nextCollections);
      setState('connected');
      setMessage(`Connected to ${normalized}.`);
    } catch (error) {
      setCollections([]);
      setState('failed');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  useEffect(() => {
    void testConnection();
  }, []);

  return (
    <section className="grid gap-4 rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="export-connection-title">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Export app</p>
          <h2 id="export-connection-title" className="mt-2 text-2xl font-semibold text-white">Backend connection</h2>
          <p className="mt-2 text-sm text-slate-400">Test export app access and inspect available collections.</p>
        </div>
        <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] ${statusClass(state)}`}>
          {statusLabel(state)}
        </span>
      </div>

      <BackendSelector value={backendUrl} onChange={setBackendUrl} />
      <div className="flex flex-wrap items-center gap-3">
        <button
          className="focus-ring rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={state === 'testing'}
          type="button"
          onClick={() => void testConnection()}
        >
          {state === 'testing' ? <Spinner label="Testing" /> : 'Test connection'}
        </button>
        <p className="text-sm text-slate-500">{message}</p>
      </div>

      {state === 'testing' ? <LoadingPanel title="Testing backend..." detail="Checking /api/v1/health and loading export collections." /> : null}
      {state === 'failed' ? <ErrorMessage title="Connection failed." message={message} /> : null}

      <section className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="Export collections">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-white">Collections</h3>
          <span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-300">
            {totalDocs.toLocaleString()} docs
          </span>
        </div>
        <CollectionList collections={collections} />
      </section>
    </section>
  );
}
