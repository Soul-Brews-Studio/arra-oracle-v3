import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiUrl } from "../api";
import { Spinner } from "./AsyncState";
import { StepBody, setupSteps } from "./SetupWizardContent";
import { shouldShowSetupWizard } from "./setupWizardDetection";
import type { Provider, Stats, Step, VectorConfig } from "./setupWizardTypes";

export { shouldShowSetupWizard } from "./setupWizardDetection";

type SetupState = "checking" | "hidden" | "visible";
const DISMISS_KEY = "arra.vector.setup.dismissed";

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(apiUrl(path), {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export function SetupWizard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SetupState>("checking");
  const [step, setStep] = useState<Step>(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [config, setConfig] = useState<VectorConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (
      typeof window !== "undefined" &&
      window.localStorage?.getItem(DISMISS_KEY) === "1"
    ) {
      setState("hidden");
      return;
    }
    let active = true;
    Promise.allSettled([
      getJson<Stats>("/api/stats"),
      getJson<VectorConfig>("/api/v1/vector/config"),
      getJson<{ providers?: Provider[] }>("/api/v1/vector/providers"),
    ])
      .then(([statsResult, configResult, providersResult]) => {
        if (!active) return;
        const stats =
          statsResult.status === "fulfilled" ? statsResult.value : null;
        const vectorConfig =
          configResult.status === "fulfilled" ? configResult.value : null;
        if (providersResult.status === "fulfilled")
          setProviders(providersResult.value.providers ?? []);
        if (vectorConfig) setConfig(vectorConfig);
        setState(
          shouldShowSetupWizard(stats, vectorConfig) ? "visible" : "hidden",
        );
      })
      .catch(() => {
        if (active) setState("hidden");
      });
    return () => {
      active = false;
    };
  }, []);

  const recommended = useMemo(
    () =>
      providers.find((provider) => provider.available || provider.configured) ??
      providers[0],
    [providers],
  );

  async function refreshDetection() {
    setBusy(true);
    try {
      const [providerBody, vectorConfig] = await Promise.all([
        getJson<{ providers?: Provider[] }>("/api/v1/vector/providers"),
        getJson<VectorConfig>("/api/v1/vector/config"),
      ]);
      setProviders(providerBody.providers ?? []);
      setConfig(vectorConfig);
      setMessage("Auto-detect refreshed. Choose a provider and continue.");
    } finally {
      setBusy(false);
    }
  }

  async function startIndex() {
    const collections = Object.entries(config?.config?.collections ?? {});
    const key =
      collections.find(([, item]) => item.enabled !== false)?.[0] ??
      collections[0]?.[0];
    if (!key)
      return setMessage(
        "No vector collection is configured yet. Open Vector Settings to add one.",
      );
    setBusy(true);
    try {
      await fetch(apiUrl("/api/vector/index/start"), {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
        },
        body: JSON.stringify({ model: key }),
      });
      setStep(3);
      setMessage(
        `Started indexing ${key}. Continue to the dashboard or watch /vector/settings.`,
      );
    } finally {
      setBusy(false);
    }
  }

  function dismiss() {
    if (typeof window !== "undefined")
      window.localStorage?.setItem(DISMISS_KEY, "1");
    setState("hidden");
  }

  if (state !== "visible") return <>{children}</>;
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <section className="mx-auto max-w-4xl rounded-3xl border border-purple-300/20 bg-purple-300/10 p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-purple-200">
          First-run wizard
        </p>
        <h1 className="mt-3 text-3xl font-bold">Set up vector search</h1>
        <p className="mt-3 text-sm text-purple-100/80">
          No full-text documents and no active vector index were detected.
          Configure a provider, choose the initial vault source, then start
          indexing.
        </p>
        <ol className="mt-5 flex gap-2" aria-label="Setup steps">
          {setupSteps.map((label, index) => (
            <li
              key={label}
              className={`h-2 flex-1 rounded-full ${index <= step ? "bg-purple-200" : "bg-white/20"}`}
            />
          ))}
        </ol>
        <div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/60 p-5">
          <h2 className="text-xl font-semibold text-white">
            {setupSteps[step]}
          </h2>
          <StepBody
            step={step}
            providers={providers}
            recommended={recommended}
            config={config}
          />
        </div>
        {message ? (
          <p className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3 text-sm text-purple-100">
            {message}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-purple-100 disabled:opacity-50"
            disabled={step === 0}
            type="button"
            onClick={() => setStep((step - 1) as Step)}
          >
            Back
          </button>
          {step === 0 ? (
            <button
              className="focus-ring rounded-xl bg-purple-200 px-4 py-2 text-sm font-semibold text-slate-950"
              type="button"
              onClick={() => void refreshDetection()}
            >
              {busy ? <Spinner label="Detecting" /> : "Auto-detect providers"}
            </button>
          ) : null}
          {step === 2 ? (
            <button
              className="focus-ring rounded-xl bg-teal-200 px-4 py-2 text-sm font-semibold text-slate-950"
              type="button"
              onClick={() => void startIndex()}
            >
              {busy ? <Spinner label="Starting" /> : "Start indexing"}
            </button>
          ) : null}
          <button
            className="focus-ring rounded-xl border border-purple-200/40 px-4 py-2 text-sm font-semibold text-purple-100 disabled:opacity-50"
            disabled={step === 3}
            type="button"
            onClick={() => setStep((step + 1) as Step)}
          >
            Next
          </button>
          <a
            className="focus-ring rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-200"
            href="/vector/settings"
          >
            Open Vector Settings
          </a>
          <button
            className="focus-ring rounded-xl px-4 py-2 text-sm text-slate-400 hover:text-slate-100"
            type="button"
            onClick={dismiss}
          >
            Skip setup
          </button>
        </div>
      </section>
    </main>
  );
}
