import { useCallback, useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { BackendSelector, DEFAULT_BACKEND_URL, normalizeBackendUrl } from '../components/export/BackendSelector';
import { ExportHelp } from '../components/export/ExportHelp';
import { ExportProgress } from '../components/export/ExportProgress';
import { ExportSummary } from '../components/export/ExportSummary';
import { useExport, type ExportRunPayload } from '../hooks/useExport';

type LoadState = 'loading' | 'ready' | 'error';
type ExportFormat = 'json' | 'csv' | 'markdown' | 'jsonl';
type ExportFetch = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

type ExportCollection = {
  id: string;
  label: string;
  rowCount?: number;
};

const formatLabels: Record<ExportFormat, string> = {
  json: 'JSON',
  csv: 'CSV',
  markdown: 'Markdown',
  jsonl: 'JSONL',
};
const defaultFormats = Object.keys(formatLabels) as ExportFormat[];
const formatSet = new Set<string>(defaultFormats);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function collectionFrom(item: unknown): ExportCollection | null {
  if (typeof item === 'string') return { id: item, label: item };
  if (!isRecord(item)) return null;
  const id = text(item.key) || text(item.name) || text(item.collection);
  if (!id) return null;
  const label = text(item.label) || text(item.name) || text(item.collection) || id;
  const rowCount = numberValue(item.rowCount) ?? numberValue(item.count);
  return { id, label, rowCount };
}

export function normalizeExportCollections(payload: unknown): ExportCollection[] {
  const record = isRecord(payload) ? payload : {};
  const raw = Array.isArray(record.collections) ? record.collections : Array.isArray(payload) ? payload : [];
  const collections = raw
    .map(collectionFrom)
    .filter((item): item is ExportCollection => Boolean(item));
  const graphCollection = isRecord(record.graph) ? text(record.graph.collection) : '';
  if (graphCollection && !collections.some((item) => item.id === graphCollection)) {
    collections.push({ id: graphCollection, label: 'Graph relationships' });
  }
  return collections.sort((left, right) => {
    if (left.id === graphCollection) return 1;
    if (right.id === graphCollection) return -1;
    return left.label.localeCompare(right.label);
  });
}

export function normalizeExportFormats(payload: unknown): ExportFormat[] {
  const raw = isRecord(payload) && Array.isArray(payload.formats) ? payload.formats : [];
  const formats = raw.filter((item): item is ExportFormat => typeof item === 'string' && formatSet.has(item));
  return formats.length ? formats : defaultFormats;
}

function collectionLabel(collection: ExportCollection): string {
  const rows = typeof collection.rowCount === 'number' ? ` · ${collection.rowCount.toLocaleString()} rows` : '';
  return `${collection.label}${rows}`;
}

function backendFetch(backendUrl: string): ExportFetch {
  const base = `${normalizeBackendUrl(backendUrl)}/`;
  return (input, init) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const source = new URL(raw, base);
    const target = source.pathname.startsWith('/api/')
      ? new URL(`${source.pathname}${source.search}`, base)
      : source;
    return fetch(target, init);
  };
}

function backendApiUrl(backendUrl: string, path: string): string {
  return new URL(path, `${normalizeBackendUrl(backendUrl)}/`).toString();
}

async function readJson(response: Response): Promise<unknown> {
  const body = await response.text();
  return body ? JSON.parse(body) : {};
}

