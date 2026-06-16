import { vectorConfigCli } from "./vector-config-cli.ts";
import { vectorHealthCli } from "./vector-health-cli.ts";

type ArraPluginConfig = {
  dbBackend?: "sqlite" | "http" | "memory" | "custom";
  embedderBackend?: "none" | "local" | "remote";
  remoteEmbedderUrl?: string;
};

type ArraPluginContext = {
  source: "api" | "mcp" | "cli" | "server" | "init" | "destroy";
  plugin: string;
  args?: unknown[];
  request?: Request;
  config?: ArraPluginConfig;
};

type ArraVerb = {
  name: string;
  help: string;
  menuPath: string;
  httpPath: string;
  requiresEmbedder: boolean;
  storage: "swappable";
};

type CliResult = { ok: boolean; output?: string; error?: string };

const VERSION = "1.0.0";
const MENU_PATH = "/plugins/arra";
const HTTP_PATH = "/api/plugins/arra";
const DB_BACKENDS = ["sqlite", "http", "memory", "custom"] as const;
const EMBEDDER_BACKENDS = ["none", "local", "remote"] as const;
const DEFAULT_CONFIG: Required<ArraPluginConfig> = {
  dbBackend: "sqlite",
  embedderBackend: "none",
  remoteEmbedderUrl: "",
};

const VERBS: ArraVerb[] = [
  { name: "help", help: "Show ARRA plugin commands", menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: "swappable" },
  { name: "version", help: "Print ARRA plugin version", menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: "swappable" },
  { name: "menu", help: "Describe the ARRA menu surface", menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: "swappable" },
  { name: "status", help: "Describe optional backend capabilities", menuPath: MENU_PATH, httpPath: HTTP_PATH, requiresEmbedder: false, storage: "swappable" },
  { name: "health", help: "Show server and vector engine health", menuPath: MENU_PATH, httpPath: "/api/health", requiresEmbedder: false, storage: "swappable" },
  { name: "vector-config", help: "Inspect and manage vector backend config", menuPath: MENU_PATH, httpPath: "/api/v1/vector/config", requiresEmbedder: false, storage: "swappable" },
];

function commandName(ctx: ArraPluginContext): string {
  const arg = ctx.args?.[0];
  return typeof arg === "string" && arg.trim() ? arg.trim().toLowerCase() : "help";
}

function configFrom(ctx: ArraPluginContext): Required<ArraPluginConfig> {
  return { ...DEFAULT_CONFIG, ...(ctx.config ?? {}) };
}

function pluginBody(ctx: ArraPluginContext) {
  const config = configFrom(ctx);
  return {
    plugin: ctx.plugin || "arra",
    version: VERSION,
    surface: ctx.source,
    menuPath: MENU_PATH,
    httpPath: HTTP_PATH,
    cliCommand: "arra",
    embedderRequired: false,
    storageBackend: config.dbBackend,
    embedderBackend: config.embedderBackend,
    remoteEmbedderConfigured: Boolean(config.remoteEmbedderUrl),
    backends: {
      db: { selected: config.dbBackend, swappable: true, supported: DB_BACKENDS },
      embedder: { selected: config.embedderBackend, optional: true, supported: EMBEDDER_BACKENDS },
    },
    verbs: VERBS,
  };
}

async function renderCli(ctx: ArraPluginContext): Promise<CliResult> {
  const command = commandName(ctx);
  if (command === "version") return { ok: true, output: `arra ${VERSION}` };
  if (command === "menu") return { ok: true, output: `arra menu: ${MENU_PATH}` };
  if (command === "status") {
    const config = configFrom(ctx);
    return { ok: true, output: `arra status: ok (db=${config.dbBackend}, embedder=${config.embedderBackend}, storage swappable)` };
  }
  if (command === "health") return vectorHealthCli((ctx.args ?? []).slice(1).map(String));
  if (command === "vector-config") return vectorConfigCli((ctx.args ?? []).slice(1).map(String));
  if (command !== "help") return { ok: false, error: `unknown arra command: ${command}` };
  return { ok: true, output: ["maw arra <command>", ...VERBS.map((verb) => `  ${verb.name.padEnd(14)} ${verb.help}`)].join("\n") };
}

export function arraHttpRoute(ctx: ArraPluginContext) {
  return { ok: true, body: pluginBody(ctx) };
}

export async function arraCli(ctx: ArraPluginContext) {
  return renderCli(ctx);
}

export default function handler(ctx: ArraPluginContext) {
  return ctx.source === "cli" ? arraCli(ctx) : arraHttpRoute(ctx);
}
