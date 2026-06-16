import { useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

const CANVAS_HOST = 'https://canvas.buildwithoracle.com';
const DEFAULT_PLUGIN = 'wave';

function canvasPath(plugin: string): string {
  const id = plugin.trim() || DEFAULT_PLUGIN;
  return id === 'map' || id === 'planets' ? `/${id}` : `/?${new URLSearchParams({ plugin: id })}`;
}

export function canvasStandaloneUrl(search: string): string {
  const params = new URLSearchParams(search);
  return new URL(canvasPath(params.get('plugin') ?? DEFAULT_PLUGIN), CANVAS_HOST).toString();
}

export function CanvasAliasPage() {
  const location = useLocation();
  const target = useMemo(() => canvasStandaloneUrl(location.search), [location.search]);

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.warn('[canvas] /canvas is a deprecated Studio alias; prefer canvas.buildwithoracle.com');
    }
  }, []);

  return (
    <section className="grid gap-5" aria-labelledby="canvas-alias-title">
      <header className="rounded-3xl border border-white/10 bg-slate-950/70 p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-teal-300">Canvas app</p>
        <h1 id="canvas-alias-title" className="mt-2 text-3xl font-semibold text-white">Studio canvas alias</h1>
        <p className="mt-2 text-sm text-slate-400">/canvas remains available while the isolated canvas app runs on canvas.buildwithoracle.com.</p>
        <a className="focus-ring mt-4 inline-flex rounded-xl border border-teal-300/30 px-3 py-2 text-sm font-semibold text-teal-100 hover:bg-teal-300/10" href={target}>
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
