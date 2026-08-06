import { useMemo, useState } from 'react';
import { Badge, type BadgeTone } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { StatCard } from '../components/StatCard';
import {
  FLEET_CHANNELS,
  FLEET_SEARCH_CONTRACT,
  FLEET_THREAD_CONTRACT,
  mockFleetThread,
  searchMockFleetMessages,
  type FleetChannel,
  type FleetLogFilters,
  type FleetMessage,
} from './fleetLogMock';

const emptyFilters: FleetLogFilters = { query: '', channels: [], from: '', to: '', since: '', until: '' };
const inputClass = 'focus-ring min-w-0 rounded-xl border border-border bg-field px-3 py-2 text-sm text-text placeholder:text-text-muted';
const quietButton = 'focus-ring rounded-xl border border-border px-3 py-2 text-sm font-semibold text-text-muted transition hover:border-accent-border hover:text-text';
const activeButton = 'border-accent-border bg-accent-soft text-accent';

const channelTones: Record<FleetChannel, BadgeTone> = {
  maw: 'accent',
  vault: 'success',
  webhook: 'warning',
  discord: 'neutral',
  'agent-team': 'accent',
  git: 'success',
};

function formatTime(value: number): string {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function preview(value: string | null): string {
  const compact = (value ?? '').replace(/\s+/g, ' ').trim();
  return compact.length > 150 ? `${compact.slice(0, 149).trimEnd()}…` : compact || 'No text captured.';
}

function actor(value: string | null): string {
  return value?.trim() || 'unknown';
}

function endpointLabel(filters: FleetLogFilters): string {
  const params = new URLSearchParams();
  if (filters.query.trim()) params.set('query', filters.query.trim());
  if (filters.channels.length) params.set('channel', filters.channels.join(','));
  if (filters.from.trim()) params.set('from', filters.from.trim());
  if (filters.to.trim()) params.set('to', filters.to.trim());
  if (filters.since) params.set('since', filters.since);
  if (filters.until) params.set('until', filters.until);
  const query = params.toString();
  return `/api/fleet-log/search${query ? `?${query}` : ''}`;
}

function ChannelFilter({ filters, onToggle }: { filters: FleetLogFilters; onToggle: (channel: FleetChannel) => void }) {
  return (
    <fieldset className="grid gap-2">
      <legend className="text-xs font-semibold uppercase tracking-[0.18em] text-text-muted">Channel</legend>
      <div className="flex flex-wrap gap-2">
        {FLEET_CHANNELS.map((channel) => {
          const selected = filters.channels.includes(channel);
          return (
            <button
              key={channel}
              aria-pressed={selected}
              className={`${quietButton} ${selected ? activeButton : ''}`}
              type="button"
              onClick={() => onToggle(channel)}
            >
              {channel}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function FilterBar({ filters, onChange, onToggle, onReset }: {
  filters: FleetLogFilters;
  onChange: (updates: Partial<FleetLogFilters>) => void;
  onToggle: (channel: FleetChannel) => void;
  onReset: () => void;
}) {
  return (
    <section className="glass grid gap-4 rounded-3xl p-4 sm:p-5" aria-label="Fleet log filters">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_repeat(4,minmax(0,0.8fr))_auto] lg:items-end">
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="fleet-log-query">
          Search text
          <input id="fleet-log-query" className={inputClass} type="search" placeholder="handoff, customer, schema…" value={filters.query} onChange={(event) => onChange({ query: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="fleet-log-from">
          From
          <input id="fleet-log-from" className={inputClass} placeholder="m5:digger" value={filters.from} onChange={(event) => onChange({ from: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="fleet-log-to">
          To
          <input id="fleet-log-to" className={inputClass} placeholder="oracle-support" value={filters.to} onChange={(event) => onChange({ to: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="fleet-log-since">
          Since
          <input id="fleet-log-since" className={inputClass} type="date" value={filters.since} onChange={(event) => onChange({ since: event.currentTarget.value })} />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-text" htmlFor="fleet-log-until">
          Until
          <input id="fleet-log-until" className={inputClass} type="date" value={filters.until} onChange={(event) => onChange({ until: event.currentTarget.value })} />
        </label>
        <button className={`${quietButton} justify-self-start lg:justify-self-stretch`} type="button" onClick={onReset}>Reset</button>
      </div>
      <ChannelFilter filters={filters} onToggle={onToggle} />
    </section>
  );
}

function TimelineRow({ message, active, onSelect }: { message: FleetMessage; active: boolean; onSelect: () => void }) {
  return (
    <li>
      <button
        aria-pressed={active}
        className={`focus-ring grid w-full min-w-0 gap-3 rounded-2xl border p-4 text-left transition hover:border-accent-border hover:bg-surface-muted md:grid-cols-[10rem_auto_minmax(0,0.8fr)_minmax(0,1.4fr)] md:items-start ${active ? 'border-accent-border bg-accent-soft' : 'border-border bg-surface'}`}
        type="button"
        onClick={onSelect}
      >
        <time className="font-mono text-xs text-text-muted" dateTime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
        <Badge tone={channelTones[message.channel]} dot>{message.channel}</Badge>
        <span className="min-w-0 break-words text-sm font-semibold text-text">{actor(message.fromId)} → {actor(message.toId)}</span>
        <span className="min-w-0 text-sm leading-6 text-text-muted">{preview(message.text)}</span>
      </button>
    </li>
  );
}

function TimelineList({ messages, activeThread, onSelect }: { messages: FleetMessage[]; activeThread: string; onSelect: (threadKey: string) => void }) {
  if (!messages.length) return <EmptyState text="No mocked fleet messages match the current filters." />;
  return (
    <ol className="grid gap-3" aria-label="Fleet log timeline">
      {messages.map((message) => (
        <TimelineRow
          key={message.id}
          message={message}
          active={message.threadKey === activeThread}
          onSelect={() => message.threadKey ? onSelect(message.threadKey) : undefined}
        />
      ))}
    </ol>
  );
}

function ThreadView({ threadKey, messages }: { threadKey: string; messages: FleetMessage[] }) {
  if (!threadKey) return <EmptyState text="Select a timeline row to inspect its reconciled thread." />;
  return (
    <aside className="glass grid min-w-0 gap-4 rounded-3xl p-4 sm:p-5" aria-labelledby="fleet-thread-title">
      <div className="min-w-0">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">Thread view</p>
        <h2 id="fleet-thread-title" className="mt-2 break-all text-xl font-semibold text-text">{threadKey}</h2>
        <p className="mt-2 break-words font-mono text-xs text-text-muted">{FLEET_THREAD_CONTRACT.replace(':key', encodeURIComponent(threadKey))}</p>
      </div>
      <div className="grid gap-3">
        {messages.map((message) => (
          <article key={message.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={channelTones[message.channel]}>{message.channel}</Badge>
              <time className="font-mono text-xs text-text-muted" dateTime={new Date(message.ts).toISOString()}>{formatTime(message.ts)}</time>
            </div>
            <p className="mt-3 text-sm font-semibold text-text">{actor(message.fromId)} → {actor(message.toId)}</p>
            <p className="mt-2 text-sm leading-6 text-text-muted">{message.text}</p>
            <p className="mt-3 break-all font-mono text-xs text-text-muted">{message.rawPath ?? 'rawPath: null'}</p>
          </article>
        ))}
      </div>
    </aside>
  );
}

export function FleetLogPage() {
  const [filters, setFilters] = useState<FleetLogFilters>(emptyFilters);
  const [selectedThread, setSelectedThread] = useState('');
  const messages = useMemo(() => searchMockFleetMessages(filters), [filters]);
  const activeThread = selectedThread && messages.some((message) => message.threadKey === selectedThread)
    ? selectedThread
    : messages.find((message) => message.threadKey)?.threadKey ?? '';
  const threadMessages = useMemo(() => activeThread ? mockFleetThread(activeThread) : [], [activeThread]);
  const threadCount = new Set(messages.map((message) => message.threadKey).filter(Boolean)).size;
  const channelCount = new Set(messages.map((message) => message.channel)).size;

  function updateFilters(updates: Partial<FleetLogFilters>) {
    setFilters((current) => ({ ...current, ...updates }));
  }

  function toggleChannel(channel: FleetChannel) {
    setFilters((current) => ({
      ...current,
      channels: current.channels.includes(channel)
        ? current.channels.filter((value) => value !== channel)
        : [...current.channels, channel],
    }));
  }

  return (
    <section className="grid w-full min-w-0 gap-5" aria-labelledby="fleet-log-title">
      <header className="glass rounded-3xl p-5 sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Fleet Log / Reconcile</p>
        <h1 id="fleet-log-title" className="mt-2 text-3xl font-semibold text-text">Fleet log console</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-muted">
          Mocked Phase 4 console for unified oracle communications. The fixture mirrors the fleetMessages schema and the pending {FLEET_SEARCH_CONTRACT} contract.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Fleet log summary">
        <StatCard label="Messages" value={messages.length} detail="mocked fleet_messages rows after filters" tone="accent" />
        <StatCard label="Threads" value={threadCount} detail="approximate threadKey groups" tone="success" />
        <StatCard label="Channels" value={channelCount || '—'} detail={filters.channels.length ? filters.channels.join(', ') : 'all mocked channels'} tone="neutral" />
      </section>

      <FilterBar filters={filters} onChange={updateFilters} onToggle={toggleChannel} onReset={() => {
        setFilters(emptyFilters);
        setSelectedThread('');
      }} />
      <p className="break-all font-mono text-xs text-text-muted">Mock endpoint: {endpointLabel(filters)}</p>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1.3fr)_minmax(22rem,0.7fr)] xl:items-start">
        <TimelineList messages={messages} activeThread={activeThread} onSelect={setSelectedThread} />
        <ThreadView threadKey={activeThread} messages={threadMessages} />
      </div>
    </section>
  );
}
