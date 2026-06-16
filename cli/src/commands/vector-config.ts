import { emit } from "./_output.ts";
import { sessionFetch } from "./session-api.ts";

const ENDPOINT = "/api/v1/vector/config";

type CollectionEntry = {
  collection: string;
  model: string;
  provider: string;
  adapter?: string;
  enabled?: boolean;
  primary?: boolean;
};

type VectorPayload = {
  source: "file" | "defaults";
  config: { collections: Record<string, CollectionEntry> };
  doc_counts?: Record<string, number>;
  health?: Record<string, { ok: boolean; status: string; collection: string; adapter?: string; model?: string }>;
};

type UpdatePayload = {
  adapter?: string;
  model?: string;
  provider?: string;
  enabled?: boolean;
};

const HELP = `arra-cli vector-config <subcommand>\n
Subcommands:\n  list                                      list known vector collections\n  get <collection-key-or-name>              show embedding config for one collection\n  stats [<collection-key-or-name>]          show doc count for all or one collection\n  set <collection-key-or-name> <field> <value> set collection config (model|provider|adapter|enabled)\n  set <collection-key-or-name> [--model <name>] [--provider <name>] [--adapter <name>] [--enabled <true|false>]\n  reload                                    reload server vector config cache\n  test <collection-key-or-name>             probe adapter for one collection\n\nExamples:\n  arra-cli vector-config list\n  arra-cli vector-config get bge-m3\n  arra-cli vector-config stats bge-m3\n  arra-cli vector-config set bge-m3 model qwen3-embedding\n  arra-cli vector-config set bge-m3 enabled false\n  arra-cli vector-config set bge-m3 --adapter qdrant --provider remote\n  arra-cli vector-config reload\n\nOutput format: default JSON; pass --json or --yml for explicit format.`;

function usage(message: string): never {
  throw new Error(message);
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

function requireCollection(args: string[], command: string): string {
  const collection = args[0];
  if (!collection || collection.startsWith("-")) usage(`usage: arra-cli vector-config ${command} <collection-key-or-name>`);
  return collection as string;
}

function parseBoolean(value: string | undefined): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  usage('enabled must be true or false');
}

function parseSetPayload(args: string[]): UpdatePayload {
  const payload: UpdatePayload = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--json" || arg === "--yml") continue;
    if (arg === "--model") {
      const value = args[++i];
      if (!value) usage("usage: arra-cli vector-config set ... --model <name>");
      payload.model = value;
      continue;
    }
    if (arg === "--provider") {
      const value = args[++i];
      if (!value) usage("usage: arra-cli vector-config set ... --provider <name>");
      payload.provider = value;
      continue;
    }
    if (arg === "--adapter") {
      const value = args[++i];
      if (!value) usage("usage: arra-cli vector-config set ... --adapter <name>");
      payload.adapter = value;
      continue;
    }
    if (arg === "--enabled") {
      payload.enabled = parseBoolean(args[++i]);
      continue;
    }
    if (arg.startsWith("--")) usage(`unknown option: ${arg}`);

    const key = arg.toLowerCase();
    const value = args[i + 1];
    if (!value || value.startsWith("--") && value.length > 2) usage(`usage: arra-cli vector-config set ... ${arg} <value>`);
    if (key === "model") payload.model = value;
    else if (key === "provider") payload.provider = value;
    else if (key === "adapter") payload.adapter = value;
    else if (key === "enabled") payload.enabled = parseBoolean(value);
    else usage(`unknown field: ${arg}`);
    i++;
  }
  if (!payload.model && !payload.provider && !payload.adapter && payload.enabled === undefined) usage("usage: arra-cli vector-config set ... (model|provider|adapter|enabled)");
  return payload;
}

async function fetchPayload(): Promise<VectorPayload> {
  const response = await sessionFetch(ENDPOINT);
  if (!response.ok) throw new Error(`GET ${ENDPOINT} failed: HTTP ${response.status}`);
  return response.json() as Promise<VectorPayload>;
}

