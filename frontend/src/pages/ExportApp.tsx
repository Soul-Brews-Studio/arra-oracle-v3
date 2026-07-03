import { useEffect, useMemo, useRef, useState } from 'react';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import { BackendSelector, DEFAULT_BACKEND_URL, normalizeBackendUrl } from '../components/export/BackendSelector';
import { DownloadCard } from '../components/export/DownloadCard';
import { ExportProgress } from '../components/export/ExportProgress';
import {
  backendApiUrl,
  collectionLabel,
  errorMessage,
  exportResponseError,
  exportAppFormats,
  exportProgressUrl,
  isLegacyFallback,
  isOracleV2ProxyFormat,
  legacyDirectExportLink,
  messageFromPayload,
  normalizeExportAppCollections,
  oracleV2CollectionsPath,
  oracleV2RunPayload,
  progressPatchFromExportPayload,
  readExportPayload,
  resolveDownloadLink,
  type ExportAppFormat,
  type ExportAppMode,
  type ExportDownloadLink,
  type LegacyExportCollection,
} from './exportAppHelpers';
import type { ExportProgressState } from '../hooks/useExport';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';
type ExportState = 'idle' | 'exporting' | 'ready' | 'error';
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;

type ExportAppProps = {
  initialBackendUrl?: string;
  fetcher?: Fetcher;
  autoLoad?: boolean;
};

