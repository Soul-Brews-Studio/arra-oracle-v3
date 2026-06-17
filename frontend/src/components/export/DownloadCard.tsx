import type { ExportDownloadLink } from '../../pages/exportAppHelpers';

export function DownloadCard({ link }: { link: ExportDownloadLink | null }) {
  if (!link) return null;
  return (
    <div className="rounded-2xl border border-ok-border bg-ok-bg p-4" role="status">
      <p className="text-sm font-semibold text-ok-text"><span aria-hidden="true">✓ </span>Export is ready.</p>
      <a className="focus-ring mt-3 inline-flex rounded-xl bg-accent-solid px-5 py-3 text-sm font-semibold text-on-accent hover:bg-accent-hover" href={link.url} download={link.filename}>
        Download {link.filename}
      </a>
    </div>
  );
}
