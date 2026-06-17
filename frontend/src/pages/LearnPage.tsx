import { useEffect, useState, type FormEvent } from 'react';
import { apiClient, type ApiClient } from '../api/client';
import { ErrorMessage, LoadingPanel } from '../components/AsyncState';
import { EmptyState } from '../components/EmptyState';
import type { LearnEntry, LearnMutationPayload } from '../types';

type PageState = 'idle' | 'loading' | 'ready' | 'saving' | 'error';
type LearnClient = Pick<ApiClient, 'learn' | 'createLearn' | 'updateLearn' | 'deleteLearn'>;

export interface LearnFormState {
  title: string;
  content: string;
  concepts: string;
}

const emptyForm: LearnFormState = { title: '', content: '', concepts: '' };

export function conceptsFromInput(value: string): string[] {
  return value.split(',').map((concept) => concept.trim()).filter(Boolean);
}

export function patternFromForm(form: LearnFormState): string {
  const title = form.title.trim();
  const content = form.content.trim();
  if (title && content) return `${title}\n\n${content}`;
  return title || content;
}

export function learnPayload(form: LearnFormState): LearnMutationPayload {
  return { pattern: patternFromForm(form), concepts: conceptsFromInput(form.concepts), source: 'Oracle Learn UI' };
}

export function formFromEntry(entry: LearnEntry): LearnFormState {
  return { title: entry.title, content: entry.content, concepts: entry.concepts.join(', ') };
}

export function learnSummary(state: PageState, total: number): string {
  if (state === 'loading') return 'Loading learn entries from /api/v1/learn…';
  if (state === 'saving') return 'Saving learn entry…';
  if (state === 'error') return 'Learn entries could not be loaded.';
  return total ? `${total} active learn entr${total === 1 ? 'y' : 'ies'}.` : 'No learn entries yet.';
}

export async function loadLearnEntries(client: Pick<ApiClient, 'learn'> = apiClient): Promise<LearnEntry[]> {
  return (await client.learn()).items;
}

function LearnForm({ editing, form, saving, onChange, onCancel, onSubmit }: {
  editing: boolean;
  form: LearnFormState;
  saving: boolean;
  onChange: (form: LearnFormState) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const disabled = saving || !patternFromForm(form);
  return (
    <form className="grid gap-3 rounded-2xl border border-border bg-surface-muted p-4" aria-label="Learn entry form" onSubmit={onSubmit}>
      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <label className="grid gap-2 text-sm font-medium text-text-muted">
          Learning title
          <input className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text" value={form.title} onChange={(event) => onChange({ ...form, title: event.currentTarget.value })} />
        </label>
        {editing ? <button className="focus-ring rounded-xl border border-border px-4 py-3 text-sm font-semibold text-text" type="button" onClick={onCancel}>Cancel edit</button> : null}
      </div>
      <label className="grid gap-2 text-sm font-medium text-text-muted">
        Content
        <textarea className="focus-ring min-h-36 rounded-xl border border-border bg-field px-4 py-3 text-text" value={form.content} onChange={(event) => onChange({ ...form, content: event.currentTarget.value })} />
      </label>
      <label className="grid gap-2 text-sm font-medium text-text-muted">
        Concepts
        <input className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-text" placeholder="comma, separated, concepts" value={form.concepts} onChange={(event) => onChange({ ...form, concepts: event.currentTarget.value })} />
      </label>
      <button className="focus-ring rounded-xl bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-solid disabled:cursor-not-allowed disabled:opacity-50" disabled={disabled} type="submit">
        {saving ? 'Saving…' : editing ? 'Update learning' : 'Add learning'}
      </button>
    </form>
  );
}

export function LearnEntryList({ entries, busy, onDelete, onEdit }: {
  entries: LearnEntry[];
  busy: boolean;
  onDelete: (entry: LearnEntry) => void;
  onEdit: (entry: LearnEntry) => void;
}) {
  if (!entries.length) return <EmptyState text="Create the first learn entry with the form above." />;
  return (
    <ul className="grid gap-3" aria-label="Learn entries">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-2xl border border-border bg-surface-muted p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-text">{entry.title}</h2>
              <p className="mt-1 text-xs text-text-muted">{entry.sourceFile}</p>
            </div>
            <div className="flex gap-2">
              <button className="focus-ring rounded-lg border border-border px-3 py-2 text-sm font-semibold text-text" disabled={busy} type="button" onClick={() => onEdit(entry)}>Edit</button>
              <button className="focus-ring rounded-lg border border-err-border/30 px-3 py-2 text-sm font-semibold text-err-text" disabled={busy} type="button" onClick={() => onDelete(entry)}>Soft-delete</button>
            </div>
          </div>
          <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-muted">{entry.content}</p>
          {entry.concepts.length ? <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-accent">{entry.concepts.join(' · ')}</p> : null}
        </li>
      ))}
    </ul>
  );
}

export function LearnPage({ client = apiClient }: { client?: LearnClient }) {
  const [entries, setEntries] = useState<LearnEntry[]>([]);
  const [form, setForm] = useState<LearnFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [state, setState] = useState<PageState>('idle');
  const [error, setError] = useState('');

  async function reload() {
    setState('loading');
    setError('');
    try {
      setEntries(await loadLearnEntries(client));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  useEffect(() => { void reload(); }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState('saving');
    setError('');
    try {
      if (editingId) await client.updateLearn(editingId, learnPayload(form));
      else await client.createLearn(learnPayload(form));
      setForm(emptyForm);
      setEditingId(null);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  async function remove(entry: LearnEntry) {
    setState('saving');
    setError('');
    try {
      await client.deleteLearn(entry.id);
      setEntries((current) => current.filter((item) => item.id !== entry.id));
      setState('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setState('error');
    }
  }

  const busy = state === 'loading' || state === 'saving';
  return (
    <section className="grid gap-5 rounded-3xl border border-border bg-surface p-5 sm:p-6" aria-labelledby="learn-page-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Learn</p>
        <h1 id="learn-page-title" className="mt-2 text-3xl font-semibold text-text">Learn entries</h1>
        <p className="mt-2 text-sm text-text-muted">List, add, edit, and soft-delete Oracle learnings through /api/v1/learn.</p>
      </div>
      <LearnForm editing={Boolean(editingId)} form={form} saving={state === 'saving'} onChange={setForm} onCancel={() => { setEditingId(null); setForm(emptyForm); }} onSubmit={submit} />
      <p className="text-sm text-text-muted">{learnSummary(state, entries.length)}</p>
      {state === 'loading' ? <LoadingPanel title="Loading learn entries…" detail="Fetching /api/v1/learn from the Elysia backend." /> : null}
      {state === 'error' ? <ErrorMessage title="Learn operation failed." message={error} /> : null}
      {state !== 'loading' ? <LearnEntryList entries={entries} busy={busy} onDelete={(entry) => void remove(entry)} onEdit={(entry) => { setEditingId(entry.id); setForm(formFromEntry(entry)); }} /> : null}
    </section>
  );
}
