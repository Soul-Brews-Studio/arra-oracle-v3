import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../_run.ts";

const cwd0 = process.cwd();
const temps: string[] = [];
const tmp = (p: string) => (temps.push(mkdtempSync(join(tmpdir(), p))), temps.at(-1)!);
const env = (xdg: string, extra = {}) => ({ XDG_CONFIG_HOME: xdg, ORACLE_API: undefined, NEO_ARRA_API: undefined, ...extra });
function cfg(path: string, targets: Record<string, string>, def = "local") {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ default: def, targets }, null, 2));
}

afterEach(() => {
  process.chdir(cwd0);
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true });
});

test("config show reports env, --at, and project/global source precedence", async () => {
  const xdg = tmp("arra-global-");
  cfg(join(xdg, "arra", "config.json"), { local: "http://global.local:47778", m5: "http://m5.local:47778" });
  const project = tmp("arra-project-");
  mkdirSync(join(project, "nested"), { recursive: true });
  cfg(join(project, ".arra", "config.json"), { local: "http://project.local:47778" });
  process.chdir(join(project, "nested"));

  const projectShow = await runCli(["config", "show"], env(xdg));
  expect(projectShow.stdout).toContain("Resolved: http://project.local:47778");
  expect(projectShow.stdout).toContain("Source: project");
  expect(projectShow.stdout).toMatch(/\* local\s+http:\/\/project\.local:47778/);

  const atShow = await runCli(["--at", "m5", "config", "show"], env(xdg));
  expect(atShow.stdout).toContain("Resolved: http://m5.local:47778");
  expect(atShow.stdout).toContain("Source: --at");
  expect(atShow.stdout).toMatch(/\* m5\s+http:\/\/m5\.local:47778/);

  const envShow = await runCli(["--at", "m5", "config", "show"], env(xdg, { ORACLE_API: "http://env.local:47778" }));
  expect(envShow.stdout).toContain("Resolved: http://env.local:47778");
  expect(envShow.stdout).toContain("Source: env");
});

test("config add/use mutate global config and path prints config.json by default", async () => {
  const xdg = tmp("arra-write-");
  const path = join(xdg, "arra", "config.json");
  expect((await runCli(["config", "path"], env(xdg))).stdout.trim()).toBe(path);
  expect((await runCli(["config", "add", "m5", "http://m5.local:47778/"], env(xdg))).code).toBe(0);
  expect((await runCli(["config", "add", "docker", "http://localhost:47780"], env(xdg))).code).toBe(0);
  expect((await runCli(["config", "use", "docker"], env(xdg))).code).toBe(0);
  const data = JSON.parse(readFileSync(path, "utf8"));
  expect(data.default).toBe("docker");
  expect(data.targets.m5).toBe("http://m5.local:47778");
  expect(data.targets.docker).toBe("http://localhost:47780");
});

test("config path and writes reuse existing targets.json for shell interop", async () => {
  const xdg = tmp("arra-targets-");
  const path = join(xdg, "arra", "targets.json");
  cfg(path, { local: "http://localhost:47778" });
  expect((await runCli(["config", "path"], env(xdg))).stdout.trim()).toBe(path);
  expect((await runCli(["config", "add", "m5", "http://m5.local:47778"], env(xdg))).code).toBe(0);
  expect(JSON.parse(readFileSync(path, "utf8")).targets.m5).toBe("http://m5.local:47778");
});

test("config target writes preserve server plugin toggles", async () => {
  const xdg = tmp("arra-plugin-preserve-");
  const path = join(xdg, "arra", "config.json");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify({ disabledPlugins: ["federation"] }, null, 2));
  expect((await runCli(["config", "add", "m5", "http://m5.local:47778"], env(xdg))).code).toBe(0);
  const data = JSON.parse(readFileSync(path, "utf8"));
  expect(data.targets.m5).toBe("http://m5.local:47778");
  expect(data.disabledPlugins).toEqual(["federation"]);
});
