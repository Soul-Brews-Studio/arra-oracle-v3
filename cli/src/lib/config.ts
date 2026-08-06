import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse } from "node:path";

export const DEFAULT_ORACLE_API = "http://localhost:47778";

export interface ArraConfig {
  default?: string;
  targets?: Record<string, string>;
  disabledPlugins?: string[];
  enabledPlugins?: string[];
}
export interface ConfigSource { kind: "project" | "global"; path: string; config: ArraConfig }
export type LoadedConfig = { path: string; config: ArraConfig };
export type ResolvedSource = "ORACLE_API" | "--at" | "project" | "global" | "NEO_ARRA_API" | "default";
export interface ResolvedApiBase { url: string; source: ResolvedSource; target?: string; path?: string }
export type OracleApiSource = "ORACLE_API" | "at" | "project" | "global" | "default";
export interface ResolvedOracleApi { baseUrl: string; source: OracleApiSource; target?: string; path?: string }

export function normalizeApiBase(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function unique(values: unknown): string[] | undefined {
  if (!Array.isArray(values)) return undefined;
  const names = values.filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim()).filter(Boolean);
  return names.length ? [...new Set(names)].sort() : undefined;
}

function coerceConfig(raw: unknown): ArraConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const targets: Record<string, string> = {};
  if (source.targets && typeof source.targets === "object" && !Array.isArray(source.targets)) {
    for (const [name, url] of Object.entries(source.targets)) {
      if (typeof url === "string" && url.trim()) targets[name] = normalizeApiBase(url);
    }
  }
  const disabledPlugins = unique(source.disabledPlugins);
  const enabledPlugins = unique(source.enabledPlugins);
  if (!Object.keys(targets).length && !disabledPlugins?.length && !enabledPlugins?.length) return null;
  return {
    default: typeof source.default === "string" ? source.default : undefined,
    ...(Object.keys(targets).length ? { targets } : {}),
    ...(disabledPlugins ? { disabledPlugins } : {}),
    ...(enabledPlugins ? { enabledPlugins } : {}),
  };
}

