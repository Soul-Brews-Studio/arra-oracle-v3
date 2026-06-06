import { existsSync } from "fs";
import { globalConfigPath, findProjectConfigPath, loadConfigSources, resolveOracleApiBase, type ResolvedApiBase } from "../lib/config.ts";

export type DoctorStatus = "pass" | "fail" | "warn";

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

function ok(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "pass", critical: true, detail, data };
}

function fail(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "fail", critical: true, detail, data };
}

function warn(id: string, label: string, detail?: string, data?: unknown): DoctorCheck {
  return { id, label, status: "warn", critical: false, detail, data };
}

async function fetchJson(baseUrl: string, path: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${baseUrl}${path}`);
  let data: any = null;
  try { data = await res.json(); } catch { /* non-json */ }
  return { status: res.status, data };
}

function adapterFromStats(stats: any): string | undefined {
  const vector = stats?.vector ?? stats?.vectors;
  if (!vector) return undefined;
  if (typeof vector.adapter === "string") return vector.adapter;
  if (typeof vector.type === "string") return vector.type;
  if (typeof vector.engine === "string") return vector.engine;
  if (typeof vector.collection === "string") return vector.collection;
  return undefined;
}

function countFromStats(stats: any): number | undefined {
  const vector = stats?.vector ?? stats?.vectors;
  if (typeof vector?.count === "number") return vector.count;
  if (typeof vector?.total === "number") return vector.total;
  if (typeof stats?.total === "number") return stats.total;
  if (typeof stats?.total_docs === "number") return stats.total_docs;
  return undefined;
}

export async function runDoctor(options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const checks: DoctorCheck[] = [];
  let resolved: ResolvedApiBase;

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
  checks.push((projectPath && existsSync(projectPath))
    ? ok("config.project", "project config file", projectPath)
    : warn("config.project", "project config file", "not found"));
  checks.push(existsSync(globalPath)
    ? ok("config.global", "global config file", globalPath)
    : warn("config.global", "global config file", `not found (${globalPath})`));

  checks.push(ok(
    "mcp.mode",
    "MCP mode",
    env.ORACLE_HTTP_URL?.trim()
      ? `HTTP proxy mode (${env.ORACLE_HTTP_URL})`
      : "embedded mode (ORACLE_HTTP_URL not set)",
    { ORACLE_HTTP_URL: env.ORACLE_HTTP_URL ?? null }
  ));

  if (resolved.url) {
    try {
      const health = await fetchJson(resolved.url, "/api/health");
      if (health.status >= 200 && health.status < 300) {
        checks.push(ok("server.health", "server reachable", `${resolved.url}/api/health HTTP ${health.status}`, health.data));
      } else {
        checks.push(fail("server.health", "server reachable", `${resolved.url}/api/health HTTP ${health.status}`, health.data));
      }
    } catch (err) {
      checks.push(fail("server.health", "server reachable", err instanceof Error ? err.message : String(err)));
    }

    try {
      const stats = await fetchJson(resolved.url, "/api/stats");
      if (stats.status >= 200 && stats.status < 300) {
        const total = typeof stats.data?.total === "number" ? stats.data.total : stats.data?.total_docs;
        const vector = stats.data?.vector ?? stats.data?.vectors;
        checks.push(ok("db.stats", "DB stats", `documents=${total ?? "unknown"}`, stats.data));
        checks.push(ok(
          "vector.stats",
          "vector adapter stats",
          `adapter=${adapterFromStats(stats.data) ?? "unknown"} count=${countFromStats({ vector }) ?? "unknown"}`,
          vector
        ));
      } else {
        checks.push(fail("db.stats", "DB + vector stats", `${resolved.url}/api/stats HTTP ${stats.status}`, stats.data));
      }
    } catch (err) {
      checks.push(fail("db.stats", "DB + vector stats", err instanceof Error ? err.message : String(err)));
    }
  }

  return { ok: checks.every(check => check.status !== "fail" || !check.critical), resolved, checks };
}

function symbol(status: DoctorStatus): string {
  if (status === "pass") return "✓";
  if (status === "warn") return "!";
  return "✗";
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
      console.log(`${symbol(check.status)} ${check.label}${suffix}`);
    }
  }
  return report.ok ? 0 : 1;
}
