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
  browserStorage()?.setItem(storageKey, JSON.stringify(next));
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
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4" aria-label="Saved backend selector">
      <label className="grid gap-2 text-sm font-medium text-slate-300">
        Saved backend
        <select
          className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100"
          value={savedUrls.includes(normalizedValue) ? normalizedValue : ''}
          onChange={(event) => choose(event.currentTarget.value)}
        >
          {!savedUrls.includes(normalizedValue) ? <option value="">Custom backend</option> : null}
          {savedUrls.map((url) => <option key={url} value={url}>{url}</option>)}
        </select>
      </label>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
        <label className="grid gap-2 text-sm font-medium text-slate-300">
          Backend URL
          <input
            className="focus-ring rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-slate-100 placeholder:text-slate-600"
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
          className="focus-ring rounded-xl border border-teal-300/30 px-4 py-3 text-sm font-semibold text-teal-100 hover:bg-teal-300/10"
          type="button"
          onClick={saveDraft}
        >
          Save URL
        </button>
      </div>
    </div>
  );
}
