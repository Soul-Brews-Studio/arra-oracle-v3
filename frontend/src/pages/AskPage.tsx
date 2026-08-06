import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch } from '../api';

type PageState = 'idle' | 'loading' | 'ready' | 'error';
export type AskCitation = { index: number; id: string; title: string; sourceFile: string; excerpt: string; score?: number; confidence?: number; stale?: boolean };
export type AskSource = AskCitation & { type?: string; supersededBy?: string; supersededReason?: string | null; entityMatches?: string[] };
export type AskResponse = {
  query: string; answer: string; citations: AskCitation[]; citationIndexes: number[]; warnings: string[];
  noEvidence: boolean; mode?: string; generatedAt?: string; asOf?: string; search?: { total?: number; limit?: number }; sources: AskSource[];
};
export type AskRequest = { question: string; asOf?: string; limit?: number };
type AskClient = (request: AskRequest) => Promise<AskResponse>;
export type Token = { text: string; citation?: number };

type Props = { client?: AskClient; initialResponse?: AskResponse; initialQuestion?: string };

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null; }

function apiError(payload: unknown, status: number): string {
  if (isRecord(payload) && typeof payload.error === 'string') return payload.error;
  return `Ask returned ${status}`;
}

export async function postAsk(request: AskRequest): Promise<AskResponse> {
  const res = await apiFetch('/api/v1/ask', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ question: request.question, limit: request.limit ?? 8, ...(request.asOf ? { asOf: request.asOf } : {}) }),
  });
  const text = await res.text();
  const payload = text ? JSON.parse(text) as unknown : {};
  if (!res.ok) throw new Error(apiError(payload, res.status));
  return normalizeAskResponse(payload);
}

export function asOfInputToIso(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const ms = Date.parse(trimmed);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : trimmed;
}

export function answerTokens(answer: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\[(\d{1,3})\]/g;
  let cursor = 0;
  for (let match = pattern.exec(answer); match; match = pattern.exec(answer)) {
    if (match.index > cursor) tokens.push({ text: answer.slice(cursor, match.index) });
    tokens.push({ text: match[0], citation: Number(match[1]) });
    cursor = match.index + match[0].length;
  }
  if (cursor < answer.length) tokens.push({ text: answer.slice(cursor) });
  return tokens.length ? tokens : [{ text: answer }];
}

function normalizeText(value: unknown, fallback = ''): string { return typeof value === 'string' ? value : fallback; }
function normalizeNumber(value: unknown): number | undefined { const n = Number(value); return Number.isFinite(n) ? n : undefined; }
function normalizeList(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }

function normalizeSource(value: unknown, index: number): AskSource {
  const row = isRecord(value) ? value : {};
  return {
    index: normalizeNumber(row.index) ?? index,
    id: normalizeText(row.id, `source-${index}`),
    title: normalizeText(row.title, `Source ${index}`),
    sourceFile: normalizeText(row.sourceFile ?? row.source_file),
    excerpt: normalizeText(row.excerpt ?? row.content),
    score: normalizeNumber(row.score),
    confidence: normalizeNumber(row.confidence),
    stale: Boolean(row.stale),
    type: normalizeText(row.type),
    supersededBy: normalizeText(row.supersededBy ?? row.superseded_by),
    supersededReason: normalizeText(row.supersededReason ?? row.superseded_reason),
    entityMatches: normalizeList(row.entityMatches ?? row.entity_matches),
  };
}

function normalizeAskResponse(value: unknown): AskResponse {
  const row = isRecord(value) ? value : {};
  const citations = Array.isArray(row.citations) ? row.citations.map((source, idx) => normalizeSource(source, idx + 1)) : [];
  const sources = Array.isArray(row.sources) ? row.sources.map((source, idx) => normalizeSource(source, idx + 1)) : citations;
  return {
    query: normalizeText(row.query),
    answer: normalizeText(row.answer),
    citations,
    citationIndexes: Array.isArray(row.citationIndexes) ? row.citationIndexes.map(Number).filter(Number.isFinite) : citations.map((item) => item.index),
    warnings: normalizeList(row.warnings),
    noEvidence: Boolean(row.noEvidence ?? row.no_evidence),
    mode: normalizeText(row.mode),
    generatedAt: normalizeText(row.generatedAt ?? row.generated_at),
    asOf: normalizeText(row.asOf),
    search: isRecord(row.search) ? { total: normalizeNumber(row.search.total), limit: normalizeNumber(row.search.limit) } : undefined,
    sources,
  };
}

