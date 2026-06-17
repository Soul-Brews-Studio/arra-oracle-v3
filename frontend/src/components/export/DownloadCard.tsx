import type { ExportDownloadLink } from '../../pages/exportAppHelpers';

export function DownloadCard({ link }: { link: ExportDownloadLink | null }) {
  if (!link) return null;
  return (
    <div className="rounded-2xl border border-[color:var(--color-ok-text,#166534)] bg-[var(--color-ok-bg,#dcfce7)] p-4" role="status">
      <p className="text-sm font-semibold text-[color:var(--color-ok-text,#166534)]"><span aria-hidden="true">✓ </span>Export is ready.</p>
      <a className="focus-ring mt-3 inline-flex rounded-xl bg-teal-300 px-5 py-3 text-sm font-semibold text-slate-950 hover:bg-teal-200" href={link.url} download={link.filename}>
        Download {link.filename}
      </a>
    </div>
  );
}
