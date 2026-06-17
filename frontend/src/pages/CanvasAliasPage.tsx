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
    <section className="grid gap-5" aria-labelledby="canvas-alias-title">
      <header className="rounded-3xl border border-border bg-surface p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Canvas app</p>
        <h1 id="canvas-alias-title" className="mt-2 text-3xl font-semibold text-text">Studio canvas alias</h1>
        <p className="mt-2 text-sm text-text-muted">/canvas remains available while the isolated canvas app runs on canvas.buildwithoracle.com.</p>
        <a className="focus-ring mt-4 inline-flex rounded-xl border border-accent-border px-3 py-2 text-sm font-semibold text-accent hover:bg-ok-bg" href={target}>
          Open standalone canvas
        </a>
      </header>
      <iframe
        className="min-h-[34rem] w-full rounded-3xl border border-border bg-field"
        src={target}
        title="canvas.buildwithoracle.com preview"
      />
    </section>
  );
}