function CitationLink({ index }: { index: number }) {
  return <a className="focus-ring mx-1 inline-flex rounded-full border border-accent-border bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent" href={`#source-${index}`}>[{index}]</a>;
}

function AnswerWithCitations({ answer }: { answer: string }) {
  return <div className="max-w-3xl whitespace-pre-wrap text-base leading-8 text-text">{answerTokens(answer).map((token, idx) => token.citation ? <CitationLink key={`${token.text}-${idx}`} index={token.citation} /> : <span key={`${idx}-${token.text}`}>{token.text}</span>)}</div>;
}

function warningLabel(warning: string): string {
  if (warning === 'no_evidence_found') return 'No evidence found';
  if (/superseded|stale/i.test(warning)) return 'Stale or superseded evidence';
  if (/low confidence/i.test(warning)) return 'Low-confidence evidence';
  return 'Retrieval warning';
}

function WarningPanel({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <section className="rounded-2xl border border-warn-border bg-warn-bg p-4 text-warn-text" aria-label="Ask warnings">
      <h2 className="text-base font-semibold">Evidence warnings</h2>
      <ul className="mt-3 grid gap-2 text-sm">
        {warnings.map((warning) => <li key={warning}><strong>{warningLabel(warning)}:</strong> {warning}</li>)}
      </ul>
    </section>
  );
}

function HonestEmpty({ query }: { query: string }) {
  return (
    <section className="rounded-3xl border border-border bg-surface p-6" aria-label="No evidence answer">
      <p className="text-sm font-semibold text-accent2">No evidence</p>
      <h2 className="mt-2 text-2xl font-semibold text-text">No evidence — refusing to guess.</h2>
      <p className="mt-2 max-w-2xl text-sm text-text-muted">The Oracle found no indexed source strong enough to answer “{query}”. Try a narrower question, index more notes, or adjust the historical date.</p>
    </section>
  );
}

function SourceCard({ source }: { source: AskSource }) {
  const confidence = source.confidence === undefined ? '—' : `${Math.round(source.confidence * 100)}%`;
  return (
    <article id={`source-${source.index}`} className="scroll-mt-24 rounded-2xl border border-border bg-surface p-4" aria-label={`Source ${source.index}`}>
      <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
        <span className="rounded-full border border-accent-border px-2 py-1 text-accent">[{source.index}]</span>
        {source.stale ? <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-1 text-warn-text">stale</span> : null}
        <span className="rounded-full border border-border px-2 py-1 text-text-muted">confidence {confidence}</span>
      </div>
      <h3 className="mt-3 break-words text-base font-semibold text-text">{source.title}</h3>
      <p className="mt-1 break-all font-mono text-xs text-text-muted">{source.sourceFile || source.id}</p>
      <p className="mt-3 line-clamp-4 text-sm leading-6 text-text-muted">{source.excerpt || 'No excerpt returned.'}</p>
      {source.supersededBy ? <p className="mt-3 text-xs text-warn-text">Superseded by {source.supersededBy}{source.supersededReason ? `: ${source.supersededReason}` : ''}</p> : null}
      {source.entityMatches?.length ? <p className="mt-3 text-xs text-accent">Entity matches: {source.entityMatches.join(', ')}</p> : null}
    </article>
  );
}

function MetaRow({ response }: { response: AskResponse }) {
  return <p className="text-sm text-text-muted">{response.mode ?? 'ask'} mode · {response.search?.total ?? response.sources.length} retrieved · {response.generatedAt ? `generated ${new Date(response.generatedAt).toLocaleString()}` : 'live answer'}{response.asOf ? ` · as of ${response.asOf}` : ''}</p>;
}

function ResultPanel({ response }: { response: AskResponse }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] p-5 sm:p-6" aria-label="Ask answer">
        <p className="text-sm font-semibold text-accent2">Answer</p>
        <h2 className="mt-2 text-2xl font-semibold text-text">Oracle response</h2>
        <div className="mt-2"><MetaRow response={response} /></div>
        <div className="mt-5">{response.noEvidence ? <HonestEmpty query={response.query} /> : <AnswerWithCitations answer={response.answer} />}</div>
      </section>
      <aside className="grid gap-3" aria-label="Sources panel">
        <h2 className="sr-only">Sources</h2>
        {response.sources.length ? response.sources.map((source) => <SourceCard key={`${source.index}:${source.id}`} source={source} />) : <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-text-muted">No sources returned.</div>}
      </aside>
    </div>
  );
}

