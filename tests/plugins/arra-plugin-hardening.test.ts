import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { discoverPlugins } from "../../cli/src/plugin/loader.ts";
import { invokePluginCommand } from "../../cli/src/plugin/invoke.ts";
import { registerPlugins, resolveCommand } from "../../cli/src/plugin/registry.ts";
import { PID_FILE_NAME } from "../../src/const.ts";
import { configure, getPidFilePath, readPidFile, writePidFile } from "../../src/process-manager/index.ts";
import { serveCli } from "../../src/plugins/arra/serve-cli.ts";
import { discoverUnifiedPluginManifests, loadUnifiedPlugins } from "../../src/plugins/unified-loader.ts";

const pluginRoot = join(process.cwd(), "src/plugins");
const savedEnv = {
  ORACLE_DATA_DIR: process.env.ORACLE_DATA_DIR,
  VECTOR_URL: process.env.VECTOR_URL,
  ORACLE_VECTOR_SERVER: process.env.ORACLE_VECTOR_SERVER,
};
const temps: string[] = [];
const downFetch = (async () => new Response("down", { status: 503 })) as typeof fetch;

afterEach(() => {
  registerPlugins([]);
  restoreEnv();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("built-in ARRA plugin hardening", () => {
  test("routes menu/API payload aliases and command failures through the runtime seam", async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginRoot] });
    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as never);

    const ok = await app.handle(new Request("http://local/api/plugins/arra", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cmd: "commands", argv: ["--json"] }),
    }));
    const body = await ok.json() as { surface: string; cliCommand: string; verbs: Array<{ name: string }> };

    expect(ok.status).toBe(200);
    expect(body.surface).toBe("api");
    expect(body.cliCommand).toBe("arra");
    expect(body.verbs.map((verb) => verb.name)).toContain("serve");

    const missing = await app.handle(new Request("http://local/api/plugins/arra?command=missing"));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, error: "unknown arra command: missing" });
  });

  test("registers the src/plugins/arra manifest as an invokable CLI command", async () => {
    const unifiedPlugins = await discoverUnifiedPluginManifests({ dirs: [pluginRoot] });
    const discovered = await discoverPlugins({
      unifiedPlugins,
      userPluginDir: join(tempDir("arra-reg-user-"), "missing-user"),
      bundledPluginDir: join(tempDir("arra-reg-bundled-"), "missing-bundled"),
    });

    registerPlugins(discovered.plugins);
    const command = resolveCommand("ARRA");
    expect(command).toMatchObject({ command: "arra", handler: "arraCli" });

    const result = await invokePluginCommand(command!, { source: "cli", args: ["commands", "--json"] });
    const payload = JSON.parse(result.output ?? "{}") as { surface: string; cliCommand: string };
    expect(result.ok).toBe(true);
    expect(payload).toMatchObject({ surface: "cli", cliCommand: "arra" });
  });
});

describe("maw arra serve hardening", () => {
  test("status ignores a live PID file for another port", async () => {
    useServeDir();
    writePidFile({ pid: process.pid, port: 55100, startedAt: new Date().toISOString(), name: "oracle-http" });

    const result = await serveCli(["status", "--port", "55101"], { fetch: downFetch });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("Oracle server not running on http://127.0.0.1:55101");
    expect(result.output).not.toContain(`pid=${process.pid}`);
    expect(readPidFile()?.port).toBe(55100);
  });

  test("start does not treat a PID from another port as already running", async () => {
    useServeDir();
    writePidFile({ pid: process.pid, port: 55102, startedAt: new Date().toISOString(), name: "oracle-http" });
    const calls: unknown[] = [];
    const spawn = ((cmd: string[], options: object) => {
      calls.push({ cmd, options });
      return { pid: 55103, unref() {} };
    }) as typeof Bun.spawn;

    const result = await serveCli(["start", "--port", "55104"], { fetch: downFetch, spawn });

    expect(result.ok).toBe(true);
    expect(result.output).toContain("pid=55103");
    expect(calls).toHaveLength(1);
    expect(readPidFile()).toMatchObject({ pid: 55103, port: 55104 });
  });

  test("stop leaves stale PID files for other ports untouched", async () => {
    useServeDir();
    writePidFile({ pid: 999_999_999, port: 55105, startedAt: new Date().toISOString(), name: "oracle-http" });

    const result = await serveCli(["stop", "--port", "55106"]);

    expect(result.ok).toBe(true);
    expect(result.output).toContain("PID file tracks port 55105");
    expect(existsSync(getPidFilePath())).toBe(true);
    expect(readPidFile()?.port).toBe(55105);
  });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function useServeDir(): string {
  const dir = tempDir("arra-serve-hardening-");
  process.env.ORACLE_DATA_DIR = dir;
  delete process.env.VECTOR_URL;
  delete process.env.ORACLE_VECTOR_SERVER;
  configure({ dataDir: dir, pidFileName: PID_FILE_NAME });
  return dir;
}

function restoreEnv(): void {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
