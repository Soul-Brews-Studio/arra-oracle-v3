import { useEffect, useMemo, useState } from 'react';
import { apiClient, type ApiClient, type VectorIndexModelsResponse } from '../api/client';
import { ErrorMessage, LoadingPanel, Spinner } from '../components/AsyncState';
import {
  downloadVectorCollection,
  fallbackVectorExportFormats,
  fetchVectorExportFormats,
  formatLabelFor,
  type VectorExportFormat,
  type VectorExportFormatOption,
} from '../vectorExport';

type LoadState = 'loading' | 'ready' | 'error';
type VectorExportClient = Pick<ApiClient, 'vectorIndexModels'>;

export type VectorExportCollection = {
  key: string;
  collection: string;
  model: string;
  adapter: string;
  count?: number;
};

export interface VectorExportPageProps {
  client?: VectorExportClient;
  modelsResponse?: VectorIndexModelsResponse | null;
  loading?: boolean;
  download?: (collection: string, format: VectorExportFormat) => Promise<void>;
  formats?: VectorExportFormatOption[];
  loadFormats?: () => Promise<VectorExportFormatOption[]>;
}

export function exportCollectionsFromModels(response?: VectorIndexModelsResponse | null): VectorExportCollection[] {
  return Object.entries(response?.models ?? {})
    .map(([key, value]) => ({
      key,
      collection: value.collection || key,
      model: value.model || key,
      adapter: value.adapter || 'unknown',
      count: value.count,
    }))
    .sort((left, right) => left.collection.localeCompare(right.collection));
}

function optionLabel(item: VectorExportCollection): string {
  const count = typeof item.count === 'number' ? ` · ${item.count.toLocaleString()} docs` : '';
  return `${item.key} · ${item.collection}${count}`;
}

export function VectorExportPage({
  client = apiClient,
  modelsResponse = null,
  loading = true,
  download = downloadVectorCollection,
  formats = fallbackVectorExportFormats,
  loadFormats = fetchVectorExportFormats,
}: VectorExportPageProps) {
  const initialCollections = useMemo(() => exportCollectionsFromModels(modelsResponse), [modelsResponse]);
  const [collections, setCollections] = useState(initialCollections);
  const [collection, setCollection] = useState(initialCollections[0]?.collection ?? '');
  const [formatOptions, setFormatOptions] = useState(formats);
  const [format, setFormat] = useState(formats[0]?.format ?? 'json');
  const [state, setState] = useState<LoadState>(loading ? 'loading' : 'ready');
  const [error, setError] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [downloading, setDownloading] = useState<VectorExportFormat | null>(null);

  useEffect(() => {
    if (!loading) return;
    let cancelled = false;
    setState('loading');
    setError('');
    Promise.all([client.vectorIndexModels(), loadFormats()])
      .then(([response, nextFormats]) => {
        if (cancelled) return;
        const next = exportCollectionsFromModels(response);
        setCollections(next);
        setCollection((current) => current || next[0]?.collection || '');
        const available = nextFormats.length ? nextFormats : fallbackVectorExportFormats;
        setFormatOptions(available);
        setFormat((current) => available.some((item) => item.format === current) ? current : available[0]?.format ?? 'json');
        setState('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setState('error');
      });
    return () => { cancelled = true; };
  }, [client, loading]);

  const status = useMemo(() => {
    if (state === 'loading') return 'Loading vector collections…';
    if (state === 'error') return 'Could not load vector collections.';
    if (!collections.length) return 'No vector collections are available to export.';
    return `Ready to export ${collection || 'a collection'} as ${formatLabelFor(formatOptions, format)}.`;
  }, [collection, collections.length, format, formatOptions, state]);

  async function exportSelected() {
    if (!collection) return;
    setDownloadError('');
    setDownloading(format);
    try {
      await download(collection, format);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(null);
    }
  }

  return (
    <section className="glass min-w-0 overflow-hidden rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6" aria-labelledby="vector-export-title">
      <div className="mb-5 min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Vector</p>
        <h1 id="vector-export-title" className="mt-2 text-3xl font-semibold text-text">Vector export</h1>
        <p className="mt-2 text-sm text-text-muted">Download vector collections from /api/v1/vector/export in any available format.</p>
      </div>

      {state === 'loading' ? <LoadingPanel title="Loading vector collections…" detail="Fetching /api/v1/vector/index/models." /> : null}
      {state === 'error' ? <ErrorMessage title="Could not load vector export options." message={error} /> : null}

      <div className="mt-5 grid min-w-0 gap-4 overflow-hidden rounded-2xl border border-[oklch(1_0_0/0.05)] bg-[oklch(0.20_0.02_265/0.25)] backdrop-blur-md p-4">
        <label className="grid min-w-0 gap-2 text-sm font-medium text-text-muted">
          Collection
          <select
            aria-label="Export collection"
            className="focus-ring w-full min-w-0 rounded-xl border border-border bg-field px-4 py-3 text-text"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            {collections.length ? collections.map((item) => (
              <option key={item.collection} value={item.collection}>{optionLabel(item)}</option>
            )) : <option value="">No collections loaded</option>}
          </select>
        </label>
        <label className="grid min-w-0 gap-2 text-sm font-medium text-text-muted">
          Format
          <select
            aria-label="Export format"
            className="focus-ring w-full min-w-0 rounded-xl border border-border bg-field px-4 py-3 text-text"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            {formatOptions.map((item) => <option key={item.format} value={item.format}>{item.label}</option>)}
          </select>
        </label>
        <p className="break-words text-sm text-text-muted">{status}</p>
        {downloadError ? <ErrorMessage title="Vector export failed." message={downloadError} /> : null}
        <div className="flex flex-wrap gap-2">
          <button className="focus-ring rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-accent hover:bg-ok-bg disabled:cursor-not-allowed disabled:opacity-50 dark:border-accent-border dark:text-accent dark:hover:bg-ok-bg" data-contrast-badge disabled={!collection || Boolean(downloading) || formatOptions.length === 0} type="button" onClick={() => void exportSelected()}>
            {downloading ? <Spinner label={`Downloading ${formatLabelFor(formatOptions, downloading)}`} /> : 'Export'}
          </button>
        </div>
      </div>
    </section>
  );
}
