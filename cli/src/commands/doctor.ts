import { existsSync } from "fs";
import { resolve } from "path";
import { globalConfigPath, findProjectConfigPath, loadConfigSources, resolveOracleApiBase, type ResolvedApiBase } from "../lib/config.ts";
import type { HealthStatusEnum, HealthSubsystem } from "../../../src/routes/health/subsystems.ts";

export type DoctorStatus = "pass" | "fail" | "warn";
export type McpProbe = (input: { env: NodeJS.ProcessEnv; cwd: string; resolved: ResolvedApiBase }) => Promise<{ toolCount: number; detail?: string }>;

export interface DoctorCheck {
  id: string;
  label: string;
  status: DoctorStatus;
  critical: boolean;
  detail?: string;
  data?: unknown;
}

export interface DoctorReport {
  ok: boolean;
  resolved: ResolvedApiBase;
  checks: DoctorCheck[];
}

type DoctorOptions = { env?: NodeJS.ProcessEnv; cwd?: string; fetcher?: typeof fetch; mcpProbe?: McpProbe; timeoutMs?: number };
type HealthPayload = { healthStatus?: HealthStatusEnum; state?: HealthStatusEnum; status?: string; subsystems?: Record<string, HealthSubsystem> };

function ok(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "pass", critical: true, detail, data };
}

function fail(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "fail", critical: true, detail, data };
}

function warn(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "warn", critical: false, detail, data };
}

async function fetchJson(baseUrl: string, path: string, fetcher: typeof fetch, timeoutMs: number): Promise<{ status: number; data: any }> {
  const res = await fetcher(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

function subsystemCheck(id: string, label: string, subsystem: HealthSubsystem | undefined, mode: "strict" | "soft"): DoctorCheck {
  if (!subsystem) return fail(id, label, "missing from /api/health subsystem detail");
  if (subsystem.status === "healthy") return ok(id, label, subsystem.detail, subsystem.data);
  if (mode === "soft" && subsystem.status === "degraded") return warn(id, label, subsystem.detail, subsystem.data);
  return fail(id, label, subsystem.detail, subsystem.data);
}

function healthOverallCheck(health: HealthPayload): DoctorCheck {
  const status = health.healthStatus ?? health.state ?? normalizeLegacyStatus(health.status);
  if (status === "healthy") return ok("backend.status", "overall health", "healthy", health);
  if (status === "degraded") return warn("backend.status", "overall health", "degraded; see subsystem detail", health);
  return fail("backend.status", "overall health", status ?? "unknown", health);
}

function normalizeLegacyStatus(status: unknown): HealthStatusEnum | undefined {
  if (status === "ok") return "healthy";
  if (status === "degraded") return "degraded";
  if (status === "draining") return "down";
  return undefined;
}

function pickSubsystem(subsystems: Record<string, HealthSubsystem> | undefined, ...names: string[]) {
  return names.map(name => subsystems?.[name]).find(Boolean);
}

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 3000;
  const checks: DoctorCheck[] = [];
  let resolved: ResolvedApiBase;
  let healthPayload: HealthPayload | null = null;

  try {
    resolved = resolveOracleApiBase({ env, cwd });
    const target = resolved.target ? ` target=${resolved.target}` : "";
    checks.push(ok("config.resolved", "resolved API target", `${resolved.url} (${resolved.source}${target})`, resolved));
  } catch (err) {
    resolved = { url: "", source: "default" };
    checks.push(fail("config.resolved", "resolved API target", err instanceof Error ? err.message : String(err)));
  }

  try { loadConfigSources({ env, cwd }); } catch (err) {
    checks.push(fail("config.files", "config files parse", err instanceof Error ? err.message : String(err)));
  }
  const projectPath = findProjectConfigPath(cwd);
  const globalPath = globalConfigPath(env);
  checks.push((projectPath && existsSync(projectPath)) ? ok("config.project", "project config file", projectPath) : warn("config.project", "project config file", "not found"));
  checks.push(existsSync(globalPath) ? ok("config.global", "global config file", globalPath) : warn("config.global", "global config file", `not found (${globalPath})`));

  if (resolved.url) {
    try {
      const health = await fetchJson(resolved.url, "/api/health", fetcher, timeoutMs);
      healthPayload = health.data;
      checks.push(health.status >= 200 && health.status < 300
        ? ok("backend.reachable", "backend reachable", `${resolved.url}/api/health HTTP ${health.status}`, health.data)
        : fail("backend.reachable", "backend reachable", `${resolved.url}/api/health HTTP ${health.status}`, health.data));
      if (health.status >= 200 && health.status < 300) checks.push(healthOverallCheck(health.data));
    } catch (err) {
      checks.push(fail("backend.reachable", "backend reachable", err instanceof Error ? err.message : String(err)));
    }
  }

  const subsystems = healthPayload?.subsystems;
  checks.push(subsystemCheck("db.writable", "DB writable", pickSubsystem(subsystems, "database", "db"), "strict"));
  checks.push(subsystemCheck("fts.healthy", "FTS healthy", pickSubsystem(subsystems, "fts"), "strict"));
  checks.push(subsystemCheck("vector.backend", "vector backend", pickSubsystem(subsystems, "vector"), "soft"));
  checks.push(subsystemCheck("embedder.reachable", "embedder reachable", pickSubsystem(subsystems, "embedder"), "soft"));
  checks.push(subsystemCheck("plugins.loaded", "plugins loaded", pickSubsystem(subsystems, "plugins", "plugin"), "soft"));

  try {
    const mcp = await (options.mcpProbe ?? defaultMcpProbe)({ env, cwd, resolved });
    checks.push(ok("mcp.launchable", "MCP launchable", mcp.detail ?? `${mcp.toolCount} tool(s) listed`, mcp));
  } catch (err) {
    checks.push(fail("mcp.launchable", "MCP launchable", err instanceof Error ? err.message : String(err)));
  }

  return { ok: checks.every(check => check.status !== "fail" || !check.critical), resolved, checks };
}

async function defaultMcpProbe(input: { env: NodeJS.ProcessEnv; cwd: string; resolved: ResolvedApiBase }) {
  const { listExternalMcpTools } = await import("../../../src/mcp/client.ts");
  const repoRoot = resolve(import.meta.dir, "../../..");
  const api = input.resolved.url || input.env.ORACLE_API || input.env.NEO_ARRA_API || "";
  const tools = await listExternalMcpTools({
    command: "bun",
    args: ["bin/mcp.ts"],
    cwd: repoRoot,
    timeoutMs: 5000,
    env: cleanEnv({
      ...input.env,
      ORACLE_API: api,
      ORACLE_HTTP_URL: input.env.ORACLE_HTTP_URL || api,
      ORACLE_FILE_WATCHER: "0",
      ORACLE_GATEWAY_HOT_RELOAD: "0",
      ORACLE_EMBEDDER: input.env.ORACLE_EMBEDDER || "none",
    }),
  });
  return { toolCount: tools.length, detail: `${tools.length} MCP tool(s) listed` };
}

function cleanEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

function label(status: DoctorStatus): string {
  if (status === "pass") return "PASS";
  if (status === "warn") return "WARN";
  return "FAIL";
}

export async function doctorCommand(args: string[]): Promise<number> {
  const json = args.includes("--json");
  const report = await runDoctor();
  if (json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("ARRA Doctor\n");
    for (const check of report.checks) {
      const suffix = check.detail ? ` — ${check.detail}` : "";
      console.log(`${label(check.status)} ${check.label}${suffix}`);
    }
  }
  return report.ok ? 0 : 1;
}
