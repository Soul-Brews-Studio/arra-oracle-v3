import { useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';
import {
  EVIDENCE_KINDS,
  FINDING_TOPICS,
  ORACLE_DIG_CONTRACT,
  emptyOracleDigFilters,
  evidenceForFinding,
  searchMockOracleFindings,
  type EvidenceKind,
  type FindingTopic,
  type OracleDigFilters,
  type OracleEvidence,
  type OracleFinding,
} from './oracleDigMock';

const inputClass = 'focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text placeholder:text-text-muted';
const quietButton = 'focus-ring rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:border-accent-border hover:text-text';
const activeButton = 'border-accent-border bg-accent-soft text-accent';
const confidenceOptions = ['all', 'high', 'medium', 'low'] as const;
const evidenceTones: Record<EvidenceKind, BadgeTone> = { github: 'success', session: 'accent', 'oracle-msg': 'warning', web: 'neutral' };

function formatTime(value: number | null): string {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'not recorded';
}

function confidenceLabel(value: number): 'high' | 'medium' | 'low' {
  if (value >= 0.85) return 'high';
  if (value >= 0.7) return 'medium';
  return 'low';
}

function findingText(finding: OracleFinding): string {
  return [finding.subject, finding.relation, finding.object].filter(Boolean).join(' ');
}

function endpointLabel(filters: OracleDigFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set('query', filters.query.trim());
  if (filters.topics.length) params.set('topic', filters.topics.join(','));
  if (filters.confidence !== 'all') params.set('confidence', filters.confidence);
  if (filters.evidenceKinds.length) params.set('evidenceKind', filters.evidenceKinds.join(','));
  if (filters.dugBy.trim()) params.set('dugBy', filters.dugBy.trim());
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  const query = params.toString();
  return `/api/plugins/oracle-dig${query ? `?${query}` : ''}`;
}

function ToggleGroup<T extends string>({ label, options, selected, onToggle }: {
  label: string;
  options: readonly T[];
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <button key={option} aria-pressed={selected.includes(option)} className={`${quietButton} ${selected.includes(option) ? activeButton : ''}`} type="button" onClick={() => onToggle(option)}>
            {option}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function FilterBar({ filters, onChange, onTopic, onKind, onReset }: {
  filters: OracleDigFilters;
  onChange: (updates: Partial<OracleDigFilters>) => void;
  onTopic: (topic: FindingTopic) => void;
  onKind: (kind: EvidenceKind) => void;
  onReset: () => void;
}) {
  return (
    <section className="glass grid gap-4 rounded-3xl p-4 sm:p-5" aria-label="Oracle Dig filters">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_repeat(3,minmax(0,0.7fr))_auto] lg:items-end">
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="oracle-dig-query">
          Search findings
          <input id="oracle-dig-query" className={inputClass} type="search" placeholder="schema, provenance, fleet…" value={filters.query} onChange={(event) => onChange({ query: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="oracle-dig-dug-by">
          Dug by
          <input id="oracle-dig-dug-by" className={inputClass} placeholder="metis" value={filters.dugBy} onChange={(event) => onChange({ dugBy: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="oracle-dig-confidence">
          Confidence
          <select id="oracle-dig-confidence" className={inputClass} value={filters.confidence} onChange={(event) => onChange({ confidence: event.currentTarget.value as OracleDigFilters['confidence'] })}>
            {confidenceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="oracle-dig-since">
          Since
          <input id="oracle-dig-since" className={inputClass} type="date" value={filters.since} onChange={(event) => onChange({ since: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="oracle-dig-until">
          Until
          <input id="oracle-dig-until" className={inputClass} type="date" value={filters.until} onChange={(event) => onChange({ until: event.currentTarget.value })} />
        </label>
        <button className={`${quietButton} justify-self-start lg:justify-self-stretch`} type="button" onClick={onReset}>Reset</button>
      </div>
      <ToggleGroup label="Topic" options={FINDING_TOPICS} selected={filters.topics} onToggle={onTopic} />
      <ToggleGroup label="Evidence" options={EVIDENCE_KINDS} selected={filters.evidenceKinds} onToggle={onKind} />
    </section>
  );
}

function FindingRow({ finding, active, onSelect }: { finding: OracleFinding; active: boolean; onSelect: () => void }) {
  const evidence = evidenceForFinding(finding.id);
  return (
    <li>
      <button aria-pressed={active} className={`focus-ring grid w-full min-w-0 gap-3 rounded-2xl border p-4 text-left transition hover:border-accent-border hover:bg-surface-muted md:grid-cols-[9rem_minmax(0,1fr)_auto] md:items-start ${active ? 'border-accent-border bg-accent-soft' : 'border-border bg-surface'}`} type="button" onClick={onSelect}>
        <time className="font-mono text-xs text-text-muted" dateTime={new Date(finding.asOfTs).toISOString()}>{formatTime(finding.asOfTs)}</time>
        <span className="min-w-0">
          <span className="block break-words text-sm font-semibold text-text">{findingText(finding)}</span>
          <span className="mt-1 block text-sm leading-6 text-text-muted">{finding.dugBy} · {finding.topic} · {evidence.length} evidence record{evidence.length === 1 ? '' : 's'}</span>
        </span>
        <Badge tone={finding.confidence >= 0.85 ? 'success' : finding.confidence >= 0.7 ? 'accent' : 'warning'} dot>{confidenceLabel(finding.confidence)} {Math.round(finding.confidence * 100)}%</Badge>
      </button>
    </li>
  );
}

function FindingsList({ findings, activeId, onSelect }: { findings: OracleFinding[]; activeId: string; onSelect: (id: string) => void }) {
  if (!findings.length) return <EmptyState text="No mocked oracle_dig findings match the current filters." />;
  return (
    <ol className="grid gap-3" aria-label="Oracle Dig findings">
      {findings.map((finding) => <FindingRow key={finding.id} finding={finding} active={finding.id === activeId} onSelect={() => onSelect(finding.id)} />)}
    </ol>
  );
}

function EvidenceLine({ item }: { item: OracleEvidence }) {
  const label = item.githubPath ?? item.sessionId ?? item.oracleMsgFrom ?? item.webUrl ?? 'typed evidence';
  const detail = item.kind === 'github'
    ? `${item.githubOwner}/${item.githubRepo}@${item.githubRef}:${item.githubLine ?? 'path'}`
    : item.kind === 'session'
      ? `${item.sessionOracle} · ${item.sessionId}`
      : item.kind === 'oracle-msg'
        ? `${item.oracleMsgFrom} · ${formatTime(item.oracleMsgAt)}`
        : `${item.webUrl} · fetched ${formatTime(item.webFetchedAt)}`;
  return (
    <article className="rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={evidenceTones[item.kind]}>{item.kind}</Badge><span className="font-mono text-xs text-text-muted">#{item.id}</span></div>
      <p className="mt-3 break-all text-sm font-semibold text-text">{label}</p>
      <p className="mt-2 break-words text-sm leading-6 text-text-muted">{detail}</p>
      <p className="mt-3 break-all font-mono text-xs text-text-muted">commit {item.commit ?? 'not pinned'}</p>
    </article>
  );
}

function EvidenceView({ finding }: { finding: OracleFinding | undefined }) {
  if (!finding) return <EmptyState text="Select a finding to inspect typed evidence." />;
  const evidence = evidenceForFinding(finding.id);
  return (
    <aside className="glass grid min-w-0 gap-4 rounded-3xl p-4 sm:p-5" aria-labelledby="oracle-dig-evidence-title">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Evidence view</p>
        <h2 id="oracle-dig-evidence-title" className="mt-2 break-words text-xl font-semibold text-text">{findingText(finding)}</h2>
        <p className="mt-2 break-all font-mono text-xs text-text-muted">finding {finding.id} · as of {formatTime(finding.asOfTs)}</p>
      </div>
      <div className="grid gap-3">{evidence.map((item) => <EvidenceLine key={item.id} item={item} />)}</div>
    </aside>
  );
}

export function OracleDigPage() {
  const [filters, setFilters] = useState<OracleDigFilters>(emptyOracleDigFilters);
  const [selectedId, setSelectedId] = useState('');
  const findings = useMemo(() => searchMockOracleFindings(filters), [filters]);
  const activeId = selectedId && findings.some((finding) => finding.id === selectedId) ? selectedId : findings[0]?.id ?? '';
  const activeFinding = findings.find((finding) => finding.id === activeId);
  const evidenceCount = findings.reduce((count, finding) => count + evidenceForFinding(finding.id).length, 0);
  const highCount = findings.filter((finding) => confidenceLabel(finding.confidence) === 'high').length;

  function toggleTopic(topic: FindingTopic) {
    setFilters((current) => ({ ...current, topics: current.topics.includes(topic) ? current.topics.filter((value) => value !== topic) : [...current.topics, topic] }));
  }

  function toggleKind(kind: EvidenceKind) {
    setFilters((current) => ({ ...current, evidenceKinds: current.evidenceKinds.includes(kind) ? current.evidenceKinds.filter((value) => value !== kind) : [...current.evidenceKinds, kind] }));
  }

  return (
    <section className="grid w-full min-w-0 gap-5" aria-labelledby="oracle-dig-title">
      <header className="glass rounded-3xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Oracle Dig / Provenance</p>
        <h1 id="oracle-dig-title" className="mt-2 text-3xl font-semibold text-text">Oracle Dig findings</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">Mocked Phase 5 browser for relationship findings and typed evidence. The fixture mirrors oracle_findings + oracle_finding_evidence and the pending {ORACLE_DIG_CONTRACT} contract.</p>
      </header>
      <section className="grid gap-3 sm:grid-cols-3" aria-label="Oracle Dig summary">
        <StatCard label="Findings" value={findings.length} detail="mocked relationship triples after filters" tone="accent" />
        <StatCard label="Evidence" value={evidenceCount} detail="typed records linked to visible findings" tone="success" />
        <StatCard label="High confidence" value={highCount} detail="findings at or above 85%" tone="neutral" />
      </section>
      <FilterBar filters={filters} onChange={(updates) => setFilters((current) => ({ ...current, ...updates }))} onTopic={toggleTopic} onKind={toggleKind} onReset={() => { setFilters(emptyOracleDigFilters); setSelectedId(''); }} />
      <p className="break-all font-mono text-xs text-text-muted">Mock endpoint: {endpointLabel(filters)}</p>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(22rem,0.75fr)] xl:items-start">
        <FindingsList findings={findings} activeId={activeId} onSelect={setSelectedId} />
        <EvidenceView finding={activeFinding} />
      </div>
    </section>
  );
}
