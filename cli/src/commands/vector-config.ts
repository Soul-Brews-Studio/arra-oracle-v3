import { emit } from "./_output.ts";
import { sessionFetch } from "./session-api.ts";

const ENDPOINT = "/api/v1/vector/config";

type CollectionEntry = {
  collection: string;
  model: string;
  provider: string;
  adapter?: string;
  enabled?: boolean;
  service?: string;
  endpoint?: string;
  primary?: boolean;
};
type VectorPayload = {
  source: "file" | "defaults";
  config: { collections: Record<string, CollectionEntry> };
  doc_counts?: Record<string, number>;
  health?: Record<string, { ok: boolean; status: string; collection: string; adapter?: string; model?: string }>;
};
type UpdatePayload = Partial<CollectionEntry>;

const HELP = `arra-cli vector-config <subcommand>\n
Subcommands:\n  list                                      list known vector collections\n  get <collection-key-or-name>              show config for one collection\n  stats [<collection-key-or-name>]          show doc count for collections\n  set <collection> <field> <value>          set model|provider|adapter|enabled|service|endpoint\n  set <collection> [--model <name>] [--provider <name>] [--adapter <name>] [--enabled <true|false>]\n  add <name> --model <name> [--collection <name>] [--adapter <name>] [--primary]\n  remove <collection> [--yes]               remove a collection config\n  set-primary <collection>                  mark collection as primary\n  reload                                    reload server vector config cache\n  test <collection-key-or-name>             probe adapter for one collection\n
Examples:\n  arra-cli vector-config list\n  arra-cli vector-config add qwen4 --model qwen4-embedding --adapter lancedb\n  arra-cli vector-config set bge-m3 enabled false\n  arra-cli vector-config set bge-m3 --adapter qdrant --provider remote\n  arra-cli vector-config set-primary bge-m3\n\nOutput format: default JSON; pass --json or --yml for explicit format.`;

function usage(message: string): never { throw new Error(message); }
function hasHelpFlag(args: string[]): boolean { return args.includes("--help") || args.includes("-h"); }
function cleanArgs(args: string[]): string[] { return args.filter((a) => !["--json", "--yml", "--yaml"].includes(a)); }
function requireCollection(args: string[], command: string): string {
  const collection = args[0];
  if (!collection || collection.startsWith("-")) usage(`usage: arra-cli vector-config ${command} <collection>`);
  return collection;
}
function parseBoolean(value: string | undefined): boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  usage("enabled must be true or false");
}
function assignPayload(payload: UpdatePayload, field: string, value: string): void {
  if (field === "enabled") payload.enabled = parseBoolean(value);
  else (payload as Record<string, string>)[field] = value;
}

function parseFlagPayload(args: string[], allowPrimary = false): UpdatePayload {
  const payload: UpdatePayload = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--json", "--yml", "--yaml", "--yes"].includes(arg)) continue;
    if (allowPrimary && arg === "--primary") { payload.primary = true; continue; }
    if (!arg.startsWith("--")) usage(`unknown field: ${arg}`);
    const field = arg.slice(2).replace(/^url$/, "endpoint");
    if (!["collection", "model", "provider", "adapter", "enabled", "service", "endpoint"].includes(field)) usage(`unknown option: ${arg}`);
    const value = args[++i];
    if (!value || value.startsWith("--")) usage(`usage: ${arg} <value>`);
    assignPayload(payload, field, value);
  }
  return payload;
}

function parseSetPayload(args: string[]): UpdatePayload {
  const clean = cleanArgs(args);
  const payload: UpdatePayload = {};
  if (clean[0]?.startsWith("--")) return parseFlagPayload(clean);
  if (clean.some((arg) => arg.startsWith("--"))) return parseFlagPayload(clean);
  for (let i = 0; i < clean.length; i += 2) {
    const field = clean[i];
    const value = clean[i + 1];
    if (!value) usage(`usage: arra-cli vector-config set ... ${field} <value>`);
    if (!["model", "provider", "adapter", "enabled", "service", "endpoint"].includes(field)) usage(`unknown field: ${field}`);
    assignPayload(payload, field, value);
  }
  if (!Object.keys(payload).length) usage("usage: arra-cli vector-config set ... (model|provider|adapter|enabled)");
  return payload;
}

function parseAddPayload(args: string[]): UpdatePayload {
  const payload = parseFlagPayload(args, true);
  if (!payload.model) usage("usage: arra-cli vector-config add <name> --model <name>");
  return payload;
}

