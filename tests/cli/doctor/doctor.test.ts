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

function startDoctorServer(options: { healthStatus?: number; statsStatus?: number } = {}) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health") {
        return Response.json({ status: "ok", server: "doctor-test", version: "test", port: Number(url.port), oracle: "connected" }, { status: options.healthStatus ?? 200 });
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
    expect(report.checks.find(c => c.id === "server.health")?.status).toBe("pass");
    expect(report.checks.find(c => c.id === "db.stats")?.detail).toContain("documents=42");
    expect(report.checks.find(c => c.id === "vector.stats")?.detail).toContain("adapter=lancedb");
    expect(report.checks.find(c => c.id === "mcp.mode")?.detail).toContain("HTTP proxy mode");
  });

  test("runDoctor fails when a critical server check fails", async () => {
    server = startDoctorServer({ healthStatus: 503 });

    const report = await runDoctor({
      cwd: root,
      env: { HOME: join(root, "home"), XDG_CONFIG_HOME: join(root, "xdg"), ORACLE_API: server.url.href, NEO_ARRA_API: "" },
    });

    expect(report.ok).toBe(false);
    expect(report.checks.find(c => c.id === "server.health")?.status).toBe("fail");
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
    expect(data?.checks.some(c => c.id === "vector.stats" && c.status === "pass")).toBe(true);
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
    expect(result.stdout).toContain("✓ resolved API target");
    expect(result.stdout).toContain("✓ server reachable");
    expect(result.stdout).toContain("✓ vector adapter stats");
  }, 15_000);
});
