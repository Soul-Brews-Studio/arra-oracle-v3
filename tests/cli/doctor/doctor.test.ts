import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runDoctor } from "../../../cli/src/commands/doctor.ts";
import { runCli, tryParseJson } from "../_run.ts";

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function defaultHealthBody(port: string) {
  return {
    status: "ok",
    healthStatus: "healthy",
    server: "doctor-test",
    version: "test",
    port: Number(port),
    oracle: "connected",
    subsystems: {
      database: { status: "healthy", label: "DB writable", critical: true, detail: "SQLite writable" },
      db: { status: "healthy", label: "DB writable", critical: true, detail: "SQLite writable" },
      fts: { status: "healthy", label: "FTS healthy", critical: true, detail: "FTS ready" },
      vector: { status: "healthy", label: "vector backend", critical: true, detail: "vector ready" },
      embedder: { status: "healthy", label: "embedder reachable", critical: true, detail: "embedder ready" },
      plugins: { status: "healthy", label: "plugins loaded", critical: true, detail: "plugins ready" },
      plugin: { status: "healthy", label: "plugins loaded", critical: true, detail: "plugins ready" },
    },
  };
}

function startDoctorServer(options: { healthStatus?: number; statsStatus?: number; healthBody?: Record<string, any> } = {}) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health") {
        const base = defaultHealthBody(url.port);
        const body = {
          ...base,
          ...options.healthBody,
          subsystems: { ...base.subsystems, ...options.healthBody?.subsystems },
        };
        return Response.json(body, { status: options.healthStatus ?? 200 });
      }
      if (url.pathname === "/api/stats") {
        return Response.json({ total: 42, vector: { enabled: true, adapter: "lancedb", count: 7, collection: "oracle_knowledge" } }, { status: options.statsStatus ?? 200 });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

describe("arra doctor", () => {
  let root: string;
  let server: ReturnType<typeof Bun.serve> | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `arra-doctor-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  });

  afterEach(() => {
    server?.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("runDoctor reports config, server, stats, vector, and MCP mode", async () => {
    server = startDoctorServer();
    const xdg = join(root, "xdg");
    writeJson(join(xdg, "arra", "config.json"), {
      default: "m5",
      targets: { m5: server.url.href },
    });

    const report = await runDoctor({
      cwd: root,
      env: { HOME: join(root, "home"), XDG_CONFIG_HOME: xdg, ORACLE_API: "", NEO_ARRA_API: "", ORACLE_HTTP_URL: "http://proxy:47778" },
    });

    expect(report.ok).toBe(true);
    expect(report.resolved.source).toBe("global");
    expect(report.checks.find(c => c.id === "backend.reachable")?.status).toBe("pass");
    expect(report.checks.find(c => c.id === "db.writable")?.status).toBe("pass");
    expect(report.checks.find(c => c.id === "fts.healthy")?.status).toBe("pass");
    expect(report.checks.find(c => c.id === "vector.backend")?.detail).toContain("vector ready");
    expect(report.checks.find(c => c.id === "plugins.loaded")?.status).toBe("pass");
  });

  test("runDoctor renders backend health vocabulary and plugin subsystem", async () => {
    server = startDoctorServer({
      healthBody: {
        healthStatus: "degraded",
        subsystems: {
          plugins: { status: "degraded", label: "plugins loaded", critical: false, detail: "plugin degraded" },
        },
      },
    });

    const report = await runDoctor({
      cwd: root,
      env: { HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), ORACLE_API: server.url.href, NEO_ARRA_API: "" },
    });

    expect(report.ok).toBe(true);
    expect(report.checks.find(c => c.id === "backend.status")?.status).toBe("warn");
    expect(report.checks.find(c => c.id === "plugins.loaded")?.status).toBe("warn");
    expect(report.checks.find(c => c.id === "plugins.loaded")?.detail).toContain("plugin degraded");
  });

  test("runDoctor fails when a critical server check fails", async () => {
    server = startDoctorServer({ healthStatus: 503 });

    const report = await runDoctor({
      cwd: root,
      env: { HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), ORACLE_API: server.url.href, NEO_ARRA_API: "" },
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find(c => c.id === "backend.reachable")?.status).toBe("fail");
  });

  test("CLI --json emits structured report and exits 0 when healthy", async () => {
    server = startDoctorServer();
    const result = await runCli(["doctor", "--json"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      ORACLE_API: server.url.href,
      NEO_ARRA_API: "",
    });

    expect(result.code).toBe(0);
    const data = tryParseJson(result.stdout) as { ok: boolean; checks: Array<{ id: string; status: string }> } | null;
    expect(data?.ok).toBe(true);
    expect(data?.checks.some(c => c.id === "vector.backend" && c.status === "pass")).toBe(true);
  }, 15_000);

  test("CLI exits non-zero when a critical probe fails", async () => {
    server = startDoctorServer({ healthStatus: 503 });
    const result = await runCli(["doctor", "--json"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      ORACLE_API: server.url.href,
      NEO_ARRA_API: "",
    });

    expect(result.code).toBe(1);
    const data = tryParseJson(result.stdout) as { ok: boolean } | null;
    expect(data?.ok).toBe(false);
  }, 15_000);

  test("CLI text output is a clear checklist", async () => {
    server = startDoctorServer();
    const result = await runCli(["doctor"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      ORACLE_API: server.url.href,
      NEO_ARRA_API: "",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("ARRA Doctor");
    expect(result.stdout).toContain("PASS resolved API target");
    expect(result.stdout).toContain("PASS backend reachable");
    expect(result.stdout).toContain("PASS vector backend");
  }, 15_000);
});
