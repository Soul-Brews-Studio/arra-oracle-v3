export function PnaGuide({ retryCount, onRetry }: { retryCount: number; onRetry: () => void }) {
  if (retryCount >= 3) {
    return (
      <div className="pna-beacon pointer-events-none fixed left-[165px] top-[52px] z-50 grid -translate-x-1/2 justify-items-center gap-2" aria-hidden="true">
        <svg className="text-err-text" width="28" height="34" viewBox="0 0 28 34">
          <path d="M14 32 L14 8 M5 16 L14 8 L23 16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
        <div className="w-[15rem] rounded-xl bg-err-bg px-3 py-2 text-xs font-semibold text-err-text shadow-lg" style={{ border: '1px solid var(--color-err-border)' }}>
          Blocked? Click the <strong>site icon in the URL bar</strong> → Local network access → Allow
        </div>
      </div>
    );
  }
  return (
    <div className="pna-beacon fixed left-[147px] top-[10px] z-50 w-[330px] max-w-[calc(100vw-2rem)]">
      <div className="pointer-events-none rounded-2xl border-2 border-dashed border-accent-solid/50 bg-[oklch(0.24_0.01_260/0.9)] p-4 shadow-2xl backdrop-blur-sm" aria-hidden="true">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-semibold text-white">v4.buildwithoracle.com wants to</p>
          <span className="text-sm text-white/50">✕</span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-white/70">
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="2.5" y="4" width="15" height="10" rx="1.5" /><path d="M7 17h6" strokeLinecap="round" /></svg>
          Access other apps and services on this device
        </div>
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="rounded-full bg-white/10 px-4 py-1.5 text-xs font-semibold text-white/80">Block</span>
          <span className="animate-pulse rounded-full bg-accent-solid px-4 py-1.5 text-xs font-bold text-on-accent ring-2 ring-accent-solid/70">Allow</span>
        </div>
      </div>
      <div className="mt-2 flex w-full items-center justify-between gap-3 rounded-xl bg-accent-solid/90 px-4 py-2.5 shadow-lg">
        <p className="text-left text-xs font-semibold leading-snug text-on-accent">
          The real Chrome prompt appears here.
          <br />No prompt?
          <button
            className="focus-ring ml-2 inline-block rounded-full bg-[oklch(0.20_0.02_260)] px-4 py-1.5 text-xs font-bold text-white transition hover:bg-[oklch(0.28_0.02_260)]"
            type="button"
            onClick={onRetry}
          >
            Retry
          </button>
        </p>
        <svg className="mr-2 shrink-0 text-on-accent" width="22" height="30" viewBox="0 0 22 30" aria-hidden="true">
          <path d="M11 28 L11 6 M3 13 L11 5 L19 13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </svg>
      </div>
    </div>
  );
}
