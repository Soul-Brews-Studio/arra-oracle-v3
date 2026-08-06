import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { resolveOracleApiBase, writeGlobalDefault } from "../../../cli/src/lib/config.ts";

function writeJson(path: string, value: unknown) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

describe("ARRA layered API config resolution", () => {
  let root: string;
  let project: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(() => {
    root = join(tmpdir(), `arra-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    project = join(root, "repo", "nested");
    mkdirSync(project, { recursive: true });
    env = {
      HOME: join(root, "home"),
      XDG_CONFIG_HOME: join(root, "xdg"),
    };
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("ORACLE_API wins over --at, project, global, and legacy env", () => {
    writeJson(join(root, "xdg", "arra", "config.json"), {
      default: "global",
      targets: { global: "http://global:47778", m5: "http://m5:47778" },
    });
    writeJson(join(root, "repo", ".arra", "config.json"), {
      default: "project",
      targets: { project: "http://project:47778" },
    });

    const resolved = resolveOracleApiBase({
      at: "m5",
      cwd: project,
      env: { ...env, ORACLE_API: "http://env:47778/", NEO_ARRA_API: "http://legacy:47778" },
    });

    expect(resolved).toEqual({ url: "http://env:47778", source: "ORACLE_API" });
  });

  test("--at resolves named targets from merged global and project configs", () => {
    writeJson(join(root, "xdg", "arra", "config.json"), {
      default: "global",
      targets: { m5: "http://global-m5:47778", global: "http://global:47778" },
    });
    writeJson(join(root, "repo", ".arra", "config.json"), {
      default: "project",
      targets: { m5: "http://project-m5:47778", project: "http://project:47778" },
    });

    const resolved = resolveOracleApiBase({ at: "m5", cwd: project, env });

    expect(resolved).toEqual({ url: "http://project-m5:47778", source: "--at", target: "m5" });
  });

  test("project default wins over global default and legacy env", () => {
    writeJson(join(root, "xdg", "arra", "config.json"), {
      default: "global",
      targets: { global: "http://global:47778" },
    });
    writeJson(join(root, "repo", ".arra", "config.json"), {
      default: "project",
      targets: { project: "http://project:47778" },
    });

    const resolved = resolveOracleApiBase({ cwd: project, env: { ...env, NEO_ARRA_API: "http://legacy:47778" } });

    expect(resolved.source).toBe("project");
    expect(resolved.target).toBe("project");
    expect(resolved.url).toBe("http://project:47778");
  });

  test("global default wins over legacy env when no project config exists", () => {
    writeJson(join(root, "xdg", "arra", "config.json"), {
      default: "global",
      targets: { global: "http://global:47778" },
    });

    const resolved = resolveOracleApiBase({ cwd: project, env: { ...env, NEO_ARRA_API: "http://legacy:47778" } });

    expect(resolved.source).toBe("global");
    expect(resolved.target).toBe("global");
    expect(resolved.url).toBe("http://global:47778");
  });

  test("legacy NEO_ARRA_API wins over fallback when no config exists", () => {
    const resolved = resolveOracleApiBase({ cwd: project, env: { ...env, NEO_ARRA_API: "http://legacy:47778/" } });

    expect(resolved).toEqual({ url: "http://legacy:47778", source: "NEO_ARRA_API" });
  });

  test("arra use writes the global default only for existing targets", () => {
    writeJson(join(root, "xdg", "arra", "config.json"), {
      default: "local",
      targets: { local: "http://localhost:47778", m5: "http://m5:47778" },
    });

    const path = writeGlobalDefault("m5", env);
    expect(path).toBe(join(root, "xdg", "arra", "config.json"));
    const resolved = resolveOracleApiBase({ cwd: project, env });
    expect(resolved.source).toBe("global");
    expect(resolved.target).toBe("m5");
    expect(resolved.url).toBe("http://m5:47778");
  });
});
