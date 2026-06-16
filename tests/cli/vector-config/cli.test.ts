import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli, tryParseJson } from "../_run.ts";

type CollectionKey = {
  collection: string;
  model: string;
  provider: string;
  adapter?: string;
  enabled?: boolean;
  primary?: boolean;
};

type VectorState = {
  source: "file" | "defaults";
  config: {
    collections: Record<string, CollectionKey>;
  };
  doc_counts: Record<string, number>;
  health: Record<string, { status: string; ok: boolean; collection: string; adapter: string }>; 
};

function createState(): VectorState {
  return {
    source: "file",
    config: {
      collections: {
        "bge-m3": {
          collection: "oracle_knowledge_bge_m3",
          model: "bge-m3",
          provider: "none",
          adapter: "lancedb",
          primary: true,
        },
        phase2: {
          collection: "oracle_knowledge_phase2",
          model: "nomic-embed-text",
          provider: "remote",
          adapter: "qdrant",
        },
      },
    },
    doc_counts: {
      "bge-m3": 8,
      phase2: 2,
    },
    health: {
      "bge-m3": { status: "ok", ok: true, collection: "oracle_knowledge_bge_m3", adapter: "lancedb" },
      phase2: { status: "ok", ok: true, collection: "oracle_knowledge_phase2", adapter: "qdrant" },
    },
  };
}

describe("arra-cli vector-config", () => {
  let root: string;
  let state = createState();
  let env: Record<string, string>;
  let server: ReturnType<typeof Bun.serve>;

  beforeEach(() => {
    root = join(tmpdir(), `arra-vector-config-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    state = createState();
    const payload = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });

    server = Bun.serve({
      port: 0,
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/v1/vector/config") {
          if (req.method !== "GET") return payload({ error: "method not allowed" }, 405);
          return payload(state);
        }

        if (url.pathname === "/api/v1/vector/config/reload" && req.method === "POST") {
          return payload({ success: true, reloaded: true, source: state.source, config: state.config });
        }

        const match = url.pathname.match(/^\/api\/v1\/vector\/config\/([^/]+)$/);
        if (match) {
          const key = decodeURIComponent(match[1]);
          if (req.method === "DELETE") {
            delete state.config.collections[key];
            return payload({ success: true, removed: key, config: state.config });
          }
          if (req.method !== "PUT" && req.method !== "POST") return payload({ error: "method not allowed" }, 405);
          if (req.method === "PUT" && !state.config.collections[key]) return payload({ error: `Unknown collection: ${key}` }, 404);
          try {
            const patch = (await req.json()) as Partial<CollectionKey>;
            state.config.collections[key] = req.method === "POST"
              ? { collection: patch.collection ?? key, model: patch.model ?? "model", provider: patch.provider ?? "none", adapter: patch.adapter }
              : { ...state.config.collections[key], ...patch };
            return payload({ success: true, source: state.source, path: "/tmp/vector-server.json", collection: key, config: state.config });
          } catch {
            return payload({ error: "invalid body" }, 400);
          }
        }

        const primaryMatch = url.pathname.match(/^\/api\/v1\/vector\/config\/([^/]+)\/primary$/);
        if (primaryMatch) {
          const key = decodeURIComponent(primaryMatch[1]);
          for (const [name, col] of Object.entries(state.config.collections)) col.primary = name === key;
          return payload({ success: true, collection: key, config: state.config });
        }

        const testMatch = url.pathname.match(/^\/api\/v1\/vector\/config\/([^/]+)\/test$/);
        if (testMatch) {
          if (req.method !== "POST") return payload({ error: "method not allowed" }, 405);
          const key = decodeURIComponent(testMatch[1]);
          if (!state.config.collections[key]) return payload({ error: `Unknown collection: ${key}` }, 404);
          return payload({
            success: true,
            key,
            collection: state.config.collections[key].collection,
            count: state.doc_counts[key] ?? 0,
            status: "ok",
            adapter: state.config.collections[key].adapter,
          });
        }

        return payload({ error: "not found" }, 404);
      },
    });

    env = {
      HOME: join(root, "home"),
      ORACLE_API: server.url,
      ORACLE_DATA_DIR: join(root, "data"),
    };
  });

  afterEach(() => {
    server.stop();
    rmSync(root, { recursive: true, force: true });
  });

  test("lists configured vector collections", async () => {
    const result = await runCli(["vector-config", "list", "--json"], env);
    const payload = tryParseJson(result.stdout);
    expect(result.code).toBe(0);
    expect(Array.isArray(payload?.collections)).toBe(true);
    expect(payload?.collections?.map((c: { key: string }) => c.key)).toContain("bge-m3");
    expect(payload?.collections?.map((c: { key: string }) => c.key)).toContain("phase2");
  });

  test("shows stats for all collections and one collection", async () => {
    const all = await runCli(["vector-config", "stats"], env);
    const allPayload = tryParseJson(all.stdout);
    expect(all.code).toBe(0);
    expect(Array.isArray(allPayload.collections)).toBe(true);
    expect(allPayload.collections).toHaveLength(2);

    const one = await runCli(["vector-config", "stats", "bge-m3"], env);
    const onePayload = tryParseJson(one.stdout);
    expect(one.code).toBe(0);
    expect(onePayload?.key).toBe("bge-m3");
    expect(onePayload?.docs).toBe(8);
  });

  test("shows one collection config and updates model/enabled state", async () => {
    const getBefore = await runCli(["vector-config", "get", "phase2"], env);
    const before = tryParseJson(getBefore.stdout);
    expect(before?.config?.model).toBe("nomic-embed-text");

    const set = await runCli(["vector-config", "set", "phase2", "model", "embed-v2"], env);
    const setPayload = tryParseJson(set.stdout);
    expect(set.code).toBe(0);
    expect(setPayload?.success).toBe(true);

    const getAfter = await runCli(["vector-config", "get", "phase2"], env);
    const after = tryParseJson(getAfter.stdout);
    expect(after?.config?.model).toBe("embed-v2");

    const disable = await runCli(["vector-config", "set", "phase2", "enabled", "false"], env);
    expect(disable.code).toBe(0);
    const disabled = await runCli(["vector-config", "get", "phase2"], env);
    expect(tryParseJson(disabled.stdout)?.config?.enabled).toBe(false);
  });

  test("supports collection ops", async () => {
    const reload = await runCli(["vector-config", "reload"], env);
    expect(reload.code).toBe(0);
    const reloadPayload = tryParseJson(reload.stdout);
    expect(reloadPayload).toEqual(expect.objectContaining({ success: true, reloaded: true }));

    const test = await runCli(["vector-config", "test", "phase2"], env);
    const testPayload = tryParseJson(test.stdout);
    expect(test.code).toBe(0);
    expect(testPayload?.success).toBe(true);

    const add = await runCli(["vector-config", "add", "phase3", "--model", "embed-v3", "--adapter", "lancedb"], env);
    expect(add.code).toBe(0);
    expect(tryParseJson(add.stdout)?.config?.collections?.phase3?.model).toBe("embed-v3");

    const primary = await runCli(["vector-config", "set-primary", "phase3"], env);
    expect(primary.code).toBe(0);
    expect(tryParseJson(primary.stdout)?.config?.collections?.phase3?.primary).toBe(true);

    const remove = await runCli(["vector-config", "remove", "phase3", "--yes"], env);
    expect(remove.code).toBe(0);
    expect(tryParseJson(remove.stdout)?.removed).toBe("phase3");
  });
});
