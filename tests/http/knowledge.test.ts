import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startOwnedServer, type LiveServer } from "./_live-server.ts";

const PORT = 47791;
let server: LiveServer;
const BASE_URL = `http://localhost:${PORT}`;
const SEED_TAG = `yellow-http-test-${Date.now()}`;

const JSON_HEADERS = { "Content-Type": "application/json" };
const post = (url: string, body: unknown) => server.post(url, body);

async function seedLearn(pattern: string, concepts: string[] = []) {
  const res = await post("/api/learn", { pattern, source: SEED_TAG, concepts: [SEED_TAG, ...concepts] });
  if (!res.ok) throw new Error(`seed failed (${res.status}): ${await res.text()}`);
  return res.json();
}

describe("HTTP Contract — search / knowledge / supersede", () => {
  beforeAll(async () => {
    // This suite OWNS its server — see _live-server.ts for why that matters. It used to begin
    // with `if (await isUp()) return;`, adopting whatever was listening and seeding it, which
    // put 432 `yellow-http-test-*` documents into the live corpus.
    server = await startOwnedServer(PORT, "knowledge-http");
  }, 30_000);

  afterAll(() => {
    server?.stop();
  });

  describe("POST /api/learn", () => {
    test("creates a learning doc", async () => {
      const result = await seedLearn(`${SEED_TAG} — alpha about oracles`);
      expect(result).toBeDefined();
      expect(result.error).toBeUndefined();
    });

    test("seeds additional docs", async () => {
      await seedLearn(`${SEED_TAG} — beta on knowledge graphs`, ["graph"]);
      await seedLearn(`${SEED_TAG} — gamma mirrors reflect`, ["mirror"]);
    });

    test("rejects missing pattern field", async () => {
      const res = await post("/api/learn", { source: "test" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/pattern/i);
    });

    test("rejects malformed JSON body as 500", async () => {
      const res = await fetch(`${BASE_URL}/api/learn`, { method: "POST", headers: JSON_HEADERS, body: "{not json" });
      const body = await res.json();
      expect(res.status).toBe(500);
      expect(res.status).not.toBe(400);
      expect(res.headers.get("content-type")).toContain("application/json");
      expect(body).toMatchObject({ success: false, error: "Internal Server Error", code: 500 });
    });
  });

  describe("GET /api/search", () => {
    test("finds seeded docs by unique tag", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(SEED_TAG)}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.query).toBe(SEED_TAG);
      expect(data.results.length).toBeGreaterThan(0);
    }, 30_000);

    test("respects limit parameter", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=pattern&limit=2`);
      expect(res.ok).toBe(true);
      expect((await res.json()).results.length).toBeLessThanOrEqual(2);
    }, 30_000);

    test("rejects missing query param", async () => {
      const res = await fetch(`${BASE_URL}/api/search`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/q/);
    });

    test("rejects query empty after sanitize", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent("<script></script>")}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/empty|invalid/i);
    });

    test("strips HTML tags from query", async () => {
      const res = await fetch(`${BASE_URL}/api/search?q=${encodeURIComponent(`<b>${SEED_TAG}</b>`)}`);
      expect(res.ok).toBe(true);
      expect((await res.json()).query).toBe(SEED_TAG);
    }, 30_000);
  });

  describe("GET /api/reflect", () => {
    test("returns content or error object", async () => {
      const res = await fetch(`${BASE_URL}/api/reflect`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.content !== undefined || data.error !== undefined).toBe(true);
    });
  });

  describe("GET /api/list", () => {
    test("returns documents array", async () => {
      const res = await fetch(`${BASE_URL}/api/list?limit=5`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results.length).toBeLessThanOrEqual(5);
    });

    test("accepts type filter", async () => {
      const res = await fetch(`${BASE_URL}/api/list?type=learning&limit=3`);
      expect(res.ok).toBe(true);
      expect(Array.isArray((await res.json()).results)).toBe(true);
    });
  });

  describe("GET /api/similar", () => {
    test("rejects missing id param", async () => {
      const res = await fetch(`${BASE_URL}/api/similar`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/id/);
    });

    test("404-shaped payload for unknown id", async () => {
      const res = await fetch(`${BASE_URL}/api/similar?id=does-not-exist-${Date.now()}`);
      expect([200, 404]).toContain(res.status);
      expect(Array.isArray((await res.json()).results)).toBe(true);
    }, 15_000);
  });

  describe("GET /api/map, /api/map3d", () => {
    test("map returns documents shape", async () => {
      const data = await (await fetch(`${BASE_URL}/api/map`)).json();
      expect(data).toHaveProperty("documents");
      expect(typeof data.total === "number").toBe(true);
    }, 30_000);

    test("map3d returns documents shape", async () => {
      const data = await (await fetch(`${BASE_URL}/api/map3d`)).json();
      expect(data).toHaveProperty("documents");
    }, 30_000);
  });

  describe("POST /api/handoff + GET /api/inbox", () => {
    const slug = `yellow-test-${Date.now()}`;

    test("writes handoff file", async () => {
      const res = await post("/api/handoff", { content: `test handoff ${slug}`, slug });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.file).toContain(slug);
    });

    test("rejects missing content field", async () => {
      const res = await post("/api/handoff", { slug: "x" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/content/i);
    });

    test("inbox lists handoffs including the one just written", async () => {
      const res = await fetch(`${BASE_URL}/api/inbox?type=handoff&limit=50`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.files)).toBe(true);
      expect(typeof data.total).toBe("number");
      expect(data.files.some((f: { filename: string }) => f.filename.includes(slug))).toBe(true);
    });

    test("inbox honors pagination", async () => {
      const res = await fetch(`${BASE_URL}/api/inbox?limit=1&offset=0`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(data.files.length).toBeLessThanOrEqual(1);
      expect(data.limit).toBe(1);
      expect(data.offset).toBe(0);
    });
  });

  describe("Supersede", () => {
    const oldPath = `ψ/test/yellow-old-${Date.now()}.md`;
    const newPath = `ψ/test/yellow-new-${Date.now()}.md`;

    test("POST /api/supersede logs a supersession", async () => {
      const res = await post("/api/supersede", { old_path: oldPath, new_path: newPath, reason: "yellow http contract test" });
      expect(res.status).toBe(201);
      const data = await res.json();
      expect(typeof data.id === "number" || typeof data.id === "string").toBe(true);
    });

    test("POST /api/supersede rejects missing old_path", async () => {
      const res = await post("/api/supersede", { new_path: "x" });
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/old_path/);
    });

    test("GET /api/supersede returns contract shape", async () => {
      const res = await fetch(`${BASE_URL}/api/supersede?limit=5`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.supersessions)).toBe(true);
      expect(typeof data.total).toBe("number");
      expect(data.limit).toBe(5);
      expect(data.offset).toBe(0);
    });

    test("GET /api/supersede/chain/:path empty for unknown path", async () => {
      const unknown = encodeURIComponent(`ψ/test/does-not-exist-${Date.now()}.md`);
      const res = await fetch(`${BASE_URL}/api/supersede/chain/${unknown}`);
      expect(res.ok).toBe(true);
      const data = await res.json();
      expect(Array.isArray(data.superseded_by)).toBe(true);
      expect(Array.isArray(data.supersedes)).toBe(true);
      expect(data.superseded_by.length).toBe(0);
      expect(data.supersedes.length).toBe(0);
    });
  });
});
