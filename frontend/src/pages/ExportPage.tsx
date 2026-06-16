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
      <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/70 sm:p-6" aria-labelledby="export-page-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Export app</p>
        <h1 id="export-page-title" className="mt-2 text-3xl font-semibold text-slate-950 dark:text-white">Export collections</h1>
        <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Choose a database collection, export format, graph option, then download the generated snapshot.</p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <BackendSelector value={backendUrl} onChange={(url) => { setBackendUrl(url); resetRun(); }} />
        <button
          className="focus-ring rounded-2xl border border-teal-600/30 px-5 py-3 text-sm font-semibold text-teal-700 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-teal-300/30 dark:text-teal-100 dark:hover:bg-teal-300/10"
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
        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/70 sm:p-6 lg:col-span-2" aria-labelledby="export-collection-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Collection</p>
          <h2 id="export-collection-title" className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Collection picker</h2>
          <label className="mt-5 grid gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
            Collection
            <select
              aria-label="Export collection"
              className="focus-ring rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-950 dark:border-white/10 dark:bg-slate-950 dark:text-slate-100"
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

        <section className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] sm:p-6 lg:col-span-2" aria-labelledby="export-format-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Format</p>
          <h2 id="export-format-title" className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Format picker</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Export format">
            {formats.map((item) => (
              <label key={item} className="flex min-h-12 items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200">
                <input className="h-4 w-4 accent-teal-300" checked={format === item} name="export-format" type="radio" value={item} onChange={() => { setFormat(item); resetRun(); }} />
                <span className="font-semibold">{formatLabels[item]}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/80 p-5 shadow-sm dark:border-white/10 dark:bg-white/[0.03] sm:p-6 lg:col-span-2" aria-labelledby="export-options-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Options</p>
          <h2 id="export-options-title" className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Graph relationships</h2>
          <label className="mt-5 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-950/60 dark:text-slate-200">
            <span className="font-semibold">Include graph relationships in the export file</span>
            <input className="h-5 w-5 accent-teal-300" checked={includeGraph} type="checkbox" onChange={(event) => { setIncludeGraph(event.target.checked); resetRun(); }} />
          </label>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white/90 p-5 shadow-sm dark:border-white/10 dark:bg-slate-950/70 sm:p-6 lg:col-span-2" aria-labelledby="export-action-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-600 dark:text-teal-300">Export</p>
          <h2 id="export-action-title" className="mt-2 text-2xl font-semibold text-slate-950 dark:text-white">Run export</h2>
          <button
            className="focus-ring mt-5 rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
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