function readConfig(path: string, strict = true): ArraConfig | null {
  if (!existsSync(path)) return null;
  try {
    return coerceConfig(JSON.parse(readFileSync(path, "utf8")));
  } catch (err) {
    if (!strict) return null;
    throw new Error(`Failed to read ARRA config at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function readArraConfig(path: string): LoadedConfig | null {
  const config = readConfig(path, false);
  return config ? { path, config } : null;
}

function configPaths(dir: string): string[] {
  return [join(dir, "config.json"), join(dir, "targets.json")];
}

function firstConfig(paths: string[], strict = true): LoadedConfig | null {
  for (const path of paths) {
    const config = readConfig(path, strict);
    if (config) return { path, config };
  }
  return null;
}

function globalConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  return xdg ? join(xdg, "arra") : join(env.HOME || homedir(), ".config", "arra");
}

export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(globalConfigDir(env), "config.json");
}

export function globalConfigPathForWrite(env: NodeJS.ProcessEnv = process.env): string {
  const dir = globalConfigDir(env);
  const configJson = join(dir, "config.json");
  const targetsJson = join(dir, "targets.json");
  if (existsSync(configJson)) return configJson;
  if (existsSync(targetsJson)) return targetsJson;
  return configJson;
}

export function findProjectConfigPath(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  const root = parse(dir).root;
  while (true) {
    for (const candidate of configPaths(join(dir, ".arra"))) if (existsSync(candidate)) return candidate;
    if (dir === root) return null;
    dir = dirname(dir);
  }
}

export function loadProjectConfig(startDir = process.cwd(), strict = true): LoadedConfig | null {
  let dir = startDir;
  const root = parse(dir).root;
  while (true) {
    const found = firstConfig(configPaths(join(dir, ".arra")), strict);
    if (found || dir === root) return found;
    dir = dirname(dir);
  }
}

export function loadGlobalConfig(env: NodeJS.ProcessEnv = process.env, strict = true): LoadedConfig | null {
  return firstConfig(configPaths(globalConfigDir(env)), strict);
}

export function loadConfigSources(options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): ConfigSource[] {
  const env = options.env ?? process.env;
  const sources: ConfigSource[] = [];
  const global = loadGlobalConfig(env);
  if (global) sources.push({ kind: "global", ...global });
  const project = loadProjectConfig(options.cwd ?? process.cwd());
  if (project) sources.push({ kind: "project", ...project });
  return sources;
}

export function mergedTargets(sources: ConfigSource[]): Record<string, string> {
  return Object.assign({}, ...sources.map((source) => source.config.targets ?? {}));
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
    if (argv[i] === "--at") { i++; continue; }
    if (argv[i].startsWith("--at=")) continue;
    out.push(argv[i]);
  }
  return out;
}

function targetUrl(targets: Record<string, string>, name: string | undefined): string | undefined {
  const value = name ? targets[name] : undefined;
  return typeof value === "string" && value.trim() ? normalizeApiBase(value) : undefined;
}

export function resolveOracleApiBase(options: { at?: string; cwd?: string; env?: NodeJS.ProcessEnv } = {}): ResolvedApiBase {
  const env = options.env ?? process.env;
  if (env.ORACLE_API?.trim()) return { url: normalizeApiBase(env.ORACLE_API), source: "ORACLE_API" };
  const sources = loadConfigSources({ cwd: options.cwd, env });
  const targets = mergedTargets(sources);
  const at = options.at ?? env.ARRA_AT ?? parseAtFlag();
  if (at?.trim()) {
    const url = targetUrl(targets, at);
    if (!url) throw new Error(`Unknown ARRA target '${at}'. Add it to .arra/config.json or ${globalConfigPathForWrite(env)}.`);
    return { url, source: "--at", target: at };
  }
  const project = [...sources].reverse().find((source) => source.kind === "project");
  const projectUrl = targetUrl(targets, project?.config.default);
  if (projectUrl) return { url: projectUrl, source: "project", target: project!.config.default, path: project!.path };
  const global = sources.find((source) => source.kind === "global");
  const globalUrl = targetUrl(targets, global?.config.default);
  if (globalUrl) return { url: globalUrl, source: "global", target: global!.config.default, path: global!.path };
  if (env.NEO_ARRA_API?.trim()) return { url: normalizeApiBase(env.NEO_ARRA_API), source: "NEO_ARRA_API" };
  return { url: DEFAULT_ORACLE_API, source: "default" };
}

export function resolveOracleApi(argv = process.argv.slice(2), env = process.env): ResolvedOracleApi {
  const resolved = resolveOracleApiBase({ at: parseAtFlag(argv), env });
  return { baseUrl: resolved.url, source: resolved.source === "--at" ? "at" : resolved.source === "NEO_ARRA_API" ? "default" : resolved.source, target: resolved.target, path: resolved.path };
}

export function oracleApiBase(): string {
  return resolveOracleApiBase().url;
}

function cleanConfig(config: ArraConfig): ArraConfig {
  const targets = Object.fromEntries(Object.entries(config.targets ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  return {
    ...(config.default ? { default: config.default } : {}),
    ...(Object.keys(targets).length ? { targets } : {}),
    ...(unique(config.disabledPlugins) ? { disabledPlugins: unique(config.disabledPlugins) } : {}),
    ...(unique(config.enabledPlugins) ? { enabledPlugins: unique(config.enabledPlugins) } : {}),
  };
}

export function writeArraConfig(path: string, config: ArraConfig): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(cleanConfig(config), null, 2) + "\n");
}

function writableGlobal(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const path = globalConfigPathForWrite(env);
  return readArraConfig(path) ?? { path, config: {} };
}

export function addGlobalTarget(name: string, url: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const loaded = writableGlobal(env);
  const config = { ...loaded.config, default: loaded.config.default ?? name, targets: { ...(loaded.config.targets ?? {}), [name]: normalizeApiBase(url) } };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}

export function useGlobalTarget(name: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const loaded = writableGlobal(env);
  if (!loaded.config.targets?.[name]) throw new Error(`No global arra target named '${name}'. Add it first with: arra-cli config add ${name} <url>`);
  const config = { ...loaded.config, default: name };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}

export function writeGlobalDefault(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return useGlobalTarget(name, env).path;
}

function assertPluginName(name: string): void {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`plugin name must match /^[a-z0-9-]+$/, got: ${JSON.stringify(name)}`);
}

export function disableGlobalPlugin(name: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  assertPluginName(name);
  const loaded = writableGlobal(env);
  const config = { ...loaded.config, disabledPlugins: unique([...(loaded.config.disabledPlugins ?? []), name]), enabledPlugins: unique((loaded.config.enabledPlugins ?? []).filter((entry) => entry !== name)) };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}

export function enableGlobalPlugin(name: string, env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  assertPluginName(name);
  const loaded = writableGlobal(env);
  const config = { ...loaded.config, disabledPlugins: unique((loaded.config.disabledPlugins ?? []).filter((entry) => entry !== name)), enabledPlugins: unique([...(loaded.config.enabledPlugins ?? []), name]) };
  writeArraConfig(loaded.path, config);
  return { path: loaded.path, config: cleanConfig(config) };
}
