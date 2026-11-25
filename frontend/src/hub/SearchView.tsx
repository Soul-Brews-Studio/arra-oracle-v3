import { useState, type FormEvent } from 'react';
import type { HubApi, SearchResult } from './api';
import { Card, ErrorLine, input, primary } from './ui';

export function SearchView({ api, initial = '' }: { api: HubApi; initial?: string }) {
  const [q, setQ] = useState(initial);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(event?: FormEvent) {
    event?.preventDefault();
    if (!q.trim()) return;
    setBusy(true); setError(null);
    try { setResult(await api.search(q.trim())); } catch (e) { setError(e instanceof Error ? e.message : String(e)); setResult(null); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-5">
      <Card title="Search, grouped by source">
        <form onSubmit={run} className="flex flex-wrap gap-2">
          <input className={`${input} min-w-0 flex-1`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="query  ·  self: only mine  ·  shared: only hubs" aria-label="query" />
          <button className={primary} disabled={busy || !q.trim()}>{busy ? 'Searching…' : 'Search'}</button>
        </form>
        <ErrorLine error={error} />
        <p className="mt-3 text-xs text-text-muted">Scores compare only inside one group: self and each hub are ranked separately.</p>
      </Card>
      {result && result.groups.map((g) => (
        <Card key={g.source} title={`${g.source} · ${g.results.length}`} right={<span className="font-mono text-xs text-text-muted">{g.ranking}</span>}>
          <ol className="space-y-3">
            {g.results.length === 0 && <li className="text-sm text-text-muted">no hits</li>}
            {g.results.map((h) => (
              <li key={h.id} className="rounded-lg border border-border bg-field p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-text">{h.n}. {h.title}</span>
                  <span className="font-mono text-xs text-text-muted">{h.score.toFixed(3)}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-text-muted">{h.id}</div>
                {h.snippet && <p className="mt-2 line-clamp-2 text-sm text-text-muted">{h.snippet}</p>}
              </li>
            ))}
          </ol>
        </Card>
      ))}
      {result?.notes && result.notes.length > 0 && (
        <ul className="space-y-1 text-xs text-text-muted">{result.notes.map((n) => <li key={n}>· {n}</li>)}</ul>
      )}
    </div>
  );
}
