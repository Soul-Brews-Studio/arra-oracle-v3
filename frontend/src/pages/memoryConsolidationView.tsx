import type { ReactNode } from 'react';

export type ConsolidationDoc = {
  id: string;
  title: string;
  sourceFile?: string;
  type?: string;
  content?: string;
};
export type ConsolidationMetrics = { cosine?: number; ftsOverlap?: number; oldConfidence?: number; newConfidence?: number };
export type ConsolidationSuggestion = {
  id: string;
  original: ConsolidationDoc;
  suggested: ConsolidationDoc;
  confidence: number;
  reason: string;
  source: string;
  model?: string;
  metrics?: ConsolidationMetrics;
};

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }
function text(value: unknown, fallback = ''): string { return typeof value === 'string' && value.trim() ? value.trim() : fallback; }
function numeric(value: unknown, fallback = 0): number { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback; }
function percent(value: number): string { return `${Math.round(value * 100)}%`; }
function preview(doc: ConsolidationDoc): string { return doc.content || doc.sourceFile || doc.id; }

function docFrom(value: unknown, idFallback: string): ConsolidationDoc {
  const row = isRecord(value) ? value : {};
  const id = text(row.id ?? row.documentId ?? row.docId, idFallback);
  const title = text(row.title ?? row.sourceFile ?? row.source_file, id);
  return {
    id,
    title,
    sourceFile: text(row.sourceFile ?? row.source_file, ''),
    type: text(row.type, ''),
    content: text(row.content ?? row.preview ?? row.excerpt, ''),
  };
}

function metricsFrom(value: unknown): ConsolidationMetrics | undefined {
  const row = isRecord(value) ? value : {};
  const metrics = isRecord(row.metrics) ? row.metrics : row;
  const next = {
    cosine: Number(metrics.cosine),
    ftsOverlap: Number(metrics.ftsOverlap ?? metrics.fts_overlap),
    oldConfidence: Number(metrics.oldConfidence ?? metrics.old_confidence),
    newConfidence: Number(metrics.newConfidence ?? metrics.new_confidence),
  };
  return Object.values(next).some(Number.isFinite) ? next : undefined;
}

function sourceFrom(row: Record<string, unknown>, reason: string, model: string): string {
  const source = text(row.source ?? row.provenance, '');
  if (source) return source;
  return model || reason.toLowerCase().includes('llm') ? 'sleep-time-llm' : 'similarity-sweep';
}

export function normalizeSuggestion(value: unknown): ConsolidationSuggestion | null {
  if (!isRecord(value)) return null;
  const oldId = text(value.oldId ?? value.old_id ?? value.originalId);
  const newId = text(value.newId ?? value.new_id ?? value.suggestedId);
  if (!oldId || !newId) return null;
  const confidence = numeric(value.confidence ?? value.score ?? value.cosine, 0);
  const id = text(value.id, `${oldId}->${newId}`);
  const reason = text(value.reason, 'Memory consolidation suggested a supersede relationship.');
  const model = text(value.model, '');
  return {
    id,
    original: docFrom(value.original ?? value.old ?? value.oldDoc, oldId),
    suggested: docFrom(value.suggested ?? value.replacement ?? value.new ?? value.newDoc, newId),
    confidence,
    reason,
    source: sourceFrom(value, reason, model),
    ...(model ? { model } : {}),
    ...(metricsFrom(value) ? { metrics: metricsFrom(value) } : {}),
  };
}

export function suggestionsFromPayload(payload: unknown): ConsolidationSuggestion[] {
  const list = isRecord(payload) ? payload.suggestions ?? payload.items ?? payload.plans ?? [] : payload;
  return Array.isArray(list) ? list.map(normalizeSuggestion).filter((item): item is ConsolidationSuggestion => Boolean(item)) : [];
}

function sourceLabel(item: ConsolidationSuggestion): string {
  const isLlm = item.source.toLowerCase().includes('llm');
  return isLlm ? `LLM ${item.model || 'review'}` : 'similarity sweep';
}

function sourceTone(item: ConsolidationSuggestion): string {
  return sourceLabel(item).startsWith('LLM')
    ? 'border-accent2-border bg-accent2-soft text-text'
    : 'border-accent-border bg-accent-soft text-text';
}

function confidenceContext(item: ConsolidationSuggestion): string {
  const parts = [`${percent(item.confidence)} confidence`];
  if (Number.isFinite(item.metrics?.cosine)) parts.push(`cosine ${percent(item.metrics!.cosine!)}`);
  if (Number.isFinite(item.metrics?.ftsOverlap)) parts.push(`overlap ${percent(item.metrics!.ftsOverlap!)}`);
  if (Number.isFinite(item.metrics?.newConfidence)) parts.push(`new doc ${percent(item.metrics!.newConfidence!)}`);
  return parts.join(' · ');
}

export function ConfidencePill({ score }: { score: number }) {
  const tone = score >= 0.85 ? 'border-ok-border bg-ok-bg text-ok-text' : score >= 0.65 ? 'border-warn-border bg-warn-bg text-warn-text' : 'border-border bg-surface-muted text-text-muted';
  return <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${tone}`}>{percent(score)} confidence</span>;
}

function SourceChip({ item }: { item: ConsolidationSuggestion }) {
  return <span className={`rounded-full border px-3 py-1 text-sm font-semibold ${sourceTone(item)}`}>{sourceLabel(item)}</span>;
}

function DocBlock({ label, doc }: { label: string; doc: ConsolidationDoc }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface p-4">
      <p className="text-xs font-semibold text-text-muted">{label}</p>
      <h3 className="mt-2 break-words text-base font-semibold text-text">{doc.title}</h3>
      <p className="mt-2 line-clamp-3 text-sm text-text-muted">{preview(doc)}</p>
      <p className="mt-3 break-all font-mono text-xs text-text-muted">{doc.id}</p>
    </div>
  );
}

export function EmptyState({ error }: { error?: string }) {
  const title = error ? 'Consolidation queue unavailable' : 'No pending reviews';
  const detail = error || 'Memory consolidation has no supersede suggestions awaiting human review.';
  return (
    <section className="rounded-3xl border border-border bg-surface p-6 text-sm text-text-muted">
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p className="mt-2 max-w-2xl">{detail}</p>
    </section>
  );
}

export function SuggestionCard({ item, actions }: { item: ConsolidationSuggestion; actions: ReactNode }) {
  return (
    <article className="glass rounded-3xl p-4 sm:p-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><ConfidencePill score={item.confidence} /><SourceChip item={item} /></div>
          <p className="mt-2 text-xs font-semibold text-text-muted">{confidenceContext(item)}</p>
          <div className="mt-3 rounded-2xl border border-border bg-surface/70 p-3">
            <p className="text-xs font-semibold text-text-muted">Review reason</p>
            <p className="mt-1 max-w-3xl text-sm text-text-muted">{item.reason}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">{actions}</div>
      </div>
      <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto_1fr] lg:items-stretch">
        <DocBlock label="Original doc" doc={item.original} />
        <div className="flex items-center justify-center text-sm font-semibold text-text-muted" aria-hidden="true">superseded by</div>
        <DocBlock label="Suggested supersede" doc={item.suggested} />
      </div>
    </article>
  );
}

export function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><p className="text-sm text-text-muted">{label}</p><p className="mt-1 text-2xl font-semibold text-text">{value}</p></div>;
}

export { percent };
