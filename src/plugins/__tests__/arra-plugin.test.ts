import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { loadUnifiedPlugins } from "../unified-loader.ts";

const pluginRoot = join(process.cwd(), "src/plugins");
const ARRA_VERBS = ["help", "version", "menu", "status", "health", "vector-config", "serve"];

describe("built-in arra plugin", () => {
  test("declares modern maw-js CLI, menu, and HTTP surfaces", () => {
    const manifest = JSON.parse(readFileSync(join(pluginRoot, "arra/plugin.json"), "utf8"));

    expect(manifest.name).toBe("arra");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.cli.command).toBe("arra");
    expect(manifest.cli.handler).toBe("arraCli");
    expect(manifest.verbs).toEqual(ARRA_VERBS);
    expect(manifest.httpRoutes[0].path).toBe("/api/plugins/arra");
    expect(manifest.config).toMatchObject({ dbBackend: "sqlite", embedderBackend: "none" });
    expect(manifest.configSchema.properties.dbBackend.enum).toEqual(["sqlite", "http", "memory", "custom"]);
  });

  test("loads and serves the shared ARRA plugin registry route", async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginRoot] });
    const arra = runtime.pluginRegistry().find((plugin) => plugin.name === "arra");

    expect(arra?.surfaces).toEqual(["apiRoutes", "menu", "cliSubcommands"]);
    expect(runtime.menu.find((item) => item.plugin === "arra")?.path).toBe("/plugins/arra");
    const command = runtime.cliSubcommands.find((item) => item.plugin === "arra");
    expect(command?.command).toBe("arra");
    expect(command?.handler).toBe("arraCli");

    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as never);
    const response = await app.handle(new Request("http://local/api/plugins/arra"));
    const body = await response.json() as {
      plugin: string;
      embedderRequired: boolean;
      storageBackend: string;
      embedderBackend: string;
      backends: { db: { swappable: boolean; supported: string[] }; embedder: { optional: boolean; supported: string[] } };
      verbs: Array<{ name: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toBe("arra");
    expect(body.embedderRequired).toBe(false);
    expect(body.storageBackend).toBe("sqlite");
    expect(body.embedderBackend).toBe("none");
    expect(body.backends.db.swappable).toBe(true);
    expect(body.backends.db.supported).toContain("custom");
    expect(body.backends.embedder.optional).toBe(true);
    expect(body.backends.embedder.supported).toContain("remote");
    expect(body.verbs.map((verb) => verb.name)).toEqual(ARRA_VERBS);
  });

  test("delegates maw arra health to vector engine details", async () => {
    const { arraCli } = await import("../arra/index.ts");
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/health")
          return Response.json({ status: "ok" });
        if (url.pathname === "/api/v1/vector/config") {
          return Response.json({
            source: "file",
            config: {
              collections: {
                phase1: {
                  collection: "phase1_collection",
                  model: "bge-m3",
                  adapter: "lancedb",
                },
              },
            },
            doc_counts: { phase1: 3 },
            health: {
              phase1: {
                ok: true,
                status: "ok",
                collection: "phase1_collection",
                adapter: "lancedb",
                model: "bge-m3",
              },
            },
          });
        }
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const saved = process.env.ORACLE_API;
    process.env.ORACLE_API = String(server.url);
    try {
      const result = await arraCli({
        source: "cli",
        plugin: "arra",
        args: ["health"],
      });
      expect(result.output).toContain("arra health: ok");
      expect(result.output).toContain("phase1 | lancedb | bge-m3 | 3 | ok");
    } finally {
      if (saved === undefined) delete process.env.ORACLE_API;
      else process.env.ORACLE_API = saved;
      server.stop();
    }
  });

  test("delegates maw arra vector-config read and write commands", async () => {
    const { arraCli } = await import("../arra/index.ts");
    const calls: Array<{ method: string; path: string; body?: any }> = [];
    const state = {
      source: "file",
      config: {
        dataPath: "/tmp/lancedb",
        collections: {
          phase1: { collection: "phase1_collection", model: "bge-m3", provider: "none", adapter: "lancedb", primary: true },
        },
      },
      doc_counts: { phase1: 3 },
      health: { phase1: { ok: true, status: "ok", collection: "phase1_collection", adapter: "lancedb" } },
    };
    const server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        calls.push({ method: req.method, path: url.pathname, body: req.body ? await req.json() : undefined });
        if (url.pathname === "/api/v1/vector/config" && req.method === "GET") return Response.json(state);
        if (url.pathname.startsWith("/api/v1/vector/config/")) return Response.json({ success: true, collection: "phase1" });
        if (url.pathname === "/api/v1/vector/config/reload") return Response.json({ success: true, reloaded: true });
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const saved = process.env.ORACLE_API;
    process.env.ORACLE_API = String(server.url);
    try {
      const table = await arraCli({ source: "cli", plugin: "arra", args: ["vector-config"] });
      expect(table.output).toContain("Collection | Adapter | Model | Enabled | Docs | Status");
      expect(table.output).toContain("phase1_collection ★ | lancedb | bge-m3 | true | 3 | ok");

      const raw = await arraCli({ source: "cli", plugin: "arra", args: ["vector-config", "list", "--json"] });
      expect(JSON.parse(raw.output!).collections[0]).toMatchObject({ key: "phase1", docs: 3, status: "ok" });

      const set = await arraCli({ source: "cli", plugin: "arra", args: ["vector-config", "set", "phase1", "adapter", "qdrant", "--url", "http://localhost:6333"] });
      expect(set.ok).toBe(true);
      expect(calls.at(-1)).toMatchObject({ method: "PUT", path: "/api/v1/vector/config/phase1", body: { adapter: "qdrant", endpoint: "http://localhost:6333" } });

      const blocked = await arraCli({ source: "cli", plugin: "arra", args: ["vector-config", "remove", "phase1"] });
      expect(blocked).toEqual({ ok: false, error: "remove requires --yes" });

      const removed = await arraCli({ source: "cli", plugin: "arra", args: ["vector-config", "remove", "phase1", "--yes"] });
      expect(removed.ok).toBe(true);
      expect(calls.at(-1)).toMatchObject({ method: "DELETE", path: "/api/v1/vector/config/phase1" });
    } finally {
      if (saved === undefined) delete process.env.ORACLE_API;
      else process.env.ORACLE_API = saved;
      server.stop();
    }
  });

  test("handles maw arra serve status without a running server", async () => {
    const { arraCli } = await import("../arra/index.ts");
    const savedDataDir = process.env.ORACLE_DATA_DIR;
    process.env.ORACLE_DATA_DIR = mkdtempSync(join(tmpdir(), "arra-serve-status-"));
    try {
      const result = await arraCli({ source: "cli", plugin: "arra", args: ["serve", "--status", "--port", "59999"] });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("Oracle server not running on http://127.0.0.1:59999");
    } finally {
      if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
      else process.env.ORACLE_DATA_DIR = savedDataDir;
    }
  });

  test("maw arra serve starts server in background with requested port", async () => {
    const { serveCli } = await import("../arra/serve-cli.ts");
    const savedDataDir = process.env.ORACLE_DATA_DIR;
    process.env.ORACLE_DATA_DIR = mkdtempSync(join(tmpdir(), "arra-serve-start-"));
    const calls: unknown[] = [];
    const spawn = ((cmd: string[], options: object) => {
      calls.push({ cmd, options });
      return { pid: 4242, unref() {} };
    }) as typeof Bun.spawn;
    try {
      const result = await serveCli(["--port", "59998"], { spawn, fetch: async () => new Response("no", { status: 503 }) });
      expect(result.ok).toBe(true);
      expect(result.output).toContain("pid=4242");
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({ cmd: ["bun", "run", "server"] });
    } finally {
      if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
      else process.env.ORACLE_DATA_DIR = savedDataDir;
    }
  });
});
