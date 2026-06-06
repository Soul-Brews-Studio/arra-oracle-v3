import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join, parse } from "path";
import { homedir } from "os";

export interface ArraConfig {
  default?: string;
  targets?: Record<string, string>;
}

export interface ConfigSource {
  kind: "project" | "global";
  path: string;
  config: ArraConfig;
}

export interface ResolvedApiBase {
  url: string;
  source: "ORACLE_API" | "--at" | "project" | "global" | "NEO_ARRA_API" | "default";
  target?: string;
  path?: string;
}

const DEFAULT_API_BASE = "http://localhost:47778";

function cleanUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function readConfig(path: string): ArraConfig | null {
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as ArraConfig;
    return {
      default: typeof parsed.default === "string" ? parsed.default : undefined,
      targets: parsed.targets && typeof parsed.targets === "object" ? parsed.targets : undefined,
    };
  } catch (err) {
    throw new Error(`Failed to read ARRA config at ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function globalConfigPath(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME && env.XDG_CONFIG_HOME.trim()
    ? env.XDG_CONFIG_HOME
    : join(env.HOME || homedir(), ".config");
  return join(base, "arra", "config.json");
}

export function findProjectConfigPath(cwd: string = process.cwd()): string | null {
  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".arra", "config.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir || dir === parse(dir).root) return null;
    dir = parent;
  }
}

export function loadConfigSources(options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ConfigSource[] {
  const env = options.env ?? process.env;
  const sources: ConfigSource[] = [];
  const globalPath = globalConfigPath(env);
  const globalConfig = readConfig(globalPath);
  if (globalConfig) sources.push({ kind: "global", path: globalPath, config: globalConfig });

  const projectPath = findProjectConfigPath(options.cwd ?? process.cwd());
  if (projectPath) {
    const projectConfig = readConfig(projectPath);
    if (projectConfig) sources.push({ kind: "project", path: projectPath, config: projectConfig });
  }
  return sources;
}

export function mergedTargets(sources: ConfigSource[]): Record<string, string> {
  const targets: Record<string, string> = {};
  for (const source of sources) Object.assign(targets, source.config.targets ?? {});
  return targets;
}

function targetUrl(targets: Record<string, string>, name: string): string | undefined {
  const value = targets[name];
  return typeof value === "string" && value.trim() ? cleanUrl(value) : undefined;
}

export function resolveOracleApiBase(options: {
  at?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
} = {}): ResolvedApiBase {
  const env = options.env ?? process.env;
  if (env.ORACLE_API?.trim()) return { url: cleanUrl(env.ORACLE_API), source: "ORACLE_API" };

  const sources = loadConfigSources({ cwd: options.cwd, env });
  const targets = mergedTargets(sources);
  const at = options.at ?? env.ARRA_AT;
  if (at?.trim()) {
    const url = targetUrl(targets, at);
    if (!url) throw new Error(`Unknown ARRA target '${at}'. Add it to .arra/config.json or ${globalConfigPath(env)}.`);
    return { url, source: "--at", target: at };
  }

  const project = [...sources].reverse().find(s => s.kind === "project");
  if (project?.config.default) {
    const url = targetUrl(targets, project.config.default);
    if (!url) throw new Error(`Project ARRA config default '${project.config.default}' has no matching target in ${project.path}.`);
    return { url, source: "project", target: project.config.default, path: project.path };
  }

  const global = sources.find(s => s.kind === "global");
  if (global?.config.default) {
    const url = targetUrl(targets, global.config.default);
    if (!url) throw new Error(`Global ARRA config default '${global.config.default}' has no matching target in ${global.path}.`);
    return { url, source: "global", target: global.config.default, path: global.path };
  }

  if (env.NEO_ARRA_API?.trim()) return { url: cleanUrl(env.NEO_ARRA_API), source: "NEO_ARRA_API" };
  return { url: DEFAULT_API_BASE, source: "default" };
}

export function oracleApiBase(): string {
  return resolveOracleApiBase().url;
}

export function writeGlobalDefault(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const path = globalConfigPath(env);
  const existing = readConfig(path) ?? { targets: {} };
  const targets = existing.targets ?? {};
  if (!targets[name]) throw new Error(`Unknown global ARRA target '${name}' in ${path}. Add it before selecting it.`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ ...existing, targets, default: name }, null, 2) + "\n");
  return path;
}
