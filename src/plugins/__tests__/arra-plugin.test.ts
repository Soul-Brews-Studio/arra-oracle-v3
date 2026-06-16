import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { loadUnifiedPlugins } from "../unified-loader.ts";

const pluginRoot = join(process.cwd(), "src/plugins");

describe("built-in arra plugin", () => {
  test("declares modern maw-js CLI, menu, and HTTP surfaces", () => {
    const manifest = JSON.parse(
      readFileSync(join(pluginRoot, "arra/plugin.json"), "utf8"),
    );

    expect(manifest.name).toBe("arra");
    expect(manifest.entry).toBe("./index.ts");
    expect(manifest.cli.command).toBe("arra");
    expect(manifest.cli.handler).toBe("arraCli");
    expect(manifest.verbs).toEqual([
      "help",
      "version",
      "menu",
      "status",
      "health",
      "vector-config",
    ]);
    expect(manifest.httpRoutes[0].path).toBe("/api/plugins/arra");
  });

  test("loads and serves the shared ARRA plugin registry route", async () => {
    const runtime = await loadUnifiedPlugins({ dirs: [pluginRoot] });
    const arra = runtime
      .pluginRegistry()
      .find((plugin) => plugin.name === "arra");

    expect(arra?.surfaces).toEqual(["apiRoutes", "menu", "cliSubcommands"]);
    expect(runtime.menu.find((item) => item.plugin === "arra")?.path).toBe(
      "/plugins/arra",
    );
    const command = runtime.cliSubcommands.find(
      (item) => item.plugin === "arra",
    );
    expect(command?.command).toBe("arra");
    expect(command?.handler).toBe("arraCli");

    const app = new Elysia();
    for (const route of runtime.routes) app.use(route as never);
    const response = await app.handle(
      new Request("http://local/api/plugins/arra"),
    );
    const body = (await response.json()) as {
      plugin: string;
      embedderRequired: boolean;
      verbs: Array<{ name: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.plugin).toBe("arra");
    expect(body.embedderRequired).toBe(false);
    expect(body.verbs.map((verb) => verb.name)).toEqual([
      "help",
      "version",
      "menu",
      "status",
      "health",
      "vector-config",
    ]);
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

  test("delegates maw arra vector-config to the vector config CLI", async () => {
    const { arraCli } = await import("../arra/index.ts");
    const state = {
      source: "file",
      config: {
        collections: {
          phase1: {
            collection: "phase1_collection",
            model: "bge-m3",
            provider: "none",
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
        },
      },
    };
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/vector/config")
          return Response.json(state);
        return Response.json({ error: "not found" }, { status: 404 });
      },
    });
    const saved = process.env.ORACLE_API;
    process.env.ORACLE_API = String(server.url);
    try {
      const result = await arraCli({
        source: "cli",
        plugin: "arra",
        args: ["vector-config", "list", "--json"],
      });
      const payload = JSON.parse(result.output);
      expect(payload.collections[0]).toMatchObject({
        key: "phase1",
        docs: 3,
        status: "ok",
      });
    } finally {
      if (saved === undefined) delete process.env.ORACLE_API;
      else process.env.ORACLE_API = saved;
      server.stop();
    }
  });
});
