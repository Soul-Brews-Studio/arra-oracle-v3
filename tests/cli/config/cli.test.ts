import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runCli } from "../_run.ts";

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function startHealthServer(serverName: string) {
  return Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/api/health") {
        return Response.json({
          status: "ok",
          server: serverName,
          version: "test",
          port: Number(new URL(req.url).port),
          oracle: "connected",
        });
      }
      return new Response("not found", { status: 404 });
    },
  });
}

describe("arra CLI layered config", () => {
  let root: string;
  let m5: ReturnType<typeof Bun.serve> | undefined;
  let envServer: ReturnType<typeof Bun.serve> | undefined;

  beforeEach(() => {
    root = join(tmpdir(), `arra-cli-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    m5 = startHealthServer("m5-target");
    envServer = startHealthServer("env-target");
  });

  afterEach(() => {
    m5?.stop(true);
    envServer?.stop(true);
    rmSync(root, { recursive: true, force: true });
  });

  test("--at selects a named XDG target for health", async () => {
    const xdg = join(root, "xdg");
    writeJson(join(xdg, "arra", "config.json"), {
      default: "local",
      targets: {
        local: "http://localhost:47778",
        m5: m5!.url.href,
      },
    });

    const result = await runCli(["--at", "m5", "health"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: xdg,
      ORACLE_API: "",
      NEO_ARRA_API: "",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Server:  m5-target");
    expect(result.stdout).toContain(`Port:    ${m5!.url.port}`);
  }, 15_000);

  test("project .arra/config.json default selects the API target", async () => {
    const repo = join(root, "repo", "nested");
    mkdirSync(repo, { recursive: true });
    writeJson(join(root, "repo", ".arra", "config.json"), {
      default: "m5",
      targets: { m5: m5!.url.href },
    });

    const result = await runCli(["health"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
      ORACLE_API: "",
      NEO_ARRA_API: "",
    }, { cwd: repo });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Server:  m5-target");
    expect(result.stdout).toContain(`Port:    ${m5!.url.port}`);
  }, 15_000);

  test("ORACLE_API still wins over --at", async () => {
    const xdg = join(root, "xdg");
    writeJson(join(xdg, "arra", "config.json"), {
      default: "m5",
      targets: { m5: m5!.url.href },
    });

    const result = await runCli(["--at", "m5", "health"], {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: xdg,
      ORACLE_API: envServer!.url.href,
      NEO_ARRA_API: "",
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Server:  env-target");
    expect(result.stdout).toContain(`Port:    ${envServer!.url.port}`);
  }, 15_000);
});
