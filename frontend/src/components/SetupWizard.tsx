import { useEffect, useMemo, useState, type ReactNode } from "react";
import { apiFetch } from "../api";
import { ErrorMessage, Spinner } from "./AsyncState";
import { StateNotice } from "./StateNotice";
import { StepBody, setupSteps } from "./SetupWizardContent";
import { shouldShowSetupWizard } from "./setupWizardDetection";
import { buildIndexStartBody, requestVectorIndexStart } from "./setupWizardIndex";
import { buildProviderConfigPatch, recommendedProvider } from "./setupWizardProvider";
import type { Provider, Stats, Step, VectorConfig, VectorIndexSource } from "./setupWizardTypes";

export { shouldShowSetupWizard } from "./setupWizardDetection";

type SetupState = "checking" | "hidden" | "visible";
const DISMISS_KEY = "arra.vector.setup.dismissed";

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

async function getJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

export function SetupWizard({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SetupState>("checking");
  const [step, setStep] = useState<Step>(0);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [indexSource, setIndexSource] = useState<VectorIndexSource>("auto");
  const [repoRoot, setRepoRoot] = useState("");
  const [config, setConfig] = useState<VectorConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

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
      getJson<Stats>("/api/stats"), getJson<VectorConfig>("/api/v1/vector/config"), getJson<{ providers?: Provider[] }>("/api/v1/vector/providers"),
    ])
      .then(([statsResult, configResult, providersResult]) => {
        if (!active) return;
        const stats = statsResult.status === "fulfilled" ? statsResult.value : null;
        const vectorConfig = configResult.status === "fulfilled" ? configResult.value : null;
        if (providersResult.status === "fulfilled") {
          const nextProviders = providersResult.value.providers ?? [];
          setProviders(nextProviders);
          setSelectedProvider((current) => current || recommendedProvider(nextProviders)?.type || "");
        }
        if (vectorConfig) setConfig(vectorConfig);
        setState(shouldShowSetupWizard(stats, vectorConfig) ? "visible" : "hidden");
      })
      .catch(() => {
        if (active) setState("hidden");
      });
    return () => {
      active = false;
    };
  }, []);

  const recommended = useMemo(() => recommendedProvider(providers), [providers]);

  async function refreshDetection() {
    setBusy(true);
    setError("");
    try {
      const [providerBody, vectorConfig] = await Promise.all([
        getJson<{ providers?: Provider[] }>("/api/v1/vector/providers"),
        getJson<VectorConfig>("/api/v1/vector/config"),
      ]);
      const nextProviders = providerBody.providers ?? [];
      setProviders(nextProviders);
      setSelectedProvider((current) => current || recommendedProvider(nextProviders)?.type || "");
      setConfig(vectorConfig);
      setMessage("Auto-detect refreshed. Choose a provider and continue.");
    } catch (cause) {
      setMessage("");
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function applyProvider() {
    if (!selectedProvider) return setMessage("Choose an embedding provider first.");
    setBusy(true);
    setError("");
    try {
      const response = await apiFetch("/api/v1/vector/config", {
        method: "PATCH",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify(buildProviderConfigPatch(config, selectedProvider)),
      });
      if (!response.ok) throw new Error(`/api/v1/vector/config returned ${response.status}`);
      await apiFetch("/api/v1/vector/config/reload", { method: "POST", headers: { accept: "application/json" } });
      setConfig(await getJson<VectorConfig>("/api/v1/vector/config"));
      setStep(2);
      setMessage(`Applied ${selectedProvider} as the first-run embedding provider.`);
    } catch (cause) {
      setMessage("");
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function startIndex() {
    const body = buildIndexStartBody(config, indexSource, repoRoot);
    if ('error' in body) return setMessage(body.error);
    setBusy(true);
    setError("");
    try {
      await requestVectorIndexStart(body);
      setStep(3);
      setMessage(`Started indexing ${body.model} from ${body.source}. Continue to the dashboard or watch /vector/settings.`);
    } catch (cause) {
      setMessage("");
      setError(errorMessage(cause));
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
    <main className="min-h-screen bg-field p-6 text-text">
      <section className="mx-auto max-w-4xl rounded-3xl border border-accent2-border bg-accent2-soft p-6 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.3em] text-accent2">First-run wizard</p>
        <h1 className="mt-3 text-3xl font-bold">Set up vector search</h1>
        <p className="mt-3 text-sm text-accent2">No full-text documents and no active vector index were detected. Configure a provider, choose the initial vault source, then start indexing.</p>
        <ol className="mt-5 flex gap-2" aria-label="Setup steps">
          {setupSteps.map((label, index) => (
            <li
              key={label}
              className={`h-2 flex-1 rounded-full ${index <= step ? "bg-accent2-solid" : "bg-field/20"}`}
            />
          ))}
        </ol>
        <div className="mt-6 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-xl font-semibold text-text">{setupSteps[step]}</h2>
          <StepBody
            step={step}
            providers={providers}
            recommended={recommended}
            config={config}
            selectedProvider={selectedProvider}
            onProviderSelect={setSelectedProvider}
            indexSource={indexSource}
            repoRoot={repoRoot}
            onIndexSource={setIndexSource}
            onRepoRoot={setRepoRoot}
          />
        </div>
        {error ? <div className="mt-4"><ErrorMessage title="Setup action failed." message={error} /></div> : null}
        {message ? <div className="mt-4"><StateNotice tone="success" title="Setup status" detail={message} /></div> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-accent2 disabled:opacity-50"
            disabled={step === 0}
            type="button"
            onClick={() => setStep((step - 1) as Step)}
          >
            Back
          </button>
          {step === 0 ? (
            <button
              className="focus-ring rounded-xl bg-accent2-solid px-4 py-2 text-sm font-semibold text-on-accent"
              type="button"
              onClick={() => void refreshDetection()}
            >
              {busy ? <Spinner label="Detecting" /> : "Auto-detect providers"}
            </button>
          ) : null}
          {step === 1 ? (
            <button
              className="focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent"
              type="button"
              onClick={() => void applyProvider()}
            >
              {busy ? <Spinner label="Applying" /> : "Use selected provider"}
            </button>
          ) : null}
          {step === 2 ? (
            <button
              className="focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent"
              type="button"
              onClick={() => void startIndex()}
            >
              {busy ? <Spinner label="Starting" /> : "Start indexing"}
            </button>
          ) : null}
          <button
            className="focus-ring rounded-xl border border-accent2-border px-4 py-2 text-sm font-semibold text-accent2 disabled:opacity-50"
            disabled={step === 3}
            type="button"
            onClick={() => setStep((step + 1) as Step)}
          >
            Next
          </button>
          {step === 3 ? (
            <a
              className="focus-ring rounded-xl bg-accent-solid px-4 py-2 text-sm font-semibold text-on-accent"
              href="/vector"
            >
              Continue to dashboard
            </a>
          ) : null}
          <a
            className="focus-ring rounded-xl border border-border px-4 py-2 text-sm text-text"
            href="/vector/settings"
          >
            Open Vector Settings
          </a>
          <button
            className="focus-ring rounded-xl px-4 py-2 text-sm text-text-muted hover:text-text"
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
