import { invoke } from '@tauri-apps/api/core';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

type GateState = 'checking' | 'ready' | 'unreachable';

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI__);
}

function okStatus(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().startsWith('2');
  if (typeof value === 'number') return value >= 200 && value < 300;
  return false;
}

async function browserHealthCheck(): Promise<void> {
  const response = await fetch('/api/health', { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`/api/health returned ${response.status}`);
}

async function tauriHealthCheck(): Promise<void> {
  const status = await invoke<string>('health_check');
  if (!okStatus(status)) throw new Error(`health_check returned ${String(status)}`);
}

export function BackendGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>('checking');
  const [message, setMessage] = useState('Checking backend health…');
  const [starting, setStarting] = useState(false);
  const isTauri = isTauriRuntime();

  const check = useCallback(async () => {
    setState('checking');
    setMessage('Checking backend health…');
    try {
      if (isTauri) await tauriHealthCheck();
      else await browserHealthCheck();
      setState('ready');
    } catch (error) {
      setState('unreachable');
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [isTauri]);

  useEffect(() => {
    void check();
  }, [check]);

  async function startBackend() {
    setStarting(true);
    setMessage('Starting backend…');
    try {
      await invoke('start_backend');
      await check();
    } catch (error) {
      setState('unreachable');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  if (state === 'ready') return <>{children}</>;

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
      <section className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/[0.04] p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-teal-300">ARRA Oracle</p>
        <h1 className="mt-3 text-3xl font-bold">Backend unavailable</h1>
        <p className="mt-4 text-sm text-slate-300">
          {state === 'checking' ? 'Checking whether the local Oracle API is ready.' : message}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          {state === 'unreachable' && isTauri && (
            <button
              className="focus-ring rounded-full bg-teal-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-teal-300 disabled:opacity-60"
              disabled={starting}
              type="button"
              onClick={() => void startBackend()}
            >
              {starting ? 'Starting…' : 'Start Backend'}
            </button>
          )}
          <button
            className="focus-ring rounded-full border border-white/15 px-4 py-2 text-sm font-semibold text-slate-100 hover:bg-white/10"
            type="button"
            onClick={() => void check()}
          >
            Retry
          </button>
        </div>
      </section>
    </main>
  );
}
