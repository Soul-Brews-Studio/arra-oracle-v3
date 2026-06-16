export type ExportSummaryCollection = {
  name: string;
  docCount?: number;
  estimatedBytes?: number;
};

export interface ExportSummaryProps {
  collections: ExportSummaryCollection[];
  format: string;
  estimatedBytes?: number;
  relationshipCount?: number;
  title?: string;
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return 'Not estimated';
  if (bytes < 1024) return `${bytes.toLocaleString()} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let i = 1; i < units.length && value >= 1024; i += 1) {
    value /= 1024;
    unit = units[i]!;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function totalDocs(collections: ExportSummaryCollection[]): { count: number; unknown: boolean } {
  return collections.reduce<{ count: number; unknown: boolean }>((summary, collection) => ({
    count: summary.count + (collection.docCount ?? 0),
    unknown: summary.unknown || typeof collection.docCount !== 'number',
  }), { count: 0, unknown: false });
}

function estimatedSize(collections: ExportSummaryCollection[], explicit?: number): number | undefined {
  if (typeof explicit === 'number') return explicit;
  if (!collections.length || collections.some((collection) => typeof collection.estimatedBytes !== 'number')) return undefined;
  return collections.reduce((sum, collection) => sum + (collection.estimatedBytes ?? 0), 0);
}

function docsLabel(docCount?: number): string {
  if (typeof docCount !== 'number') return 'unknown docs';
  return `${docCount.toLocaleString()} doc${docCount === 1 ? '' : 's'}`;
}

function Stat({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
      <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</dt>
      <dd className="mt-2 text-2xl font-semibold text-white">{value}</dd>
      <dd className="mt-1 text-sm text-slate-400">{detail}</dd>
    </div>
  );
}

export function ExportSummary({
  collections,
  format,
  estimatedBytes,
  relationshipCount = 0,
  title = 'Export summary',
}: ExportSummaryProps) {
  const docs = totalDocs(collections);
  const size = estimatedSize(collections, estimatedBytes);
  const visibleCollections = collections.slice(0, 6);
  const hiddenCollections = Math.max(0, collections.length - visibleCollections.length);
  const docValue = `${docs.count.toLocaleString()}${docs.unknown ? '+' : ''}`;

  return (
    <section className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6" aria-labelledby="export-summary-title">
      <div className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Before export</p>
        <h2 id="export-summary-title" className="mt-2 text-2xl font-semibold text-white">{title}</h2>
        <p className="mt-1 text-sm text-slate-400">Review collection counts, output format, and estimated payload size.</p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Documents" value={docValue} detail={docs.unknown ? 'Known count plus unknown collections' : 'Total selected documents'} />
        <Stat label="Collections" value={collections.length.toLocaleString()} detail="Selected for export" />
        <Stat label="Format" value={format.toUpperCase()} detail="Output file type" />
        <Stat label="Estimated size" value={formatBytes(size)} detail={`${relationshipCount.toLocaleString()} graph relationships`} />
      </dl>

      <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="bg-white/[0.04] text-xs uppercase tracking-[0.16em] text-slate-500">
            <tr>
              <th className="px-4 py-3 font-semibold">Collection</th>
              <th className="px-4 py-3 font-semibold">Docs</th>
              <th className="px-4 py-3 font-semibold">Estimate</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10 text-slate-300">
            {visibleCollections.length ? visibleCollections.map((collection) => (
              <tr key={collection.name}>
                <td className="px-4 py-3 font-medium text-slate-100">{collection.name}</td>
                <td className="px-4 py-3">{docsLabel(collection.docCount)}</td>
                <td className="px-4 py-3">{formatBytes(collection.estimatedBytes)}</td>
              </tr>
            )) : (
              <tr>
                <td className="px-4 py-4 text-slate-400" colSpan={3}>No collections selected.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {hiddenCollections ? (
        <p className="mt-3 text-sm text-slate-500">{hiddenCollections.toLocaleString()} more collections are included in this export.</p>
      ) : null}
    </section>
  );
}
