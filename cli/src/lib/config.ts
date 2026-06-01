import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

export const DEFAULT_ORACLE_API = "http://localhost:47778";

export type ArraConfig = {
  default?: string;
  targets?: Record<string, string>;
  disabledPlugins?: string[];
  enabledPlugins?: string[];
};
export type LoadedConfig = { path: string; config: ArraConfig };
export type OracleApiSource = "ORACLE_API" | "at" | "project" | "global" | "NEO_ARRA_API" | "default";

export interface ResolvedOracleApi {
  baseUrl: string;
  source: OracleApiSource;
  target?: string;
  path?: string;
}

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function parseAtFlag(argv = process.argv.slice(2)): string | undefined {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--at") return argv[i + 1];
    if (argv[i].startsWith("--at=")) return argv[i].slice(5);
  }
}

export function stripAtFlag(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--at") {
      i++;
      continue;
    }
    if (argv[i].startsWith("--at=")) continue;
    out.push(argv[i]);
  }
  return out;
}

function coercePluginList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const names = value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return names.length ? [...new Set(names)].sort() : undefined;
}

function coerceConfig(raw: any): ArraConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const srcTargets = raw.targets;
  const targets: Record<string, string> = {};
  if (srcTargets && typeof srcTargets === "object" && !Array.isArray(srcTargets)) {
    for (const [name, url] of Object.entries(srcTargets)) {
      if (typeof url === "string" && url.trim()) targets[name] = normalizeApiBase(url);
    }
  }
  const disabledPlugins = coercePluginList(raw.disabledPlugins);
  const enabledPlugins = coercePluginList(raw.enabledPlugins);
  if (Object.keys(targets).length === 0 && !disabledPlugins?.length && !enabledPlugins?.length) return null;
  return {
    default: typeof raw.default === "string" ? raw.default : undefined,
    ...(Object.keys(targets).length ? { targets } : {}),
    ...(disabledPlugins?.length ? { disabledPlugins } : {}),
    ...(enabledPlugins?.length ? { enabledPlugins } : {}),
  };
}

export function readArraConfig(path: string): LoadedConfig | null {
  if (!existsSync(path)) return null;
  try {
    const config = coerceConfig(JSON.parse(readFileSync(path, "utf8")));
    return config ? { path, config } : null;
  } catch {
    return null;
  }
}

function configPaths(dir: string): string[] {
  return [join(dir, "config.json"), join(dir, "targets.json")];
}

function firstConfig(paths: string[]): LoadedConfig | null {
  for (const path of paths) {
    const found = readArraConfig(path);
    if (found) return found;
  }
  return null;
}

export function loadProjectConfig(startDir = process.cwd()): LoadedConfig | null {
  let dir = startDir;
  const root = parse(dir).root;
  while (true) {
    const found = firstConfig(configPaths(join(dir, ".arra")));
    if (found || dir === root) return found;
    dir = dirname(dir);
  }
}

function globalConfigDir(env = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg ? join(xdg, "arra") : join(env.HOME ?? homedir(), ".config", "arra");
}

export function loadGlobalConfig(env = process.env): LoadedConfig | null {
  return firstConfig(configPaths(globalConfigDir(env)));
}

export function globalConfigPathForWrite(env = process.env): string {
  const dir = globalConfigDir(env);
  const configJson = join(dir, "config.json");
  const targetsJson = join(dir, "targets.json");
  if (existsSync(configJson)) return configJson;
  if (existsSync(targetsJson)) return targetsJson;
  return configJson;
}

function targetFrom(loaded: LoadedConfig | null, name: string | undefined, source: OracleApiSource) {
  if (!loaded || !name) return null;
  const baseUrl = loaded.config.targets?.[name];
  return baseUrl ? { baseUrl, source, target: name, path: loaded.path } : null;
}

function defaultFrom(loaded: LoadedConfig | null, source: "project" | "global") {
  return targetFrom(loaded, loaded?.config.default, source);
}

export function resolveOracleApi(argv = process.argv.slice(2), env = process.env): ResolvedOracleApi {
  if (env.ORACLE_API !== undefined) return { baseUrl: normalizeApiBase(env.ORACLE_API), source: "ORACLE_API" };

  const project = loadProjectConfig();
  const global = loadGlobalConfig(env);
  const atTarget = parseAtFlag(argv);
  const at = targetFrom(project, atTarget, "at") ?? targetFrom(global, atTarget, "at");
  if (at) return at;
  if (atTarget) throw new Error(`Unknown arra target '${atTarget}' in project/global config`);

  const projectDefault = defaultFrom(project, "project");
  if (projectDefault) return projectDefault;
  const globalDefault = defaultFrom(global, "global");
  if (globalDefault) return globalDefault;
  if (env.NEO_ARRA_API !== undefined) return { baseUrl: normalizeApiBase(env.NEO_ARRA_API), source: "NEO_ARRA_API" };
  return { baseUrl: DEFAULT_ORACLE_API, source: "default" };
}

function sortedUnique(values: string[] | undefined): string[] | undefined {
  const unique = [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))].sort();
  return unique.length ? unique : undefined;
}

function cleanConfig(config: ArraConfig): ArraConfig {
  const targets = Object.fromEntries(Object.entries(config.targets ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const disabledPlugins = sortedUnique(config.disabledPlugins);
  const enabledPlugins = sortedUnique(config.enabledPlugins);
  return {
    ...(config.default ? { default: config.default } : {}),
    ...(Object.keys(targets).length ? { targets } : {}),
    ...(disabledPlugins ? { disabledPlugins } : {}),
    ...(enabledPlugins ? { enabledPlugins } : {}),
  };
}

export function writeArraConfig(path: string, config: ArraConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cleanConfig(config), null, 2) + "\n");
}

function writableGlobal(env = process.env): LoadedConfig {
  const path = globalConfigPathForWrite(env);
  return readArraConfig(path) ?? { path, config: { targets: {} } };
}

export function addGlobalTarget(name: string, url: string, env = process.env): LoadedConfig {
  const loaded = writableGlobal(env);
  const targets = { ...(loaded.config.targets ?? {}), [name]: normalizeApiBase(url) };
  const config = { ...loaded.config, default: loaded.config.default ?? name, targets };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config };
}

export function useGlobalTarget(name: string, env = process.env): LoadedConfig {
  const loaded = writableGlobal(env);
  if (!loaded.config.targets?.[name]) throw new Error(`No global arra target named '${name}'. Add it first with: arra-cli config add ${name} <url>`);
  const config = { ...loaded.config, default: name };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config };
}

function assertPluginName(name: string): void {
  if (!/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(name)}`);
  }
}

export function disableGlobalPlugin(name: string, env = process.env): LoadedConfig {
  assertPluginName(name);
  const loaded = writableGlobal(env);
  const disabledPlugins = sortedUnique([...(loaded.config.disabledPlugins ?? []), name]);
  const enabledPlugins = sortedUnique((loaded.config.enabledPlugins ?? []).filter((entry) => entry !== name));
  const config = { ...loaded.config, disabledPlugins, enabledPlugins };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}

export function enableGlobalPlugin(name: string, env = process.env): LoadedConfig {
  assertPluginName(name);
  const loaded = writableGlobal(env);
  const disabledPlugins = sortedUnique((loaded.config.disabledPlugins ?? []).filter((entry) => entry !== name));
  const enabledPlugins = sortedUnique([...(loaded.config.enabledPlugins ?? []), name]);
  const config = { ...loaded.config, disabledPlugins, enabledPlugins };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}
