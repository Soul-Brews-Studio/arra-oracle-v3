import { useEffect, useMemo, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { BackendSelector, DEFAULT_BACKEND_URL, normalizeBackendUrl } from '../components/export/BackendSelector';
import {
  backendApiUrl,
  exportAppFormats,
  legacyDirectExportLink,
  normalizeExportAppCollections,
  resolveDownloadLink,
  type ExportAppFormat,
  type ExportDownloadLink,
  type LegacyExportCollection,
} from './exportAppHelpers';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ExportState = 'idle' | 'exporting' | 'ready' | 'error';
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

type ExportAppProps = {
  initialBackendUrl?: string;
  fetcher?: Fetcher;
  autoLoad?: boolean;
};

async function jsonPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function collectionLabel(collection: LegacyExportCollection): string {
  const count = typeof collection.count === 'number' ? ` · ${collection.count.toLocaleString()} rows` : '';
  return `${collection.label}${count}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLegacyFallback(status: number): boolean {
  return status === 404 || status === 405 || status === 501;
}

function DownloadCard({ link }: { link: ExportDownloadLink | null }) {
  if (!link) return null;
  return (
    <div className="rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-4" role="status">
      <p className="text-sm font-semibold text-emerald-100">Export is ready.</p>
      <a className="focus-ring mt-3 inline-flex rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200" href={link.url} download={link.filename}>
        Download {link.filename}
      </a>
    </div>
  );
}

export function ExportApp({ initialBackendUrl = DEFAULT_BACKEND_URL, fetcher = globalThis.fetch?.bind(globalThis), autoLoad = true }: ExportAppProps) {
  const [backendUrl, setBackendUrl] = useState(() => normalizeBackendUrl(initialBackendUrl));
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [error, setError] = useState('');
  const [collections, setCollections] = useState<LegacyExportCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [format, setFormat] = useState<ExportAppFormat>('json');
  const [download, setDownload] = useState<ExportDownloadLink | null>(null);

  const selected = useMemo(
    () => collections.find((item) => item.id === collection) ?? collections[0],
    [collection, collections],
  );

  async function loadCollections(targetUrl = backendUrl) {
    if (!fetcher) throw new Error('fetch is unavailable in this runtime.');
    const normalized = normalizeBackendUrl(targetUrl);
    setBackendUrl(normalized);
    setLoadState('loading');
    setExportState('idle');
    setError('');
    setDownload(null);
    try {
      const response = await fetcher(backendApiUrl(normalized, '/api/v1/export/app/collections'), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`/api/v1/export/app/collections returned ${response.status}`);
      const next = normalizeExportAppCollections(await jsonPayload(response));
      setCollections(next);
      setCollection((current) => next.find((item) => item.id === current)?.id ?? next[0]?.id ?? '');
      setLoadState('ready');
    } catch (err) {
      setCollections([]);
      setCollection('');
      setError(errorMessage(err));
      setLoadState('error');
    }
  }

  async function triggerExport() {
    if (!fetcher || !selected) return;
    setExportState('exporting');
    setError('');
    setDownload(null);
    const normalized = normalizeBackendUrl(backendUrl);
    const payload = { collection: selected.id, format, includeGraph: true, includeMetadata: true };
    try {
      const response = await fetcher(backendApiUrl(normalized, '/api/v1/export/app/run'), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (isLegacyFallback(response.status)) {
        setDownload(legacyDirectExportLink(normalized, selected.id, format));
        setExportState('ready');
        return;
      }
      const body = await jsonPayload(response);
      if (!response.ok) throw new Error(`/api/v1/export/app/run returned ${response.status}`);
      const link = resolveDownloadLink(normalized, body, selected.id, format);
      if (!link) throw new Error('Export response did not include a download URL or job id.');
      setDownload(link);
      setExportState('ready');
    } catch (err) {
      setError(errorMessage(err));
      setExportState('error');
    }
  }

  useEffect(() => {
    if (autoLoad) void loadCollections(backendUrl);
  }, [autoLoad]);

  return (
    <div className="grid gap-5">
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="export-app-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Legacy Oracle v2</p>
        <h1 id="export-app-title" className="mt-2 text-3xl font-semibold text-white">Export app</h1>
        <p className="mt-2 text-sm text-slate-400">Connect to an old Oracle v2 backend, list collections, and prepare JSON or Markdown backups before migration.</p>
      </section>

      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="backend-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Backend URL</p>
            <h2 id="backend-title" className="mt-2 text-2xl font-semibold text-white">Old Oracle backend</h2>
            <p className="mt-2 text-sm text-slate-400">Use the source Oracle v2 HTTP URL, for example {DEFAULT_BACKEND_URL}.</p>
          </div>
          <button className="focus-ring rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:opacity-60" disabled={loadState === 'loading'} type="button" onClick={() => void loadCollections()}>
            {loadState === 'loading' ? <Spinner label="Loading collections" /> : 'List collections'}
          </button>
        </div>
        <div className="mt-4"><BackendSelector value={backendUrl} onChange={setBackendUrl} /></div>
      </section>

      {loadState === 'loading' ? <LoadingPanel title="Loading export collections" detail="Calling /api/v1/export/app/collections on the selected backend." /> : null}
      {loadState === 'error' ? <ErrorMessage title="Could not load legacy backend collections." message={error} /> : null}
      {exportState === 'error' ? <ErrorMessage title="Could not start export." message={error} /> : null}

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-5 sm:p-6" aria-labelledby="collection-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Collections</p>
          <h2 id="collection-title" className="mt-2 text-2xl font-semibold text-white">Choose data</h2>
          <label className="mt-5 grid gap-2 text-sm font-medium text-slate-300">
            Collection
            <select className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100" disabled={!collections.length} value={selected?.id ?? ''} onChange={(event) => { setCollection(event.currentTarget.value); setDownload(null); }}>
              {collections.length ? collections.map((item) => <option key={item.id} value={item.id}>{collectionLabel(item)}</option>) : <option value="">No collections loaded</option>}
            </select>
          </label>
          <ul className="mt-4 grid max-h-72 gap-2 overflow-auto" aria-label="Legacy export collections">
            {collections.map((item) => <li key={item.id} className="rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">{collectionLabel(item)}</li>)}
          </ul>
        </div>

        <div className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="format-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Export</p>
          <h2 id="format-title" className="mt-2 text-2xl font-semibold text-white">Format and download</h2>
          <div className="mt-5 grid gap-3" role="radiogroup" aria-label="Export format">
            {exportAppFormats.map((item) => (
              <label key={item.value} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-slate-300">
                <input className="mt-1 h-4 w-4 accent-teal-300" checked={format === item.value} name="legacy-export-format" type="radio" value={item.value} onChange={() => { setFormat(item.value); setDownload(null); }} />
                <span><span className="block font-semibold text-white">{item.label}</span><span>{item.detail}</span></span>
              </label>
            ))}
          </div>
          <button className="focus-ring mt-5 rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60" disabled={!selected || exportState === 'exporting'} type="button" onClick={() => void triggerExport()}>
            {exportState === 'exporting' ? <Spinner label="Starting export" /> : 'Trigger export'}
          </button>
          <div className="mt-4"><DownloadCard link={download} /></div>
        </div>
      </section>
    </div>
  );
}
