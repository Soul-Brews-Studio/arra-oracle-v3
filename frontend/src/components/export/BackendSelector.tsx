import { useEffect, useMemo, useState } from 'react';

export const DEFAULT_BACKEND_URL = 'http://localhost:47778';
export const BACKEND_URLS_KEY = 'arra-oracle:export-backends';

type BackendSelectorProps = {
  value: string;
  onChange: (url: string) => void;
  storageKey?: string;
};

function browserStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeBackendUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return DEFAULT_BACKEND_URL;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, '');
}

export function uniqueBackendUrls(urls: string[]): string[] {
  return [...new Set(urls.map(normalizeBackendUrl))];
}

export function readSavedBackendUrls(storageKey = BACKEND_URLS_KEY): string[] {
  const storage = browserStorage();
  if (!storage) return [DEFAULT_BACKEND_URL];
  try {
    const parsed = JSON.parse(storage.getItem(storageKey) || '[]');
    if (!Array.isArray(parsed)) return [DEFAULT_BACKEND_URL];
    return uniqueBackendUrls([DEFAULT_BACKEND_URL, ...parsed.filter((item): item is string => typeof item === 'string')]);
  } catch {
    return [DEFAULT_BACKEND_URL];
  }
}

export function writeSavedBackendUrls(urls: string[], storageKey = BACKEND_URLS_KEY): string[] {
  const next = uniqueBackendUrls([DEFAULT_BACKEND_URL, ...urls]);
  try {
    browserStorage()?.setItem(storageKey, JSON.stringify(next));
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
  return next;
}

export function BackendSelector({ value, onChange, storageKey = BACKEND_URLS_KEY }: BackendSelectorProps) {
  const [savedUrls, setSavedUrls] = useState<string[]>(() => readSavedBackendUrls(storageKey));
  const [draftUrl, setDraftUrl] = useState(value || DEFAULT_BACKEND_URL);
  const normalizedValue = useMemo(() => normalizeBackendUrl(value), [value]);

  useEffect(() => {
    setSavedUrls(readSavedBackendUrls(storageKey));
  }, [storageKey]);

  useEffect(() => {
    setDraftUrl(value || DEFAULT_BACKEND_URL);
  }, [value]);

  function choose(url: string) {
    const normalized = normalizeBackendUrl(url);
    onChange(normalized);
    setDraftUrl(normalized);
  }

  function saveDraft() {
    const normalized = normalizeBackendUrl(draftUrl);
    setSavedUrls(writeSavedBackendUrls([...savedUrls, normalized], storageKey));
    onChange(normalized);
    setDraftUrl(normalized);
  }

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-field p-4 shadow-sm dark:border-border dark:bg-surface-muted" aria-label="Saved backend selector">
      <label className="grid gap-2 text-sm font-medium text-text dark:text-text-muted">
        Saved backend
        <select
          className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-on-accent dark:border-border dark:bg-field dark:text-text"
          value={savedUrls.includes(normalizedValue) ? normalizedValue : ''}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          {!savedUrls.includes(normalizedValue) ? <option value="">Custom backend</option> : null}
          {savedUrls.map((url) => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-2 text-sm font-medium text-text dark:text-text-muted">
          Backend URL
          <input
            className="focus-ring rounded-xl border border-border bg-field px-4 py-3 text-on-accent placeholder:text-text-muted dark:border-border dark:bg-field dark:text-text dark:placeholder:text-text-muted"
            placeholder={DEFAULT_BACKEND_URL}
            type="text"
            value={draftUrl}
            onChange={(event) => {
              setDraftUrl(event.currentTarget.value);
              onChange(event.currentTarget.value);
            }}
          />
        </label>
        <button
          className="focus-ring rounded-xl border border-accent-border px-4 py-3 text-sm font-semibold text-accent hover:bg-accent-soft dark:border-accent-border dark:text-accent dark:hover:bg-accent-soft"
          type="button"
          onClick={saveDraft}
        >
          Save URL
        </button>
      </div>
    </div>
  );
}