export function ExportApp({ initialBackendUrl = DEFAULT_BACKEND_URL, fetcher = globalThis.fetch?.bind(globalThis), autoLoad = true }: ExportAppProps) {
  const [backendUrl, setBackendUrl] = useState(() => normalizeBackendUrl(initialBackendUrl));
  const [mode, setMode] = useState<ExportAppMode>('export-app');
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [exportState, setExportState] = useState<ExportState>('idle');
  const [error, setError] = useState('');
  const [collections, setCollections] = useState<LegacyExportCollection[]>([]);
  const [collection, setCollection] = useState('');
  const [format, setFormat] = useState<ExportAppFormat>('json');
  const [download, setDownload] = useState<ExportDownloadLink | null>(null);
  const [progress, setProgress] = useState<ExportProgressState>({ status: 'idle', jobId: null, progress: 0 });
  const progressSource = useRef<EventSource | null>(null);

  const selected = useMemo(
    () => collections.find((item) => item.id === collection) ?? collections[0],
    [collection, collections],
  );

  function closeProgress() {
    progressSource.current?.close();
    progressSource.current = null;
  }

  function connectProgress(targetUrl: string, jobId: string) {
    closeProgress();
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource(exportProgressUrl(targetUrl, jobId));
    progressSource.current = source;
    const update = (event: MessageEvent) => {
      const patch = progressPatchFromExportPayload(JSON.parse(event.data));
      setProgress((current) => ({ ...current, ...patch, progress: patch.progress ?? current.progress }));
      if (patch.status === 'done' || patch.status === 'error') closeProgress();
    };
    source.addEventListener('progress', update);
    source.onmessage = update;
    source.onerror = () => closeProgress();
  }

  async function loadCollections(targetUrl = backendUrl) {
    const normalized = normalizeBackendUrl(targetUrl);
    setBackendUrl(normalized);
    setLoadState('loading');
    setExportState('idle');
    setError('');
    setDownload(null);
    closeProgress();
    setProgress({ status: 'idle', jobId: null, progress: 0 });
    try {
      if (!fetcher) throw new Error('fetch is unavailable in this runtime.');
      const proxyPath = oracleV2CollectionsPath(normalized);
      const proxy = await Promise.resolve(fetcher(backendApiUrl(DEFAULT_BACKEND_URL, proxyPath), { headers: { accept: 'application/json' } })).catch(() => null);
      if (proxy?.ok) {
        const next = normalizeExportAppCollections(await readExportPayload(proxy, proxyPath));
        setCollections(next);
        setCollection((current) => next.find((item) => item.id === current)?.id ?? next[0]?.id ?? '');
        setMode('oracle-v2');
        setLoadState('ready');
        return;
      }
      const path = '/api/v1/export/app/collections';
      const response = await fetcher(backendApiUrl(normalized, '/api/v1/export/app/collections'), {
        headers: { accept: 'application/json' },
      });
      if (!response.ok) throw new Error(await exportResponseError(response, path));
      const next = normalizeExportAppCollections(await readExportPayload(response, path));
      setCollections(next);
      setCollection((current) => next.find((item) => item.id === current)?.id ?? next[0]?.id ?? '');
      setMode('export-app');
      setLoadState('ready');
    } catch (err) {
      setCollections([]);
      setCollection('');
      setError(errorMessage(err));
      setLoadState('error');
    }
  }

  async function triggerExport() {
    if (!fetcher || !selected) {
      setError(!fetcher ? 'fetch is unavailable in this runtime.' : 'Load a collection before starting export.');
      setExportState('error');
      return;
    }
    setExportState('exporting');
    setError('');
    setDownload(null);
    closeProgress();
    setProgress({ status: 'starting', jobId: null, progress: 0 });
    const normalized = normalizeBackendUrl(backendUrl);
    const apiBase = mode === 'oracle-v2' ? DEFAULT_BACKEND_URL : normalized;
    const path = mode === 'oracle-v2' ? '/api/v1/export/run' : '/api/v1/export/app/run';
    const payload = mode === 'oracle-v2'
      ? oracleV2RunPayload(selected.id, format, normalized)
      : { collection: selected.id, format, includeGraph: true, includeMetadata: true };
    try {
      if (mode === 'oracle-v2' && !isOracleV2ProxyFormat(format)) {
        throw new Error('Oracle v2 direct export supports JSON, CSV, and Markdown. Choose JSON or Markdown for migration backups.');
      }
      const response = await fetcher(backendApiUrl(apiBase, path), {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (mode === 'export-app' && isLegacyFallback(response.status)) {
        const link = legacyDirectExportLink(normalized, selected.id, format);
        setDownload(link);
        setProgress({ status: 'done', jobId: null, progress: 100, downloadUrl: link.url, filename: link.filename });
        setExportState('ready');
        return;
      }
      const body = await readExportPayload(response, path);
      if (!response.ok) {
        const detail = progressPatchFromExportPayload(body).error ?? messageFromPayload(body);
        throw new Error(`${path} returned ${response.status}${detail ? `: ${detail}` : ''}`);
      }
      const link = resolveDownloadLink(apiBase, body, selected.id, format);
      if (!link) throw new Error('Export response did not include a download URL or job id.');
      const patch = progressPatchFromExportPayload(body);
      setDownload(link);
      setProgress((current) => ({
        ...current,
        ...patch,
        status: patch.status ?? 'done',
        progress: patch.progress ?? 100,
        downloadUrl: link.url,
        filename: link.filename,
      }));
      if (patch.jobId) connectProgress(apiBase, patch.jobId);
      setExportState('ready');
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      setProgress((current) => ({ ...current, status: 'error', error: message }));
      setExportState('error');
    }
  }

  useEffect(() => { if (autoLoad) void loadCollections(backendUrl); }, [autoLoad]);
  useEffect(() => () => closeProgress(), []);

  return (
    <div className="grid min-w-0 gap-5">
      <section className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="export-app-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Legacy Oracle v2</p>
        <h1 id="export-app-title" className="mt-2 text-3xl font-semibold text-text">Export app</h1>
        <p className="mt-2 text-sm text-text-muted">Connect to an old Oracle v2 backend, list collections, and prepare JSON or Markdown backups before migration.</p>
      </section>

      <section className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="backend-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Backend URL</p>
            <h2 id="backend-title" className="mt-2 text-2xl font-semibold text-text">Old Oracle backend</h2>
            <p className="mt-2 text-sm text-text-muted">Use the source Oracle v2 HTTP URL, for example {DEFAULT_BACKEND_URL}.</p>
          </div>
          <button className="focus-ring rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-60" disabled={loadState === 'loading'} type="button" onClick={() => void loadCollections()}>
            {loadState === 'loading' ? <Spinner label="Loading collections" /> : 'List collections'}
          </button>
        </div>
        <div className="mt-4"><BackendSelector value={backendUrl} onChange={setBackendUrl} /></div>
      </section>

      {loadState === 'loading' ? <LoadingPanel title="Loading export collections" detail="Checking the local Oracle v2 proxy, then export-app collections if needed." /> : null}
      {loadState === 'error' ? (
        <ErrorMessage
          title="Could not load legacy backend collections."
          message={error}
          action={<button className="focus-ring rounded-lg border border-err-border px-3 py-2 font-semibold text-err-text hover:bg-err-bg" type="button" onClick={() => void loadCollections()}>Retry loading collections</button>}
        />
      ) : null}
      {exportState === 'error' ? <ErrorMessage title="Could not start export." message={error} /> : null}

      <section className="grid min-w-0 gap-4 lg:grid-cols-2">
        <div className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="collection-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Collections</p>
          <h2 id="collection-title" className="mt-2 text-2xl font-semibold text-text">Choose data</h2>
          <label className="mt-5 grid min-w-0 gap-2 text-sm font-medium text-text-muted">
            Collection
            <select className="focus-ring w-full min-w-0 rounded-xl border border-border bg-field px-4 py-3 text-text" disabled={!collections.length} value={selected?.id ?? ''} onChange={(event) => { setCollection(event.currentTarget.value); setDownload(null); }}>
              {collections.length ? collections.map((item) => <option key={item.id} value={item.id}>{collectionLabel(item)}</option>) : <option value="">No collections loaded</option>}
            </select>
          </label>
          <ul className="mt-4 grid max-h-72 gap-2 overflow-auto" aria-label="Legacy export collections">
            {collections.map((item) => <li key={item.id} className="break-words rounded-xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md px-4 py-3 text-sm text-text-muted">{collectionLabel(item)}</li>)}
          </ul>
          {loadState === 'ready' && !collections.length ? (
            <p className="mt-4 rounded-xl border border-dashed border-border p-4 text-sm text-text-muted">No collections are available from this backend. Check the URL, then reload collections.</p>
          ) : null}
        </div>

        <div className="min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="format-title">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Export</p>
          <h2 id="format-title" className="mt-2 text-2xl font-semibold text-text">Format and download</h2>
          <div className="mt-5 grid gap-3" role="radiogroup" aria-label="Export format">
            {exportAppFormats.map((item) => (
              <label key={item.value} className="flex items-start gap-3 rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md px-4 py-3 text-sm text-text-muted">
                <input className="mt-1 h-4 w-4 accent-teal-300" checked={format === item.value} name="legacy-export-format" type="radio" value={item.value} onChange={() => { setFormat(item.value); setDownload(null); }} />
                <span><span className="block font-semibold text-text">{item.label}</span><span>{item.detail}</span></span>
              </label>
            ))}
          </div>
          <button className="focus-ring mt-5 rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60" disabled={!selected || exportState === 'exporting'} type="button" onClick={() => void triggerExport()}>
            {exportState === 'exporting' ? <Spinner label="Starting export" /> : 'Trigger export'}
          </button>
          <div className="mt-4"><DownloadCard link={download} /></div>
        </div>
      </section>
      <ExportProgress state={progress} title="Export progress" onRetry={() => void triggerExport()} />
    </div>
  );
}
