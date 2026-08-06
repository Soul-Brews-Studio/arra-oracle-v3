import { invoke } from "@tauri-apps/api/core";
import { API_BASE, API_HOST, API_HOST_STORAGE_KEY, apiFetch, apiUrl, connectToApiHost, hasStoredApiHost } from "../api/oracle";
import { SetupWizard } from "./SetupWizard";
import { PnaGuide } from "./PnaGuide";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

export type GateState = "checking" | "ready" | "unreachable";
export type BrowserHealthIssue = "pna" | "cors";
export const DEFAULT_ORACLE_HOST = "localhost:47778";
export const ORACLE_HOST_STORAGE_KEY = API_HOST_STORAGE_KEY;

export class BrowserHealthError extends Error {
  constructor(message: string, readonly issue: BrowserHealthIssue) {
    super(message);
    this.name = "BrowserHealthError";
  }
}

declare global {
  interface Window {
    __TAURI__?: unknown;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && Boolean(window.__TAURI__);
}

function okStatus(value: unknown): boolean {
  if (typeof value === "string") return value.trim().startsWith("2");
  if (typeof value === "number") return value >= 200 && value < 300;
  return false;
}

export function normalizeOracleHost(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_ORACLE_HOST;
  try {
    const url = trimmed.includes("://") ? new URL(trimmed) : new URL(`http://${trimmed}`);
    return url.host || DEFAULT_ORACLE_HOST;
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0] || DEFAULT_ORACLE_HOST;
  }
}

export function connectUrlForHost(input: string, href: string): string {
  const url = new URL(href);
  url.searchParams.set("host", normalizeOracleHost(input));
  return url.toString();
}

function corsBlockedMessage(target: string): string {
  const origin = typeof window === "undefined" ? "this Studio origin" : window.location.origin;
  return `Reached ${target}, but ${origin} is not in the backend CORS allowlist. Add it to ARRA_CORS_ORIGINS and restart the backend.`;
}

async function noCorsProbe(target: string): Promise<boolean> {
  try {
    await fetch(target, { mode: "no-cors" });
    return true;
  } catch {
    return false;
  }
}

export async function browserHealthCheck(): Promise<void> {
  const target = apiUrl("/api/health");
  let response: Response;
  try {
    response = await apiFetch("/api/health", { headers: { accept: "application/json" } });
  } catch (error) {
    if (await noCorsProbe(target)) throw new BrowserHealthError(corsBlockedMessage(target), "cors");
    throw error;
  }
  if (!response.ok) throw new Error(`${target} returned ${response.status}`);
}

async function tauriHealthCheck(): Promise<void> {
  const status = await invoke<string>("health_check");
  if (!okStatus(status))
    throw new Error(`health_check returned ${String(status)}`);
}


