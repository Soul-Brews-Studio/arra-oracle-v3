import { invoke } from "@tauri-apps/api/core";
import {
  API_BASE,
  API_HOST,
  API_HOST_STORAGE_KEY,
  apiFetch,
  apiUrl,
  connectToApiHost,
  hasStoredApiHost,
} from "../api/oracle";
import { SetupWizard } from "./SetupWizard";
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";

export type GateState = "checking" | "ready" | "unreachable";
export const DEFAULT_ORACLE_HOST = "localhost:47778";
export const ORACLE_HOST_STORAGE_KEY = API_HOST_STORAGE_KEY;

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

async function browserHealthCheck(): Promise<void> {
  const target = apiUrl("/api/health");
  const response = await apiFetch("/api/health", {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${target} returned ${response.status}`);
}

async function tauriHealthCheck(): Promise<void> {
  const status = await invoke<string>("health_check");
  if (!okStatus(status))
    throw new Error(`health_check returned ${String(status)}`);
}

export function ConnectOracleSetup({
  isTauri,
  message,
  onRetry,
  onStartBackend,
  starting,
  state,
}: {
  isTauri: boolean;
  message: string;
  onRetry: () => void;
  onStartBackend: () => void;
  starting: boolean;
  state: GateState;
}) {
  const [host, setHost] = useState(API_HOST);
  const target = API_BASE;

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    connectToApiHost(host);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-field p-6 text-text">
      <section className="w-full max-w-xl rounded-3xl border border-border bg-surface-muted p-8 shadow-2xl">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-accent">
          ARRA Oracle
        </p>
        <h1 className="mt-3 text-3xl font-bold">{state === "unreachable" ? "Backend unavailable" : "Connect to your Oracle"}</h1>
        <p className="mt-4 text-sm text-text-muted">
          {state === "checking"
            ? `Checking backend health at ${target}.`
            : `Cannot reach ${target}: ${message}`}
        </p>
        <form className="mt-6 space-y-3" onSubmit={connect}>
          <label className="block text-sm font-semibold text-text" htmlFor="oracle-host">
            Local Oracle host
          </label>
          <input
            id="oracle-host"
            className="w-full rounded-2xl border border-border bg-field px-4 py-3 text-sm text-text outline-none focus:border-accent"
            placeholder={DEFAULT_ORACLE_HOST}
            value={host}
            onChange={(event) => setHost(event.currentTarget.value)}
          />
          <p className="text-xs text-text-muted">
            Start your backend with <code>arra-oracle-v3 serve</code>, then connect from hosted Studio.
            {!hasStoredApiHost() ? " The default is localhost:47778." : null}
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              className="focus-ring rounded-full bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-solid"
              type="submit"
            >
              Use this backend
            </button>
            {state === "unreachable" && isTauri && (
              <button
                className="focus-ring rounded-full border border-accent-border px-4 py-2 text-sm font-semibold text-accent hover:bg-accent-solid/10 disabled:opacity-60"
                disabled={starting}
                type="button"
                onClick={onStartBackend}
              >
                {starting ? "Starting…" : "Start Backend"}
              </button>
            )}
            <button
              className="focus-ring rounded-full border border-border px-4 py-2 text-sm font-semibold text-text hover:bg-surface-muted"
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
  const isTauri = isTauriRuntime();

  const check = useCallback(async () => {
    setState("checking");
    setMessage("Checking backend health…");
    try {
      if (isTauri) await tauriHealthCheck();
      else await browserHealthCheck();
      setState("ready");
    } catch (error) {
      setState("unreachable");
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
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
    }
  }

  if (state === "ready") return <SetupWizard>{children}</SetupWizard>;

  return (
    <ConnectOracleSetup
      isTauri={isTauri}
      message={message}
      onRetry={() => void check()}
      onStartBackend={() => void startBackend()}
      starting={starting}
      state={state}
    />
  );
}
