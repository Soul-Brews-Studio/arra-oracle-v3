import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { ConnectionTest } from '../components/export/ConnectionTest';
import { apiUrl } from '../api/oracle';

type LoadState = 'loading' | 'ready' | 'error';
type ExportFormat = 'json' | 'csv' | 'markdown' | 'jsonl';

type ExportCollection = {
  id: string;
  label: string;
  rowCount?: number;
};

const formats: Array<{ value: ExportFormat; label: string }> = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'jsonl', label: 'JSONL' },
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeExportCollections(payload: unknown): ExportCollection[] {
  const raw = isRecord(payload) ? payload.collections : payload;
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item): ExportCollection | null => {
      if (typeof item === 'string') return { id: item, label: item };
      if (!isRecord(item)) return null;
      const id = text(item.key) || text(item.name) || text(item.collection);
      if (!id) return null;
      const label = text(item.label) || text(item.name) || text(item.collection) || id;
      const rowCount = numberValue(item.rowCount) ?? numberValue(item.count);
      return { id, label, rowCount };
    })
    .filter((item): item is ExportCollection => Boolean(item))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function collectionLabel(collection: ExportCollection): string {
  const rows = typeof collection.rowCount === 'number' ? ` · ${collection.rowCount.toLocaleString()} rows` : '';
  return `${collection.label}${rows}`;
}

function exportUrl(collection: string, format: ExportFormat, includeGraph: boolean, includeMetadata: boolean): string {
  const query = new URLSearchParams({
    collection,
    format,
    includeGraph: String(includeGraph),
    includeMetadata: String(includeMetadata),
  });
  return apiUrl(`/api/v1/export/app?${query.toString()}`);
}

export function ExportPage() {
  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState('');
  const [collections, setCollections] = useState<ExportCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [format, setFormat] = useState<ExportFormat>('json');
  const [includeGraph, setIncludeGraph] = useState(true);
  const [includeMetadata, setIncludeMetadata] = useState(true);
  const [downloadUrl, setDownloadUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    setState('loading');
    setError('');
    fetch(apiUrl('/api/v1/export/app/collections'), { headers: { accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`/api/v1/export/app/collections returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        const next = normalizeExportCollections(payload);
        setCollections(next);
        setCollection((current) => current || next[0]?.id || '');
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
    return () => { cancelled = true; };
  }, []);

  const currentUrl = useMemo(
    () => collection ? exportUrl(collection, format, includeGraph, includeMetadata) : '',
    [collection, format, includeGraph, includeMetadata],
  );

  function prepareDownload() {
    setDownloadUrl(currentUrl);
  }

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="export-page-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Export app</p>
        <h1 id="export-page-title" className="mt-2 text-3xl font-semibold text-white">Export collections</h1>
        <p className="mt-2 text-sm text-slate-400">Prepare database collection downloads from /api/v1/export/app.</p>
      </section>

      {state === 'loading' ? <LoadingPanel title="Loading collections" detail="Fetching /api/v1/export/app/collections." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load export collections." message={error} /> : null}
      <ConnectionTest />

      <div className="grid gap-4 lg:grid-cols-4">
        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-collection-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Collection</p>
          <h2 id="export-collection-title" className="mt-2 text-2xl font-semibold text-white">Collection picker</h2>
          <label className="mt-5 grid gap-2 text-sm font-medium text-slate-300">
            Collection
            <select
              aria-label="Export collection"
              className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100"
              disabled={state !== 'ready' || collections.length === 0}
              value={collection}
              onChange={(event) => { setCollection(event.target.value); setDownloadUrl(''); }}
            >
              {collections.length ? collections.map((item) => (
                <option key={item.id} value={item.id}>{collectionLabel(item)}</option>
              )) : <option value="">No collections loaded</option>}
            </select>
          </label>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-format-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Format</p>
          <h2 id="export-format-title" className="mt-2 text-2xl font-semibold text-white">Format selector</h2>
          <div className="mt-5 grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Export format">
            {formats.map((item) => (
              <label key={item.value} className="flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
                <input
                  className="h-4 w-4 accent-teal-300"
                  checked={format === item.value}
                  name="export-format"
                  type="radio"
                  value={item.value}
                  onChange={() => { setFormat(item.value); setDownloadUrl(''); }}
                />
                <span className="font-semibold">{item.label}</span>
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-options-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Options</p>
          <h2 id="export-options-title" className="mt-2 text-2xl font-semibold text-white">Export options</h2>
          <div className="mt-5 grid gap-3">
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
              <span className="font-semibold">Include graph</span>
              <input className="h-5 w-5 accent-teal-300" checked={includeGraph} type="checkbox" onChange={(event) => { setIncludeGraph(event.target.checked); setDownloadUrl(''); }} />
            </label>
            <label className="flex items-center justify-between gap-4 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-200">
              <span className="font-semibold">Include metadata</span>
              <input className="h-5 w-5 accent-teal-300" checked={includeMetadata} type="checkbox" onChange={(event) => { setIncludeMetadata(event.target.checked); setDownloadUrl(''); }} />
            </label>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6 lg:col-span-2" aria-labelledby="export-action-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Download</p>
          <h2 id="export-action-title" className="mt-2 text-2xl font-semibold text-white">Export action</h2>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              className="focus-ring rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={!currentUrl || state !== 'ready'}
              type="button"
              onClick={prepareDownload}
            >
              Prepare export
            </button>
            {downloadUrl ? (
              <a className="focus-ring rounded-xl border border-teal-300/30 px-5 py-3 text-sm font-semibold text-teal-100 hover:bg-teal-300/10" href={downloadUrl} download>
                Download link
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