export function ConnectOracleSetup({
  accessIssue = "pna",
  isTauri,
  message,
  onRetry,
  onStartBackend,
  starting,
  state,
  retryCount = 0,
}: {
  accessIssue?: BrowserHealthIssue;
  isTauri: boolean;
  message: string;
  onRetry: () => void;
  onStartBackend: () => void;
  starting: boolean;
  state: GateState;
  retryCount?: number;
}) {
  const [host, setHost] = useState(API_HOST);
  const target = API_BASE;

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    connectToApiHost(host);
  }

  const showGuide = !isTauri && accessIssue !== "cors";

  return (
    <main className="connect-shell flex min-h-screen items-center justify-center p-6 text-text">
      {showGuide ? <PnaGuide retryCount={retryCount} onRetry={onRetry} /> : null}
      <section className="connect-glass w-full max-w-xl rounded-3xl p-8">
        <div className="mb-6 flex flex-col items-center gap-4 text-center sm:flex-row sm:text-left">
          <div className="flex h-20 w-20 items-center justify-center rounded-[1.35rem] bg-[oklch(0.12_0.02_265)] text-5xl drop-shadow-[0_0_20px_oklch(0.60_0.15_300/0.5)]" aria-hidden="true">
            🔮
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-accent">ARRA Oracle</p>
            <h1 className="text-2xl font-bold">{state === "unreachable" ? "Backend unavailable" : "Connect to your Oracle"}</h1>
          </div>
        </div>
        <p className="text-sm text-text-muted">
          {state === "checking"
            ? `Checking backend health at ${target}.`
            : `Cannot reach ${target}: ${message}`}
        </p>
        {state === "unreachable" && accessIssue === "cors" ? (
          <div className="mt-4 rounded-2xl border border-warn-border bg-warn-bg p-4 text-sm text-warn-text">
            <p className="font-semibold">The backend answered, but this Studio origin is not trusted.</p>
            <p className="mt-1">Add this origin to <code className="rounded bg-black/10 px-1">ARRA_CORS_ORIGINS</code>, restart the backend, then retry.</p>
          </div>
        ) : null}

        <form className="mt-6 space-y-3" onSubmit={connect}>
          <label className="block text-sm font-semibold text-text" htmlFor="oracle-host">
            Local Oracle host
          </label>
          <input
            id="oracle-host"
            className="w-full rounded-2xl border border-white/20 bg-white/10 px-4 py-3 text-sm text-text outline-none backdrop-blur focus:border-accent"
            placeholder={DEFAULT_ORACLE_HOST}
            value={host}
            onChange={(event) => setHost(event.currentTarget.value)}
          />
          <p className="text-xs text-text-muted">
            Start your backend with <code className="rounded bg-white/10 px-1.5 py-0.5">arra-oracle-v3 serve</code>, then connect from hosted Studio.
            {!hasStoredApiHost() ? " The default is localhost:47778." : null}
          </p>
          <div className="flex flex-wrap gap-3 pt-1">
            <button
              className="focus-ring rounded-full bg-accent-solid px-5 py-2.5 text-sm font-semibold text-on-accent transition hover:bg-accent-hover"
              type="submit"
            >
              Use this backend
            </button>
            {state === "unreachable" && isTauri && (
              <button
                className="focus-ring rounded-full border border-accent-border px-5 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent-soft disabled:opacity-60"
                disabled={starting}
                type="button"
                onClick={onStartBackend}
              >
                {starting ? "Starting…" : "Start Backend"}
              </button>
            )}
            <button
              className="focus-ring rounded-full border border-white/20 px-5 py-2.5 text-sm font-semibold text-text transition hover:bg-white/10"
              type="button"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

export function BackendGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>("checking");
  const [message, setMessage] = useState("Checking backend health…");
  const [starting, setStarting] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [accessIssue, setAccessIssue] = useState<BrowserHealthIssue>("pna");
  const isTauri = isTauriRuntime();

  const check = useCallback(async (isRetry = false) => {
    setState("checking");
    setMessage("Checking backend health…");
    setAccessIssue("pna");
    if (isRetry) setRetryCount((c) => c + 1);
    try {
      if (isTauri) await tauriHealthCheck();
      else await browserHealthCheck();
      setState("ready");
    } catch (error) {
      setState("unreachable");
      setAccessIssue(error instanceof BrowserHealthError ? error.issue : "pna");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, [isTauri]);

  useEffect(() => {
    void check();
  }, [check]);

  async function startBackend() {
    setStarting(true);
    setMessage("Starting backend…");
    try {
      await invoke("start_backend");
      await check();
    } catch (error) {
      setState("unreachable");
      setAccessIssue("pna");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  if (state === "ready") return <SetupWizard>{children}</SetupWizard>;

  return (
    <ConnectOracleSetup
      accessIssue={accessIssue}
      isTauri={isTauri}
      message={message}
      onRetry={() => void check(true)}
      onStartBackend={() => void startBackend()}
      starting={starting}
      state={state}
      retryCount={retryCount}
    />
  );
}