function AskForm({ question, asOf, loading, onQuestion, onAsOf, onSubmit }: { question: string; asOf: string; loading: boolean; onQuestion: (value: string) => void; onAsOf: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void }) {
  return (
    <form className="grid gap-4" aria-label="Ask Oracle form" onSubmit={onSubmit}>
      <label className="grid gap-2 text-sm font-semibold text-text">Question
        <textarea className="focus-ring min-h-32 resize-y rounded-2xl border border-border bg-field px-4 py-3 text-base text-text placeholder:text-text-muted" placeholder="What does the Oracle know about…" value={question} onChange={(event) => onQuestion(event.currentTarget.value)} />
      </label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="grid flex-1 gap-2 text-sm font-semibold text-text">Historical asOf (optional)
          <input className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text" type="datetime-local" value={asOf} onChange={(event) => onAsOf(event.currentTarget.value)} />
        </label>
        <button className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50" disabled={loading || !question.trim()} type="submit">{loading ? 'Consulting…' : 'Ask Oracle 🔮'}</button>
      </div>
    </form>
  );
}

export function AskPage({ client = postAsk, initialResponse, initialQuestion = '' }: Props) {
  const [searchParams] = useSearchParams();
  const routeQuestion = searchParams.get('q')?.trim() ?? '';
  const [question, setQuestion] = useState(initialQuestion || initialResponse?.query || routeQuestion);
  const [asOf, setAsOf] = useState('');
  const [state, setState] = useState<PageState>(initialResponse ? 'ready' : 'idle');
  const [response, setResponse] = useState<AskResponse | null>(initialResponse ?? null);
  const [error, setError] = useState('');
  const summary = useMemo(() => state === 'ready' && response ? `${response.citationIndexes.length} citation marker${response.citationIndexes.length === 1 ? '' : 's'} · ${response.warnings.length} warning${response.warnings.length === 1 ? '' : 's'}` : 'Cited retrieval over indexed Oracle memory.', [response, state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) return;
    setState('loading');
    setError('');
    try {
      const next = await client({ question: question.trim(), asOf: asOfInputToIso(asOf), limit: 8 });
      setResponse(next);
      setState('ready');
    } catch (err) {
      setResponse(null);
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  return (
    <div className="grid w-full min-w-0 gap-5">
      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] p-5 sm:p-6" aria-labelledby="ask-page-title">
        <p className="text-sm font-semibold text-accent2">Studio Ask</p>
        <h1 id="ask-page-title" className="mt-2 text-3xl font-semibold text-text">Ask the Oracle 🔮</h1>
        <p className="mt-2 max-w-3xl text-sm text-text-muted">POST /api/v1/ask returns cited RAG answers with inline source markers, retrieval warnings, and honest no-evidence states.</p>
        <p className="mt-4 rounded-2xl border border-accent-border bg-accent-soft p-3 text-sm text-accent">{summary}</p>
      </section>

      <section className="glass rounded-3xl border border-[oklch(1_0_0/0.08)] bg-[oklch(0.16_0.02_265/0.35)] p-5 sm:p-6" aria-label="Ask controls">
        <AskForm question={question} asOf={asOf} loading={state === 'loading'} onQuestion={setQuestion} onAsOf={setAsOf} onSubmit={submit} />
        {state === 'error' ? <p role="alert" className="mt-4 rounded-2xl border border-err-border bg-err-bg p-3 text-sm text-err-text">{error}</p> : null}
      </section>

      {response ? <WarningPanel warnings={response.warnings} /> : null}
      {state === 'idle' ? <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-text-muted">Ask a question to see the answer, citations, source panel, and evidence warnings.</div> : null}
      {state === 'loading' ? <div className="rounded-3xl border border-border bg-surface p-6 text-sm text-text-muted">Consulting indexed memory and building citations…</div> : null}
      {response ? <ResultPanel response={response} /> : null}
    </div>
  );
}
