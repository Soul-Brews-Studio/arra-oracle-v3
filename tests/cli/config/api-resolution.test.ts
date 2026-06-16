import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { oracleApiBase } from "../../../cli/src/lib/api.ts";
import { globalConfigPathForWrite } from "../../../cli/src/lib/config.ts";

const env0 = { ...process.env };
const argv0 = [...process.argv];
const cwd0 = process.cwd();
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function resetEnv(): void {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env0);
  delete process.env.ORACLE_API;
  delete process.env.XDG_CONFIG_HOME;
}

function config(path: string, targets: Record<string, string>, def = "local"): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ default: def, targets }, null, 2));
}

function projectConfig(root: string, targets: Record<string, string>, def = "local"): void {
  config(join(root, ".arra", "config.json"), targets, def);
}

function globalConfig(home: string, targets: Record<string, string>, def = "local"): void {
  process.env.XDG_CONFIG_HOME = home;
  config(globalConfigPathForWrite(), targets, def);
}

beforeEach(() => {
  resetEnv();
  process.argv = ["bun", "arra-cli", "health"];
});

afterEach(() => {
  process.chdir(cwd0);
  process.argv = [...argv0];
  resetEnv();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true });
});

test("ORACLE_API env wins over --at, project, and global config", () => {
  const project = tempDir("arra-project-");
  projectConfig(project, { local: "http://project.local:47778", m5: "http://project-m5.local:47778" });
  globalConfig(tempDir("arra-global-"), { local: "http://global.local:47778", m5: "http://global-m5.local:47778" });
  process.chdir(project);
  process.argv = ["bun", "arra-cli", "health", "--at", "m5"];
  process.env.ORACLE_API = "http://env.local:47778/";
  expect(oracleApiBase()).toBe("http://env.local:47778");
});

test("--at target wins over project default", () => {
  const project = tempDir("arra-project-");
  projectConfig(project, { local: "http://project-default.local:47778", m5: "http://project-m5.local:47778" });
  process.chdir(project);
  process.argv = ["bun", "arra-cli", "health", "--at", "m5"];
  expect(oracleApiBase()).toBe("http://project-m5.local:47778");
});

test("project .arra/config.json default wins over global config", () => {
  const project = tempDir("arra-project-");
  const child = join(project, "nested", "cwd");
  mkdirSync(child, { recursive: true });
  projectConfig(project, { local: "http://project.local:47778" });
  globalConfig(tempDir("arra-global-"), { local: "http://global.local:47778" });
  process.chdir(child);
  expect(oracleApiBase()).toBe("http://project.local:47778");
});

test("global config default wins over localhost default", () => {
  globalConfig(tempDir("arra-global-"), { m5: "http://m5.local:47778" }, "m5");
  expect(oracleApiBase()).toBe("http://m5.local:47778");
});

test("global targets.json is supported for shell prototype interop", () => {
  const home = tempDir("arra-global-");
  process.env.XDG_CONFIG_HOME = home;
  config(join(home, "arra", "targets.json"), { local: "http://localhost:47778", docker: "http://localhost:47780/" }, "docker");
  expect(oracleApiBase()).toBe("http://localhost:47780");
});

test("missing config falls back cleanly to localhost default", () => {
  process.env.XDG_CONFIG_HOME = tempDir("arra-empty-global-");
  expect(oracleApiBase()).toBe("http://localhost:47778");
});