export function ExportPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [backendUrl, setBackendUrl] = useState(DEFAULT_BACKEND_URL);
  const [collections, setCollections] = useState<ExportCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [formats, setFormats] = useState<ExportFormat[]>(defaultFormats);
  const [format, setFormat] = useState<ExportFormat>('json');
  const [includeGraph, setIncludeGraph] = useState(true);
  const fetcher = useMemo(() => backendFetch(backendUrl), [backendUrl]);
  const progressUrl = useCallback((jobId: string) => backendApiUrl(backendUrl, `/api/v1/export/progress?jobId=${encodeURIComponent(jobId)}`), [backendUrl]);
  const exportRun = useExport({ fetcher, pollMs: 800, progressUrl });
  const resetExport = exportRun.reset;

  const loadCollections = useCallback(async () => {
    setState('loading');
    setError('');
    resetExport();
    try {
      const response = await fetcher('/api/v1/export/app/collections', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error(`/api/v1/export/app/collections returned ${response.status}`);
      const payload = await readJson(response);
      const nextCollections = normalizeExportCollections(payload);
      const nextFormats = normalizeExportFormats(payload);
      setCollections(nextCollections);
      setFormats(nextFormats);
      setCollection((current) => current && nextCollections.some((item) => item.id === current) ? current : nextCollections[0]?.id ?? '');
      setFormat((current) => nextFormats.includes(current) ? current : nextFormats[0] ?? 'json');
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }, [fetcher, resetExport]);

  useEffect(() => {
    void loadCollections();
    // Initial load only; explicit reload avoids probing partial typed URLs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = collections.find((item) => item.id === collection);
  const summaryCollections = selected ? [{ name: selected.label, docCount: selected.rowCount }] : [];
  const relationshipCount = includeGraph ? collections.find((item) => item.id === 'relationships')?.rowCount : 0;
  const active = exportRun.status === 'starting' || exportRun.status === 'running';

  function resetRun() {
    resetExport();
  }

  function startExport() {
    const payload: ExportRunPayload = { collection, format, includeGraph };
    void exportRun.start(payload);
  }

  return (
    <div className="grid gap-5">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="export-page-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Export app</p>
        <h1 id="export-page-title" className="mt-2 text-3xl font-semibold text-on-accent dark:text-text">Export collections</h1>
        <p className="mt-2 text-sm text-text-muted dark:text-text-muted">Choose a database collection, export format, graph option, then download the generated snapshot.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <BackendSelector value={backendUrl} onChange={(url) => { setBackendUrl(url); resetRun(); }} />
        <button
          className="focus-ring rounded-2xl border border-accent-border px-5 py-3 text-sm font-semibold text-accent hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-60 dark:border-accent-border dark:text-accent dark:hover:bg-accent-soft"
          disabled={state === 'loading'}
          type="button"
          onClick={() => void loadCollections()}
        >
          {state === 'loading' ? <Spinner label="Loading collections" /> : 'Reload collections'}
        </button>
      </div>

      {state === 'loading' ? <LoadingPanel title="Loading collections" detail="Fetching /api/v1/export/app/collections." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load export collections." message={error} /> : null}

      <div className="grid gap-4 lg:grid-cols-4">
        <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-collection-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Collection</p>
          <h2 id="export-collection-title" className="mt-2 text-2xl font-semibold text-on-accent dark:text-text">Collection picker</h2>
          <label className="mt-5 grid gap-2 text-sm font-medium text-text dark:text-text-muted">
            Collection
            <select
              aria-label="Export collection"
              className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-on-accent dark:border-border dark:bg-field dark:text-text"
              disabled={state !== 'ready' || collections.length === 0}
              value={collection}
              onChange={(event) => { setCollection(event.target.value); resetRun(); }}
            >
              {collections.length ? collections.map((item) => (
                <option key={item.id} value={item.id}>{collectionLabel(item)}</option>
              )) : <option value="">No collections loaded</option>}
            </select>
          </label>
        </section>

        <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-format-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Format</p>
          <h2 id="export-format-title" className="mt-2 text-2xl font-semibold text-on-accent dark:text-text">Format picker</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Export format">
            {formats.map((item) => (
              <label key={item} className="glass flex min-h-12 items-center gap-3 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md px-4 py-3 text-sm text-text dark:text-text">
                <input className="h-4 w-4 accent-teal-300" checked={format === item} name="export-format" type="radio" value={item} onChange={() => { setFormat(item); resetRun(); }} />
                <span className="font-semibold">{formatLabels[item]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-options-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Options</p>
          <h2 id="export-options-title" className="mt-2 text-2xl font-semibold text-on-accent dark:text-text">Graph relationships</h2>
          <label className="glass mt-5 flex items-center justify-between gap-4 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md px-4 py-3 text-sm text-text dark:text-text">
            <span className="font-semibold">Include graph relationships in the export file</span>
            <input className="h-5 w-5 accent-teal-300" checked={includeGraph} type="checkbox" onChange={(event) => { setIncludeGraph(event.target.checked); resetRun(); }} />
          </label>
        </section>

        <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-action-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent dark:text-accent">Export</p>
          <h2 id="export-action-title" className="mt-2 text-2xl font-semibold text-on-accent dark:text-text">Run export</h2>
          <button
            className="focus-ring mt-5 rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent transition hover:bg-accent-solid disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!collection || state !== 'ready' || active}
            type="button"
            onClick={startExport}
          >
            {active ? <Spinner label="Exporting" /> : 'Export and prepare download'}
          </button>
        </section>
      </div>

      <ExportSummary collections={summaryCollections} format={format} relationshipCount={relationshipCount} />
      <ExportProgress state={exportRun} title="Export progress" onRetry={() => void exportRun.retry()} />
      <ExportHelp backendUrl={normalizeBackendUrl(backendUrl)} />
    </div>
  );
}
