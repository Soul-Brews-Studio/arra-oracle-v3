type CliResult = { ok: boolean; output?: string; error?: string };
type VectorConfigPayload = {
  source?: string;
  config?: {
    collections?: Record<
      string,
      {
        collection?: string;
        model?: string;
        adapter?: string;
        enabled?: boolean;
      }
    >;
  };
  doc_counts?: Record<string, number>;
  health?: Record<
    string,
    {
      ok?: boolean;
      status?: string;
      adapter?: string;
      model?: string;
      collection?: string;
      error?: string;
    }
  >;
};

const VECTOR_CONFIG_ENDPOINT = "/api/v1/vector/config";
const HEALTH_ENDPOINT = "/api/health";

function apiBase(): string {
  const raw =
    process.env.ORACLE_API ??
    process.env.NEO_ARRA_API ??
    "http://localhost:47778";
  return String(raw).replace(/\/$/, "");
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new Error(
      `${path} failed: HTTP ${response.status} ${await response.text()}`,
    );
  return response.json() as Promise<T>;
}

function rows(payload: VectorConfigPayload) {
  return Object.entries(payload.config?.collections ?? {}).map(
    ([key, config]) => {
      const health = payload.health?.[key] ?? {};
      return {
        key,
        collection: health.collection ?? config.collection ?? key,
        adapter: health.adapter ?? config.adapter ?? "lancedb",
        model: health.model ?? config.model ?? "unknown",
        enabled: config.enabled !== false && health.status !== "disabled",
        docs: payload.doc_counts?.[key] ?? 0,
        status: health.status ?? "unknown",
        ok: health.ok ?? false,
        error: health.error,
      };
    },
  );
}

function renderTable(
  payload: VectorConfigPayload,
  serverStatus: unknown,
): string {
  const engines = rows(payload);
  const status =
    typeof serverStatus === "object" && serverStatus && "status" in serverStatus
      ? String((serverStatus as { status?: unknown }).status)
      : "unknown";
  const lines = [
    `arra health: ${status}`,
    `vector config: ${payload.source ?? "unknown"}`,
    "Collection | Adapter | Model | Docs | Status",
  ];
  for (const engine of engines) {
    lines.push(
      `${engine.key} | ${engine.adapter} | ${engine.model} | ${engine.docs} | ${engine.status}${engine.error ? ` (${engine.error})` : ""}`,
    );
  }
  if (!engines.length) lines.push("no vector engines reported");
  return lines.join("\n");
}

export async function vectorHealthCli(args: string[]): Promise<CliResult> {
  try {
    const [health, vector] = await Promise.allSettled([
      getJson<unknown>(HEALTH_ENDPOINT),
      getJson<VectorConfigPayload>(VECTOR_CONFIG_ENDPOINT),
    ]);
    const vectorPayload =
      vector.status === "fulfilled"
        ? vector.value
        : { config: { collections: {} } };
    const healthPayload =
      health.status === "fulfilled"
        ? health.value
        : {
            status: "unknown",
            error:
              health.reason instanceof Error
                ? health.reason.message
                : String(health.reason),
          };
    const payload = {
      health: healthPayload,
      source: vectorPayload.source,
      engines: rows(vectorPayload),
    };
    if (args.includes("--json"))
      return { ok: true, output: JSON.stringify(payload, null, 2) };
    return { ok: true, output: renderTable(vectorPayload, healthPayload) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
