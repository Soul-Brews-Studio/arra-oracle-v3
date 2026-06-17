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
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--color-accent,#0f766e)]">Canvas app</p>
        <h1 id="canvas-alias-title" className="mt-2 text-3xl font-semibold text-white">Studio canvas alias</h1>
        <p className="mt-2 text-sm text-slate-400">/canvas remains available while the isolated canvas app runs on canvas.buildwithoracle.com.</p>
        <a className="focus-ring mt-4 inline-flex rounded-xl border border-[color:var(--color-accent,#0f766e)] px-3 py-2 text-sm font-semibold text-[color:var(--color-accent,#0f766e)] hover:bg-[var(--color-ok-bg,#dcfce7)]" href={target}>
          Open standalone canvas
        </a>
      </header>
      <iframe
        className="min-h-[34rem] w-full rounded-3xl border border-white/10 bg-slate-950"
        src={target}
        title="canvas.buildwithoracle.com preview"
      />
    </section>
  );
}
