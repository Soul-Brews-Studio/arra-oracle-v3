import { useMemo, useState } from 'react';
import type { VectorProvider } from '../api/oracle';

function modelsLabel(provider?: VectorProvider): string {
  return provider?.models?.length ? provider.models.join(', ') : 'No models detected yet.';
}

function gpuLabel(provider?: VectorProvider): string {
  return provider?.capabilities?.find((item) => item.toLowerCase().includes('gpu')) ?? 'GPU info unavailable';
}

export function VectorProviderConfigFields({ provider }: { provider?: VectorProvider }) {
  const [openAiKey, setOpenAiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [cfAccount, setCfAccount] = useState('');
  const [cfToken, setCfToken] = useState('');
  const type = provider?.type ?? '';
  const status = useMemo(() => provider?.status ?? (provider?.available ? 'running' : 'not detected'), [provider]);

  if (!provider) return <p className="mt-3 text-sm text-text-muted">Select a provider to configure credentials and model guidance.</p>;

  if (type === 'ollama') {
    return (
      <div className="mt-3 rounded-xl border border-border bg-field/50 p-3 text-sm text-text-muted">
        <p><span className="text-text-muted">Running status:</span> {status}</p>
        <p className="mt-1"><span className="text-text-muted">GPU:</span> {gpuLabel(provider)}</p>
        <p className="mt-1"><span className="text-text-muted">Models:</span> {modelsLabel(provider)}</p>
      </div>
    );
  }

  if (type === 'openai') {
    return (
      <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        OpenAI API key
        <input className="mt-1 w-full rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" placeholder="sk-…" type="password" value={openAiKey} onChange={(event) => setOpenAiKey(event.target.value)} />
      </label>
    );
  }

  if (type === 'gemini') {
    return (
      <label className="mt-3 block text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">
        Google Gemini API key <span className="rounded-full border border-warn-border bg-warn-bg px-2 py-0.5 text-[10px] text-warn-text">Free tier available!</span>
        <input className="mt-1 w-full rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" placeholder="AIza…" type="password" value={geminiKey} onChange={(event) => setGeminiKey(event.target.value)} />
      </label>
    );
  }

  if (type === 'cloudflare-ai') {
    return (
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Cloudflare account ID<input className="mt-1 w-full rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" value={cfAccount} onChange={(event) => setCfAccount(event.target.value)} /></label>
        <label className="text-xs font-semibold uppercase tracking-[0.16em] text-text-muted">Cloudflare API token<input className="mt-1 w-full rounded-xl border border-border bg-slate-900 px-3 py-2 text-sm text-text" type="password" value={cfToken} onChange={(event) => setCfToken(event.target.value)} /></label>
      </div>
    );
  }

  return <p className="mt-3 text-sm text-text-muted">Provider status: {status}. Models: {modelsLabel(provider)}</p>;
}
