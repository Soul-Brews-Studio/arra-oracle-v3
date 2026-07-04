import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { canvasStandaloneUrl } from '../routePaths';

function standaloneTarget(search: string): string {
  const params = new URLSearchParams(search);
  return canvasStandaloneUrl(params.get('plugin') ?? undefined);
}

export function CanvasAliasPage() {
  const location = useLocation();
  const target = useMemo(() => standaloneTarget(location.search), [location.search]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.warn('[canvas] /canvas is a deprecated Studio alias; prefer canvas.buildwithoracle.com');
    }
  }, []);

  return (
    <section className="grid w-full min-w-0 gap-5" aria-labelledby="canvas-alias-title">
      <header className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Canvas app</p>
        <h1 id="canvas-alias-title" className="mt-2 text-3xl font-semibold text-text">Studio canvas alias</h1>
        <p className="mt-2 text-sm text-text-muted">/canvas remains available while the isolated canvas app runs on canvas.buildwithoracle.com.</p>
        <a className="focus-ring mt-4 inline-flex rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:bg-ok-bg" href={target}>
          Open standalone canvas
        </a>
      </header>
      <iframe
        className="glass block min-h-[34rem] w-full min-w-0 rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] shadow-[0_8px_32px_oklch(0_0_0/0.4)] backdrop-blur-xl"
        src={target}
        title="canvas.buildwithoracle.com preview"
      />
    </section>
  );
}
