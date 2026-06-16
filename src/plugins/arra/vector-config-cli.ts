type CliResult = { ok: boolean; output?: string; error?: string };
const VECTOR_ENDPOINT = "/api/v1/vector/config";

function apiBase(): string {
  const raw =
    process.env.ORACLE_API ??
    process.env.NEO_ARRA_API ??
    "http://localhost:47778";
  return String(raw).replace(/\/$/, "");
}
function json(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
function bool(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error("enabled must be true or false");
}
function requireArg(value: string | undefined, usage: string): string {
  if (!value || value.startsWith("-")) throw new Error(usage);
  return value;
}
function clean(args: string[]): string[] {
  return args.filter(
    (arg) => !["--json", "--yml", "--yaml", "--yes", "-y"].includes(arg),
  );
}

async function request(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(body);
  }
  const response = await fetch(`${apiBase()}${path}`, init);
  if (!response.ok)
    throw new Error(
      `${method} ${path} failed: HTTP ${response.status} ${await response.text()}`,
    );
  return response.json();
}

function resolveKey(payload: any, collection: string): string | undefined {
  if (payload.config.collections[collection]) return collection;
  return Object.entries(payload.config.collections).find(
    ([, item]: any) => item.collection === collection,
  )?.[0] as string | undefined;
}

function rows(payload: any) {
  return Object.entries(payload.config.collections).map(([key, item]: any) => ({
    key,
    collection: item.collection,
    model: item.model,
    provider: item.provider,
    adapter: item.adapter,
    enabled: item.enabled !== false,
    primary: item.primary,
    docs: payload.doc_counts?.[key] ?? 0,
    status: payload.health?.[key]?.status ?? "unknown",
    source: payload.source,
  }));
}

function fieldPayload(args: string[]): Record<string, unknown> {
  const rest = clean(args);
  const payload: Record<string, unknown> = {};
  if (rest[0]?.startsWith("--") || rest.some((arg) => arg.startsWith("--"))) {
    for (let i = 0; i < rest.length; i += 2) {
      const field = rest[i]?.replace(/^--/, "").replace(/^url$/, "endpoint");
      const value = rest[i + 1];
      if (!field || !value)
        throw new Error(
          "usage: vector-config set <collection> --field <value>",
        );
      payload[field] = field === "enabled" ? bool(value) : value;
    }
    return payload;
  }
  for (let i = 0; i < rest.length; i += 2) {
    const field = rest[i];
    const value = rest[i + 1];
    if (!field || !value)
      throw new Error("usage: vector-config set <collection> <field> <value>");
    payload[field] = field === "enabled" ? bool(value) : value;
  }
  return payload;
}

async function readOne(sub: string, rest: string[]): Promise<CliResult> {
  const payload = await request(VECTOR_ENDPOINT);
  const collection =
    sub === "get"
      ? requireArg(rest[0], "usage: vector-config get <collection>")
      : rest[0];
  if (!collection)
    return {
      ok: true,
      output: json({ source: payload.source, collections: rows(payload) }),
    };
  const key = resolveKey(payload, collection);
  if (!key) throw new Error(`unknown collection: ${collection}`);
  const row = rows(payload).find((item) => item.key === key) ?? {};
  const body =
    sub === "get"
      ? {
          source: payload.source,
          key,
          config: payload.config.collections[key],
          count: (row as any).docs,
          health: payload.health?.[key],
        }
      : { source: payload.source, ...(row as object) };
  return { ok: true, output: json(body) };
}

export async function vectorConfigCli(args: string[]): Promise<CliResult> {
  try {
    const [raw = "list", ...rest] = args;
    const sub = raw.toLowerCase();
    if (sub === "list") {
      const payload = await request(VECTOR_ENDPOINT);
      return {
        ok: true,
        output: json({
          source: payload.source,
          count: rows(payload).length,
          collections: rows(payload),
        }),
      };
    }
    if (sub === "stats" || sub === "get") return readOne(sub, rest);
    if (sub === "set")
      return {
        ok: true,
        output: json(
          await request(
            `${VECTOR_ENDPOINT}/${encodeURIComponent(requireArg(rest[0], "usage: vector-config set <collection>"))}`,
            "PUT",
            fieldPayload(rest.slice(1)),
          ),
        ),
      };
    if (sub === "add")
      return {
        ok: true,
        output: json(
          await request(
            `${VECTOR_ENDPOINT}/${encodeURIComponent(requireArg(rest[0], "usage: vector-config add <collection>"))}`,
            "POST",
            fieldPayload(rest.slice(1)),
          ),
        ),
      };
    if (sub === "remove" || sub === "rm")
      return {
        ok: true,
        output: json(
          await request(
            `${VECTOR_ENDPOINT}/${encodeURIComponent(requireArg(rest[0], "usage: vector-config remove <collection>"))}`,
            "DELETE",
          ),
        ),
      };
    if (sub === "set-primary" || sub === "primary")
      return {
        ok: true,
        output: json(
          await request(
            `${VECTOR_ENDPOINT}/${encodeURIComponent(requireArg(rest[0], "usage: vector-config set-primary <collection>"))}/primary`,
            "POST",
          ),
        ),
      };
    if (sub === "reload")
      return {
        ok: true,
        output: json(await request(`${VECTOR_ENDPOINT}/reload`, "POST")),
      };
    if (sub === "test")
      return {
        ok: true,
        output: json(
          await request(
            `${VECTOR_ENDPOINT}/${encodeURIComponent(requireArg(rest[0], "usage: vector-config test <collection>"))}/test`,
            "POST",
          ),
        ),
      };
    throw new Error(
      "try: vector-config list|get|stats|set|add|remove|set-primary|reload|test",
    );
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
