import { useEffect, useState } from "react";
import { fetchJson } from "../lib/api-base";

type Raw = Record<string, unknown>;
type PluginServer = { healthPath?: string; autostart?: boolean; command?: string };
type Plugin = { name: string; description: string; server?: PluginServer };
type Status = { name: string; ok: boolean; detail: string; healthPath: string };

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizePlugins(payload: unknown): Plugin[] {
  const list = Array.isArray((payload as Raw)?.plugins) ? ((payload as Raw).plugins as unknown[]) : [];
  return list.map((item, index) => {
    const record = (item ?? {}) as Raw;
    const server = typeof record.server === "object" && record.server ? (record.server as PluginServer) : undefined;
    return {
      name: text(record.name, `plugin-${index + 1}`),
      description: text(record.description, "No description provided."),
      server,
    };
  });
}

async function checkServer(plugin: Plugin): Promise<Status> {
  try {
    const payload = await fetchJson<Raw>(`/api/plugins/${encodeURIComponent(plugin.name)}/server/health`);
    const healthy = payload.healthy === true || payload.ok === true;
    const status = typeof payload.status === "number" ? `HTTP ${payload.status}` : "reachable";
    return { name: plugin.name, ok: healthy, detail: healthy ? status : text(payload.error, status), healthPath: text(payload.healthPath, plugin.server?.healthPath ?? "/health") };
  } catch (err) {
    return { name: plugin.name, ok: false, detail: err instanceof Error ? err.message : String(err), healthPath: plugin.server?.healthPath ?? "/health" };
  }
}

export default function ServerStatusDashboard() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [statuses, setStatuses] = useState<Status[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchJson<unknown>("/api/plugins")
      .then(async (payload) => {
        const withServers = normalizePlugins(payload).filter((plugin) => plugin.server);
        setPlugins(withServers);
        setStatuses(await Promise.all(withServers.map(checkServer)));
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-950/40 p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold">Plugin server status</h2>
        <p className="mt-1 text-sm text-gray-500">Discovers /api/plugins entries with server manifests and checks their health.</p>
      </div>

      {loading && <p className="text-sm text-gray-500">Checking plugin servers…</p>}
      {error && <p className="rounded-lg border border-red-900/70 bg-red-950/40 p-4 text-sm text-red-300">{error}</p>}
      {!loading && !error && plugins.length === 0 && <p className="text-sm text-gray-500">No plugin server manifests installed.</p>}

      <div className="space-y-3">
        {plugins.map((plugin) => {
          const status = statuses.find((item) => item.name === plugin.name);
          return (
            <article key={plugin.name} className="rounded-xl border border-gray-800 bg-gray-900/80 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-mono text-sm text-teal-300">{plugin.name}</h3>
                  <p className="mt-1 text-sm text-gray-400">{plugin.description}</p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${status?.ok ? "bg-teal-900/60 text-teal-200" : "bg-red-950 text-red-300"}`}>
                  {status?.ok ? "healthy" : "needs attention"}
                </span>
              </div>
              <dl className="mt-3 grid gap-2 text-xs text-gray-500 sm:grid-cols-3">
                <div><dt>health</dt><dd className="text-gray-300">{status?.healthPath ?? plugin.server?.healthPath ?? "/health"}</dd></div>
                <div><dt>autostart</dt><dd className="text-gray-300">{plugin.server?.autostart === false ? "no" : "yes"}</dd></div>
                <div><dt>detail</dt><dd className="break-all text-gray-300">{status?.detail ?? "pending"}</dd></div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