async function parseError(response: Response): Promise<string> {
  const text = await response.text();
  try { return JSON.parse(text).error ?? text; } catch { return text || response.statusText; }
}
async function fetchPayload(): Promise<VectorPayload> {
  const response = await sessionFetch(ENDPOINT);
  if (!response.ok) throw new Error(`GET ${ENDPOINT} failed: HTTP ${response.status} ${await parseError(response)}`);
  return response.json() as Promise<VectorPayload>;
}
function resolveCollectionKey(payload: VectorPayload, collection: string): string | undefined {
  if (payload.config.collections[collection]) return collection;
  return Object.entries(payload.config.collections).find(([, c]) => c.collection === collection)?.[0];
}
function rows(payload: VectorPayload) {
  return Object.entries(payload.config.collections).map(([key, item]) => ({
    key, collection: item.collection, model: item.model, provider: item.provider,
    adapter: item.adapter, enabled: item.enabled !== false, primary: item.primary,
    docs: payload.doc_counts?.[key] ?? 0,
    status: payload.health?.[key]?.status ?? "unknown",
    source: payload.source,
  }));
}
function emitList(payload: VectorPayload, args: string[]) {
  const collections = rows(payload);
  emit({ source: payload.source, count: collections.length, collections }, args);
}
function emitStats(payload: VectorPayload, requested: string | undefined, args: string[]) {
  if (!requested) return emit({ source: payload.source, collections: rows(payload) }, args);
  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  emit({ source: payload.source, ...rows(payload).find((item) => item.key === key) }, args);
}
function emitOne(payload: VectorPayload, requested: string, args: string[]) {
  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  emit({ source: payload.source, key, config: payload.config.collections[key], count: payload.doc_counts?.[key] ?? 0, health: payload.health?.[key] }, args);
}
async function request(path: string, method: string, args: string[], body?: unknown): Promise<number> {
  const response = await sessionFetch(path, {
    method,
    ...(body && { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) usage(`${method} ${path} failed: HTTP ${response.status} ${await parseError(response)}`);
  emit(await response.json(), args);
  return 0;
}
async function testCollection(payload: VectorPayload, requested: string, args: string[]): Promise<number> {
  const key = resolveCollectionKey(payload, requested);
  if (!key) usage(`unknown collection: ${requested}`);
  return request(`${ENDPOINT}/${encodeURIComponent(key)}/test`, "POST", args);
}
async function confirmRemove(args: string[], collection: string): Promise<void> {
  if (args.includes("--yes") || args.includes("-y")) return;
  if (!process.stdin.isTTY) usage("remove requires --yes in non-interactive mode");
  const answer = prompt(`Remove vector collection '${collection}'? Type 'yes' to continue:`) ?? "";
  if (answer.trim().toLowerCase() !== "yes") usage("remove cancelled");
}

export async function vectorConfigCommand(args: string[]): Promise<number> {
  if (hasHelpFlag(args)) { console.log(HELP); return 0; }
  const [raw = "list", ...restRaw] = args;
  const sub = raw.toLowerCase();
  const rest = restRaw.filter((arg) => arg !== "--help" && arg !== "-h");
  try {
    if (sub === "list") { emitList(await fetchPayload(), args); return 0; }
    if (sub === "stats") { emitStats(await fetchPayload(), rest[0], args); return 0; }
    if (sub === "get") { emitOne(await fetchPayload(), requireCollection(rest, "get"), args); return 0; }
    if (sub === "set") return request(`${ENDPOINT}/${encodeURIComponent(requireCollection(rest, "set"))}`, "PUT", args, parseSetPayload(rest.slice(1)));
    if (sub === "add") return request(`${ENDPOINT}/${encodeURIComponent(requireCollection(rest, "add"))}`, "POST", args, parseAddPayload(rest.slice(1)));
    if (sub === "remove" || sub === "rm") {
      const collection = requireCollection(rest, "remove");
      await confirmRemove(args, collection);
      return request(`${ENDPOINT}/${encodeURIComponent(collection)}`, "DELETE", args);
    }
    if (sub === "set-primary" || sub === "primary") return request(`${ENDPOINT}/${encodeURIComponent(requireCollection(rest, "set-primary"))}/primary`, "POST", args);
    if (sub === "reload") { if (rest.length) usage("usage: arra-cli vector-config reload"); return request(`${ENDPOINT}/reload`, "POST", args); }
    if (sub === "test") return testCollection(await fetchPayload(), requireCollection(rest, "test"), args);
    console.error(`unknown vector-config subcommand: ${sub}`);
    console.error("try: arra-cli vector-config list|get|stats|set|add|remove|set-primary|reload|test");
    return 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
