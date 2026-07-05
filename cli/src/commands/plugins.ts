import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { TOOL_PLUGINS, type PluginManifestEntry, type PluginTier } from "../../../src/config/tool-groups.ts";

export interface PluginListEntry {
  name: string;
  tier: PluginTier;
  weight: number;
  enabled: boolean;
}

export interface PluginManifestFile {
  plugins: PluginManifestEntry[];
  disabled_tools?: string[];
  enabled_tools?: string[];
}

export interface PluginManifestState {
  path: string;
  source: "repo" | "global" | "default";
  exists: boolean;
  manifest: PluginManifestFile;
}

function repoRoot(): string {
  return process.env.ORACLE_REPO_ROOT || process.cwd();
}

function repoManifestPath(): string {
  return join(repoRoot(), "plugins.json");
}

function oracleDataDir(): string {
  return process.env.ORACLE_DATA_DIR || join(process.env.HOME || homedir(), ".arra-oracle-v2");
}

function globalManifestPath(): string {
  return join(oracleDataDir(), "plugins.json");
}

function defaultManifest(): PluginManifestFile {
  return {
    plugins: Object.values(TOOL_PLUGINS)
      .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name))
      .map((p) => ({ name: p.name, tier: p.tier, weight: p.weight, enabled: true })),
  };
}

function normalizeManifest(raw: unknown): PluginManifestFile {
  const obj = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const plugins = Array.isArray(obj.plugins)
    ? obj.plugins
        .filter((p): p is Record<string, unknown> => !!p && typeof p === "object" && typeof p.name === "string")
        .map((p): PluginManifestEntry => ({
          name: String(p.name),
          ...(typeof p.enabled === "boolean" && { enabled: p.enabled }),
          ...((p.tier === "core" || p.tier === "standard" || p.tier === "extra") && { tier: p.tier }),
          ...(typeof p.weight === "number" && { weight: p.weight }),
        }))
    : [];
  const manifest: PluginManifestFile = { plugins };
  if (Array.isArray(obj.disabled_tools)) manifest.disabled_tools = obj.disabled_tools.filter((t): t is string => typeof t === "string");
  if (Array.isArray(obj.enabled_tools)) manifest.enabled_tools = obj.enabled_tools.filter((t): t is string => typeof t === "string");
  return manifest;
}

function readManifest(path: string): PluginManifestFile {
  return normalizeManifest(JSON.parse(readFileSync(path, "utf8")));
}

export function loadPluginManifestState(): PluginManifestState {
  const local = repoManifestPath();
  if (existsSync(local)) return { path: local, source: "repo", exists: true, manifest: readManifest(local) };
  const global = globalManifestPath();
  if (existsSync(global)) return { path: global, source: "global", exists: true, manifest: readManifest(global) };
  return { path: local, source: "default", exists: false, manifest: defaultManifest() };
}

export function listPlugins(): { source: PluginManifestState["source"]; path: string; plugins: PluginListEntry[] } {
  const state = loadPluginManifestState();
  const byName = new Map(state.manifest.plugins.map((entry) => [entry.name, entry]));
  const names = new Set([...Object.keys(TOOL_PLUGINS), ...byName.keys()]);
  const plugins = [...names].map((name): PluginListEntry | null => {
    const base = TOOL_PLUGINS[name];
    const entry = byName.get(name);
    if (!base && !entry) return null;
    return {
      name,
      tier: entry?.tier ?? base?.tier ?? "extra",
      weight: entry?.weight ?? base?.weight ?? 999,
      enabled: entry?.enabled !== false,
    };
  }).filter((p): p is PluginListEntry => !!p)
    .sort((a, b) => a.weight - b.weight || a.name.localeCompare(b.name));
  return { source: state.source, path: state.path, plugins };
}

function writableManifestState(): PluginManifestState {
  const state = loadPluginManifestState();
  if (state.exists) return state;
  return { ...state, source: "repo", path: repoManifestPath(), manifest: defaultManifest() };
}

export function setPluginEnabled(name: string, enabled: boolean): PluginListEntry {
  const base = TOOL_PLUGINS[name];
  if (!base) throw new Error(`Unknown plugin '${name}'. Try: arra plugins list`);

  const state = writableManifestState();
  const manifest = state.manifest;
  const idx = manifest.plugins.findIndex((p) => p.name === name);
  if (idx >= 0) {
    manifest.plugins[idx] = { ...manifest.plugins[idx], enabled };
  } else {
    manifest.plugins.push({ name, tier: base.tier, weight: base.weight, enabled });
  }
  mkdirSync(dirname(state.path), { recursive: true });
  writeFileSync(state.path, JSON.stringify(manifest, null, 2) + "\n");
  const entry = manifest.plugins.find((p) => p.name === name)!;
  return {
    name,
    tier: entry.tier ?? base.tier,
    weight: entry.weight ?? base.weight,
    enabled: entry.enabled !== false,
  };
}

function printText(data: ReturnType<typeof listPlugins>): void {
  console.log(`ARRA plugins (${data.source}: ${data.path})\n`);
  for (const p of data.plugins) {
    const status = p.enabled ? "enabled " : "disabled";
    console.log(`${status}  ${p.name.padEnd(12)} tier=${p.tier.padEnd(8)} weight=${p.weight}`);
  }
}

export async function pluginsCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const filtered = args.filter((a) => a !== "--json");
  const sub = filtered[0]?.toLowerCase() ?? "list";

  if (sub === "list" || sub === "ls") {
    const data = listPlugins();
    if (json) console.log(JSON.stringify(data, null, 2));
    else printText(data);
    return 0;
  }

  if (sub === "enable" || sub === "disable") {
    const name = filtered[1];
    if (!name) {
      console.error(`usage: arra plugins ${sub} <name>`);
      return 1;
    }
    try {
      const plugin = setPluginEnabled(name, sub === "enable");
      const data = { path: loadPluginManifestState().path, plugin };
      if (json) console.log(JSON.stringify(data, null, 2));
      else console.log(`${plugin.enabled ? "enabled" : "disabled"} ${plugin.name} (${data.path})`);
      return 0;
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  console.error(`unknown plugins subcommand: ${filtered[0]}`);
  console.error("try: arra plugins [list|enable <name>|disable <name>] [--json]");
  return 1;
}