function resolveCollectionKey(payload: VectorPayload, collection: string): string | undefined {
  if (payload.config.collections[collection]) return collection;
  return Object.entries(payload.config.collections).find(([, c]) => c.collection === collection)?.[0];
}

function emitList(payload: VectorPayload, args: string[]) {
  const collections = Object.entries(payload.config.collections).map(([key, item]) => ({
    key,
    collection: item.collection,
    model: item.model,
    provider: item.provider,
    adapter: item.adapter,
    enabled: item.enabled !== false,
    primary: item.primary,
    source: payload.source,
  }));
  emit({ source: payload.source, count: collections.length, collections }, args);
}

function emitStats(payload: VectorPayload, requested: string | undefined, args: string[]) {
  const rows = Object.entries(payload.config.collections).map(([key, item]) => {
    const docs = payload.doc_counts?.[key] ?? 0;
    const health = payload.health?.[key];
    return {
      key,
      collection: item.collection,
      model: item.model,
      adapter: item.adapter,
      enabled: item.enabled !== false,
      docs,
      status: health?.status ?? (health?.ok === false ? "down" : "unknown"),
      provider: item.provider,
    };
  });

  if (!requested) {
    emit({ source: payload.source, collections: rows }, args);
    return;
  }

  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  emit({ source: payload.source, key, ...rows.find((item) => item.key === key) }, args);
}

function emitOne(payload: VectorPayload, requested: string, args: string[]) {
  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  emit({
    source: payload.source,
    key,
    config: payload.config.collections[key],
    count: payload.doc_counts?.[key] ?? 0,
    health: payload.health?.[key],
  }, args);
}

async function writeCollection(collection: string, payload: UpdatePayload, args: string[]): Promise<number> {
  const response = await sessionFetch(`${ENDPOINT}/${encodeURIComponent(collection)}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) usage(`PUT ${ENDPOINT}/${collection} failed: HTTP ${response.status}`);
  emit(await response.json(), args);
  return 0;
}

async function testCollection(payload: VectorPayload, requested: string, args: string[]): Promise<number> {
  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  const response = await sessionFetch(`${ENDPOINT}/${encodeURIComponent(key)}/test`, { method: "POST" });
  if (!response.ok) usage(`POST ${ENDPOINT}/{collection}/test failed: HTTP ${response.status}`);
  emit(await response.json(), args);
  return 0;
}

async function reloadConfig(args: string[]): Promise<number> {
  const response = await sessionFetch(`${ENDPOINT}/reload`, { method: "POST" });
  if (!response.ok) usage(`POST ${ENDPOINT}/reload failed: HTTP ${response.status}`);
  emit(await response.json(), args);
  return 0;
}

export async function vectorConfigCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args) || !args[0]) {
    console.log(HELP);
    return 0;
  }

  const [raw, ...restRaw] = args;
  const sub = raw.toLowerCase();
  const rest = restRaw.filter((arg) => arg !== "--help" && arg !== "-h");

  try {
    if (sub === "list") {
      emitList(await fetchPayload(), args);
      return 0;
    }
    if (sub === "stats") {
      emitStats(await fetchPayload(), rest[0], args);
      return 0;
    }
    if (sub === "get") {
      emitOne(await fetchPayload(), requireCollection(rest, "get"), args);
      return 0;
    }
    if (sub === "set") {
      const collection = requireCollection(rest, "set");
      return writeCollection(collection, parseSetPayload(rest.slice(1)), args);
    }
    if (sub === "reload") {
      if (rest.length) usage("usage: arra-cli vector-config reload");
      return reloadConfig(args);
    }
    if (sub === "test") {
      return testCollection(await fetchPayload(), requireCollection(rest, "test"), args);
    }
    console.error(`unknown vector-config subcommand: ${sub}`);
    console.error("try: arra-cli vector-config list|get|stats|set|reload|test");
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
