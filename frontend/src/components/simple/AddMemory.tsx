import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { apiFetch } from '../../api/oracle';
import type { LearnCreateResponse } from '../../types';

export const SIMPLE_MODE_SOURCE = 'Simple Mode';
export const ADD_MEMORY_ENDPOINT = '/api/v1/learn';
export const SAVE_CONFIRMATION_MS = 3_000;
const FADE_MS = 300;

export type SimpleMemoryPayload = {
  pattern: string;
  source: typeof SIMPLE_MODE_SOURCE;
};

export type SaveMemory = (payload: SimpleMemoryPayload) => Promise<unknown>;
export type AddMemoryStatus = 'idle' | 'saving' | 'saved' | 'error';

export function simpleMemoryPayload(pattern: string): SimpleMemoryPayload {
  return { pattern: pattern.trim(), source: SIMPLE_MODE_SOURCE };
}

function responseMessage(payload: unknown, fallback: string): string {
  if (typeof payload === 'object' && payload !== null && 'error' in payload) return String(payload.error);
  if (typeof payload === 'object' && payload !== null && 'message' in payload) return String(payload.message);
  return fallback;
}

export async function postSimpleMemory(payload: SimpleMemoryPayload): Promise<LearnCreateResponse> {
  const response = await apiFetch(ADD_MEMORY_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as unknown : {};
  if (!response.ok) {
    throw new Error(`${ADD_MEMORY_ENDPOINT} returned ${response.status}: ${responseMessage(body, response.statusText)}`);
  }
  return body as LearnCreateResponse;
}

export async function saveSimpleMemory(pattern: string, saveMemory: SaveMemory = postSimpleMemory): Promise<SimpleMemoryPayload> {
  const payload = simpleMemoryPayload(pattern);
  if (!payload.pattern) throw new Error('Memory text is required.');
  await saveMemory(payload);
  return payload;
}

export function AddMemoryFeedback({
  status,
  error,
  fading,
  saving,
  onRetry,
}: {
  status: AddMemoryStatus;
  error: string;
  fading: boolean;
  saving: boolean;
  onRetry: () => void;
}) {
  return (
    <div className="grid gap-3">
      <p
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className={`min-h-5 text-sm font-medium text-ok-text transition-opacity duration-300 ${status === 'saved' && !fading ? 'opacity-100' : 'opacity-0'}`}
      >
        {status === 'saved' ? 'Saved.' : ''}
      </p>
      {status === 'error' ? (
        <div className="rounded-2xl border border-err-border/40 bg-err-bg p-3 text-sm text-err-text" role="alert">
          <p className="font-semibold">Couldn’t save memory.</p>
          <p className="mt-1 break-words">{error || 'Try again when the backend is reachable.'}</p>
          <button
            className="focus-ring mt-3 rounded-full border border-err-border px-4 py-2 font-semibold hover:bg-surface"
            disabled={saving}
            type="button"
            onClick={onRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function AddMemory({
  saveMemory = postSimpleMemory,
  clearDelayMs = SAVE_CONFIRMATION_MS,
}: {
  saveMemory?: SaveMemory;
  clearDelayMs?: number;
}) {
  const textareaId = useId();
  const [text, setText] = useState('');
  const [status, setStatus] = useState<AddMemoryStatus>('idle');
  const [error, setError] = useState('');
  const [lastFailed, setLastFailed] = useState('');
  const [fading, setFading] = useState(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimers() {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    clearTimer.current = null;
    fadeTimer.current = null;
  }

  useEffect(() => clearTimers, []);

  function scheduleSavedClear() {
    clearTimers();
    clearTimer.current = setTimeout(() => {
      setFading(true);
      fadeTimer.current = setTimeout(() => {
        setStatus('idle');
        setFading(false);
      }, FADE_MS);
    }, clearDelayMs);
  }

  async function persistMemory(nextPattern = text) {
    const candidate = nextPattern.trim();
    if (status === 'saving') return;
    clearTimers();
    if (!candidate) {
      setLastFailed('');
      setError('Write a memory first.');
      setStatus('error');
      setFading(false);
      return;
    }
    setStatus('saving');
    setError('');
    setFading(false);
    try {
      await saveSimpleMemory(candidate, saveMemory);
      setText('');
      setLastFailed('');
      setStatus('saved');
      scheduleSavedClear();
    } catch (err) {
      setLastFailed(candidate);
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void persistMemory();
  }

  const saving = status === 'saving';
  const disabled = saving;
  return (
    <section className="grid gap-4 rounded-3xl border border-border bg-surface p-5 shadow-xl" aria-labelledby="simple-add-memory-title">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-accent">Memory</p>
        <h2 id="simple-add-memory-title" className="mt-2 text-2xl font-semibold text-text">Add a memory</h2>
        <p className="mt-2 text-sm text-text-muted">Capture a note for Oracle to remember from Simple Mode.</p>
      </div>
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-2 text-sm font-medium text-text-muted" htmlFor={textareaId}>
          Save something to memory
        </label>
        <textarea
          id={textareaId}
          className="focus-ring min-h-32 rounded-2xl border border-border bg-field px-4 py-3 text-text placeholder:text-text-muted"
          disabled={saving}
          aria-invalid={status === 'error' ? 'true' : undefined}
          placeholder="A detail, decision, or preference you want Oracle to recall."
          value={text}
          onChange={(event) => setText(event.currentTarget.value)}
        />
        <button
          className="focus-ring w-full rounded-full bg-accent-solid px-5 py-3 font-semibold text-on-accent transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          type="submit"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </form>
      <AddMemoryFeedback
        status={status}
        error={error}
        fading={fading}
        saving={saving}
        onRetry={() => void persistMemory(lastFailed || text)}
      />
    </section>
  );
}
