import { useMemo, useState } from 'react';
import { fallbackVectorExportFormats, formatLabelFor, type VectorExportFormat, type VectorExportFormatOption } from '../vectorExport';
import { Spinner } from '../components/AsyncState';

export interface VectorCollectionCard {
  key: string;
  collection: string;
  adapter: string;
  model: string;
  count?: number;
  healthy: boolean;
  healthLabel: string;
  healthDetail?: string;
}

type DownloadByCollection = Record<string, VectorExportFormat | undefined>;

type VectorTotals = {
  collections: number;
  knownDocs: number;
  hasUnknownDocs: boolean;
};

function statusClasses(healthy: boolean): string {
  return healthy
    ? 'border-ok-border bg-ok-bg text-ok-text'
    : 'border-err-border bg-err-bg text-err-text';
}

export function docCountLabel(count?: number): string {
  if (typeof count !== 'number') return 'unknown docs';
  return `${count.toLocaleString()} doc${count === 1 ? '' : 's'}`;
}

export function vectorTotals(cards: VectorCollectionCard[]): VectorTotals {
  const knownDocs = cards.reduce((sum, card) => sum + (typeof card.count === 'number' ? card.count : 0), 0);
  const hasUnknownDocs = cards.some((card) => typeof card.count !== 'number');
  return { collections: cards.length, knownDocs, hasUnknownDocs };
}

function docsLabel(cards: VectorCollectionCard[]): string {
  const { collections, knownDocs, hasUnknownDocs } = vectorTotals(cards);
  if (!collections) return 'No collection data yet';
  if (hasUnknownDocs) return `${knownDocs.toLocaleString()}+ docs across ${collections} collections`;
  return `${knownDocs.toLocaleString()} docs · ${collections} collections`;
}

export function VectorCollectionCards({
  cards,
  formats = fallbackVectorExportFormats,
  downloads = {},
  onExport,
}: {
  cards: VectorCollectionCard[];
  formats?: VectorExportFormatOption[];
  downloads?: DownloadByCollection;
  onExport?: (collection: string, format: VectorExportFormat) => void;
}) {
  const [selectedFormats, setSelectedFormats] = useState<Record<string, VectorExportFormat>>({});
  return (
    <div className="mt-4 grid min-w-0 gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,18rem),1fr))]" aria-label="Vector collections">
      {cards.map((card) => {
        const downloading = downloads[card.collection];
        const disabled = Boolean(downloading);
        const selected = selectedFormats[card.collection] ?? formats?.[0]?.format ?? 'json';
        const label = formatLabelFor(formats, selected);
        return (
          <article key={card.key} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-surface-muted p-4">
            <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Collection</p>
                <h2 className="mt-1 text-lg font-semibold text-text [overflow-wrap:anywhere]">{card.collection}</h2>
              </div>
              <span className={`inline-flex shrink-0 rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(card.healthy)}`}>
                {card.healthLabel}
              </span>
            </div>
            <dl className="mt-4 grid min-w-0 gap-3 text-sm">
              <div className="min-w-0"><dt className="text-text-muted">Adapter</dt><dd className="font-medium text-text [overflow-wrap:anywhere]">{card.adapter}</dd></div>
              <div className="min-w-0"><dt className="text-text-muted">Model</dt><dd className="font-medium text-text [overflow-wrap:anywhere]">{card.model}</dd></div>
              <div className="min-w-0"><dt className="text-text-muted">Documents</dt><dd className="font-medium text-text [overflow-wrap:anywhere]">{docCountLabel(card.count)}</dd></div>
            </dl>
            {card.healthDetail ? <p className="mt-3 text-xs text-err-text [overflow-wrap:anywhere]">{card.healthDetail}</p> : null}
            <div className="mt-4 grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
              <select
                aria-label={`Export format for ${card.collection}`}
                className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text"
                disabled={disabled || !formats || formats.length === 0}
                value={selected}
                onChange={(event) => setSelectedFormats((current) => ({ ...current, [card.collection]: event.target.value }))}
              >
                {formats?.map((format) => <option key={format.format} value={format.format}>{format.label}</option>)}
              </select>
              <button
                className="focus-ring rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:bg-ok-bg disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                disabled={disabled || !formats || formats.length === 0}
                type="button"
                onClick={() => onExport?.(card.collection, selected)}
              >
                {downloading ? <Spinner label={`Downloading ${label}`} /> : 'Export'}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function VectorStatsCard({ cards }: { cards: VectorCollectionCard[] }) {
  return (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-stats-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Stats</p>
      <h2 id="vector-stats-title" className="mt-2 text-2xl font-semibold text-text">Collection stats</h2>
      <dl className="mt-4 grid gap-3 text-sm text-text-muted">
        <div className="min-w-0"><dt className="text-text-muted">Total docs</dt><dd className="text-lg font-semibold text-text [overflow-wrap:anywhere]">{docsLabel(cards)}</dd></div>
        <div><dt className="text-text-muted">Models</dt><dd className="text-lg font-semibold text-text">{vectorTotals(cards).collections}</dd></div>
      </dl>
    </section>
  );
}


export function QuickExportCard({
  cards,
  formats,
  downloads,
  onExport,
}: {
  cards: VectorCollectionCard[];
  formats: VectorExportFormatOption[];
  downloads: DownloadByCollection;
  onExport: (collection: string, format: VectorExportFormat) => void;
}) {
  const options = useMemo(() => cards.map((card) => ({
    value: card.collection,
    label: `${card.collection} (${docCountLabel(card.count)})`,
  })), [cards]);
  const [collection, setCollection] = useState(options[0]?.value ?? '');
  const [format, setFormat] = useState(formats[0]?.format ?? 'json');

  if (!cards.length) {
    return (
      <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-quick-export-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Quick export</p>
        <h2 id="vector-quick-export-title" className="mt-2 text-2xl font-semibold text-text">Export collection</h2>
        <p className="mt-2 text-sm text-text-muted">No collections are loaded yet.</p>
      </section>
    );
  }

  const label = formatLabelFor(formats, format);
  const isDownloading = Boolean(downloads[collection]);
  const disabled = isDownloading || formats.length === 0;
  return (
    <section className="min-w-0 overflow-hidden rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="vector-quick-export-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Quick export</p>
      <h2 id="vector-quick-export-title" className="mt-2 text-2xl font-semibold text-text">Export collection</h2>
      <p className="mt-2 text-sm text-text-muted">Pick a collection and format to download from /api/v1/vector/export.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid min-w-0 gap-2 text-sm text-text-muted">
          Collection
          <select
            aria-label="Quick export collection"
            className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid min-w-0 gap-2 text-sm text-text-muted">
          Format
          <select
            aria-label="Quick export format"
            className="focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            {formats.map((item) => <option key={item.format} value={item.format}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <button
        className="focus-ring mt-4 rounded-xl border border-accent-border px-4 py-2 text-sm font-semibold text-accent hover:bg-ok-bg disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || !collection}
        type="button"
        onClick={() => onExport(collection, format)}
      >
        {isDownloading ? <Spinner label={`Downloading ${label}`} /> : 'Export selected'}
      </button>
    </section>
  );
}
