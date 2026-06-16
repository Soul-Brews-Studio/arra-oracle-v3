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

export type VectorProviderHealthCard = { type: string; status: 'green' | 'red'; available: boolean; detail?: string };
export type VectorFreshnessCard = { status: 'fresh' | 'empty'; totalIndexed: number; docsPending?: number; lastIndexed?: string };

type DownloadByCollection = Record<string, VectorExportFormat | undefined>;

type VectorTotals = {
  collections: number;
  knownDocs: number;
  hasUnknownDocs: boolean;
};

function statusClasses(healthy: boolean): string {
  return healthy
    ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200'
    : 'border-red-300/30 bg-red-300/10 text-red-100';
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
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Vector collections">
      {cards.map((card) => {
        const downloading = downloads[card.collection];
        const disabled = Boolean(downloading);
        const selected = selectedFormats[card.collection] ?? formats?.[0]?.format ?? 'json';
        const label = formatLabelFor(formats, selected);
        return (
          <article key={card.key} className="rounded-2xl border border-white/10 bg-slate-950/70 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Collection</p>
                <h2 className="mt-1 text-lg font-semibold text-white">{card.collection}</h2>
              </div>
              <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(card.healthy)}`}>
                {card.healthLabel}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 text-sm">
              <div><dt className="text-slate-500">Adapter</dt><dd className="font-medium text-slate-100">{card.adapter}</dd></div>
              <div><dt className="text-slate-500">Model</dt><dd className="font-medium text-slate-100">{card.model}</dd></div>
              <div><dt className="text-slate-500">Documents</dt><dd className="font-medium text-slate-100">{docCountLabel(card.count)}</dd></div>
            </dl>
            {card.healthDetail ? <p className="mt-3 text-xs text-red-200">{card.healthDetail}</p> : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <select
                aria-label={`Export format for ${card.collection}`}
                className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                disabled={disabled || !formats || formats.length === 0}
                value={selected}
                onChange={(event) => setSelectedFormats((current) => ({ ...current, [card.collection]: event.target.value }))}
              >
                {formats?.map((format) => <option key={format.format} value={format.format}>{format.label}</option>)}
              </select>
              <button
                className="focus-ring rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
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
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-stats-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Stats</p>
      <h2 id="vector-stats-title" className="mt-2 text-2xl font-semibold text-white">Collection stats</h2>
      <dl className="mt-4 grid gap-3 text-sm text-slate-300">
        <div><dt className="text-slate-500">Total docs</dt><dd className="text-lg font-semibold text-white">{docsLabel(cards)}</dd></div>
        <div><dt className="text-slate-500">Models</dt><dd className="text-lg font-semibold text-white">{vectorTotals(cards).collections}</dd></div>
      </dl>
    </section>
  );
}


export function VectorHealthDashboardCard({
  providers = [],
  freshness,
}: {
  providers?: VectorProviderHealthCard[];
  freshness?: VectorFreshnessCard;
}) {
  const providerSummary = providers.length
    ? `${providers.filter((item) => item.available).length}/${providers.length} providers available`
    : 'Provider detection unavailable';
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-health-dashboard-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Health</p>
      <h2 id="vector-health-dashboard-title" className="mt-2 text-2xl font-semibold text-white">Vector health dashboard</h2>
      <dl className="mt-4 grid gap-3 text-sm text-slate-300">
        <div><dt className="text-slate-500">Embedding providers</dt><dd className="text-lg font-semibold text-white">{providerSummary}</dd></div>
        <div><dt className="text-slate-500">Index freshness</dt><dd className="text-lg font-semibold text-white">{freshness ? `${freshness.status} · ${freshness.totalIndexed.toLocaleString()} indexed` : 'Unknown'}</dd></div>
      </dl>
      {providers.length ? <div className="mt-4 flex flex-wrap gap-2">{providers.map((provider) => <span key={provider.type} className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusClasses(provider.available)}`}>{provider.type}: {provider.status}</span>)}</div> : null}
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
      <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-quick-export-title">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Quick export</p>
        <h2 id="vector-quick-export-title" className="mt-2 text-2xl font-semibold text-white">Export collection</h2>
        <p className="mt-2 text-sm text-slate-400">No collections are loaded yet.</p>
      </section>
    );
  }

  const label = formatLabelFor(formats, format);
  const isDownloading = Boolean(downloads[collection]);
  const disabled = isDownloading || formats.length === 0;
  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="vector-quick-export-title">
      <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Quick export</p>
      <h2 id="vector-quick-export-title" className="mt-2 text-2xl font-semibold text-white">Export collection</h2>
      <p className="mt-2 text-sm text-slate-400">Pick a collection and format to download from /api/v1/vector/export.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="grid gap-2 text-sm text-slate-300">
          Collection
          <select
            aria-label="Quick export collection"
            className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={collection}
            onChange={(event) => setCollection(event.target.value)}
          >
            {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm text-slate-300">
          Format
          <select
            aria-label="Quick export format"
            className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-3 py-2 text-sm text-slate-100"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            {formats.map((item) => <option key={item.format} value={item.format}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <button
        className="focus-ring mt-4 rounded-xl border border-teal-300/30 px-4 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || !collection}
        type="button"
        onClick={() => onExport(collection, format)}
      >
        {isDownloading ? <Spinner label={`Downloading ${label}`} /> : 'Export selected'}
      </button>
    </section>
  );
}
