/**
 * Database Integration Tests
 * Tests oracle-v2 database operations with Drizzle ORM
 * Uses isolated test database with proper migrations
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { eq, isNull, sql } from "drizzle-orm";
import { existsSync, mkdirSync, rmSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Import schema
import * as schema from "../db/schema";

// Test database (separate from production)
const TEST_DB_PATH = join(homedir(), ".oracle", "test-integration.db");
const PROJECT_ROOT = join(import.meta.dir, "../..");

let sqlite: Database;
let db: ReturnType<typeof drizzle>;

describe("Database Integration (Drizzle ORM)", () => {
  beforeAll(async () => {
    // Ensure directory exists
    const dir = join(homedir(), ".oracle");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Create fresh test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }

    sqlite = new Database(TEST_DB_PATH);
    db = drizzle(sqlite, { schema });

    // Apply migrations from migration files
    const migrationsDir = join(PROJECT_ROOT, "src/db/migrations");
    const migrationFiles = [
      "0000_unknown_viper.sql",
      "0001_chunky_dark_phoenix.sql",
      "0002_mixed_rhodey.sql",
      "0003_rapid_strong_guy.sql",
      "0004_warm_mesmero.sql",
      "0005_add_schedule.sql",
      "0006_magenta_screwball.sql",
      "0007_add_tempo_to_schedule.sql",
    ];

    for (const file of migrationFiles) {
      const sqlPath = join(migrationsDir, file);
      if (existsSync(sqlPath)) {
        const sql = readFileSync(sqlPath, "utf-8");
        // Execute each statement separately (split by --)
        const statements = sql.split("--> statement-breakpoint").filter(s => s.trim());
        for (const stmt of statements) {
          if (stmt.trim()) {
            try {
              sqlite.exec(stmt);
            } catch (e) {
              // Ignore errors for already existing objects
            }
          }
        }
      }
    }

    // Create FTS5 table (not in migrations)
    sqlite.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS oracle_fts USING fts5(
        id UNINDEXED,
        content,
        concepts,
        tokenize='porter unicode61'
      );
    `);
  });

  afterAll(() => {
    sqlite.close();
    // Clean up test database
    if (existsSync(TEST_DB_PATH)) {
      rmSync(TEST_DB_PATH);
    }
  });

  // ===================
  // Document Operations (Drizzle)
  // ===================
  describe("Document Operations (Drizzle ORM)", () => {
    const now = Date.now();

    test("INSERT document with Drizzle", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "drizzle_doc_1",
        type: "learning",
        sourceFile: "/test/drizzle.md",
        concepts: JSON.stringify(["drizzle", "orm", "test"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "drizzle_doc_1"));

      expect(docs.length).toBe(1);
      expect(docs[0].type).toBe("learning");
      expect(docs[0].sourceFile).toBe("/test/drizzle.md");
    });

    test("SELECT by type with Drizzle", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "drizzle_doc_2",
        type: "principle",
        sourceFile: "/test/principle.md",
        concepts: JSON.stringify(["core", "oracle"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      });

      const learnings = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.type, "learning"));

      expect(learnings.length).toBeGreaterThanOrEqual(1);
      expect(learnings.every((d) => d.type === "learning")).toBe(true);
    });

    test("Supersede document (Nothing is Deleted)", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "drizzle_doc_3",
        type: "learning",
        sourceFile: "/test/updated.md",
        concepts: JSON.stringify(["updated"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
      });

      await db
        .update(schema.oracleDocuments)
        .set({
          supersededBy: "drizzle_doc_3",
          supersededAt: Date.now(),
          supersededReason: "Updated with new information",
        })
        .where(eq(schema.oracleDocuments.id, "drizzle_doc_1"));

      const oldDoc = await db
        .select()
        .from(schema.oracleDocuments)
        .where(eq(schema.oracleDocuments.id, "drizzle_doc_1"));

      expect(oldDoc[0].supersededBy).toBe("drizzle_doc_3");
      expect(oldDoc[0].supersededReason).toBe("Updated with new information");
    });

    test("Filter non-superseded documents", async () => {
      const activeDocs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(isNull(schema.oracleDocuments.supersededBy));

      expect(activeDocs.length).toBeGreaterThanOrEqual(1);
      expect(activeDocs.every((d) => d.supersededBy === null)).toBe(true);
    });

    test("Project filtering with universal docs", async () => {
      await db.insert(schema.oracleDocuments).values({
        id: "proj_doc_1",
        type: "learning",
        sourceFile: "/proj/a.md",
        concepts: JSON.stringify(["project-specific"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        project: "github.com/test/project",
      });

      await db.insert(schema.oracleDocuments).values({
        id: "universal_doc",
        type: "principle",
        sourceFile: "/core/universal.md",
        concepts: JSON.stringify(["universal"]),
        createdAt: now,
        updatedAt: now,
        indexedAt: now,
        project: null,
      });

      const docs = await db
        .select()
        .from(schema.oracleDocuments)
        .where(
          sql`${schema.oracleDocuments.project} = ${"github.com/test/project"} OR ${schema.oracleDocuments.project} IS NULL`
        );

      const hasProjectDocs = docs.some((d) => d.project === "github.com/test/project");
      const hasUniversalDocs = docs.some((d) => d.project === null);

      expect(hasProjectDocs).toBe(true);
      expect(hasUniversalDocs).toBe(true);
    });
  });

  // ===================
  // Search Logging (Drizzle)
  // ===================
  describe("Search Logging (Drizzle ORM)", () => {
    const now = Date.now();

    test("LOG search query", async () => {
      await db.insert(schema.searchLog).values({
        query: "oracle philosophy",
        type: "all",
        mode: "hybrid",
        resultsCount: 5,
        searchTimeMs: 42,
        createdAt: now,
        project: "test-project",
        results: JSON.stringify([{ id: "doc1", score: 0.9 }]),
      });

      const logs = await db
        .select()
        .from(schema.searchLog)
        .where(eq(schema.searchLog.query, "oracle philosophy"));

      expect(logs.length).toBe(1);
      expect(logs[0].mode).toBe("hybrid");
    });

    test("AGGREGATE search stats", async () => {
      await db.insert(schema.searchLog).values({ query: "test1", resultsCount: 3, searchTimeMs: 20, createdAt: now });
      await db.insert(schema.searchLog).values({ query: "test2", resultsCount: 7, searchTimeMs: 35, createdAt: now });

      const stats = await db
        .select({
          totalSearches: sql<number>`COUNT(*)`,
          avgTime: sql<number>`AVG(${schema.searchLog.searchTimeMs})`,
          totalResults: sql<number>`SUM(${schema.searchLog.resultsCount})`,
        })
        .from(schema.searchLog);

      expect(stats[0].totalSearches).toBeGreaterThanOrEqual(3);
    });
  });

  // ===================
  // Forum Operations (Drizzle)
  // ===================
  describe("Forum Operations (Drizzle ORM)", () => {
    let threadId: number;
    const now = Date.now();

    test("CREATE thread", async () => {
      const result = await db.insert(schema.forumThreads).values({
        title: "Test Drizzle Thread",
        createdBy: "user",
        status: "active",
        createdAt: now,
        updatedAt: now,
      }).returning({ id: schema.forumThreads.id });

      threadId = result[0].id;

      const threads = await db
        .select()
        .from(schema.forumThreads)
        .where(eq(schema.forumThreads.id, threadId));

      expect(threads[0].title).toBe("Test Drizzle Thread");
      expect(threads[0].status).toBe("active");
    });

    test("ADD message to thread", async () => {
      await db.insert(schema.forumMessages).values({
        threadId,
        role: "human",
        content: "Test message via Drizzle",
        author: "user",
        createdAt: Date.now(),
      });

      const messages = await db
        .select()
        .from(schema.forumMessages)
        .where(eq(schema.forumMessages.threadId, threadId));

      expect(messages.length).toBe(1);
      expect(messages[0].content).toBe("Test message via Drizzle");
    });

    test("UPDATE thread status", async () => {
      await db
        .update(schema.forumThreads)
        .set({ status: "answered", updatedAt: Date.now() })
        .where(eq(schema.forumThreads.id, threadId));

      const threads = await db
        .select()
        .from(schema.forumThreads)
        .where(eq(schema.forumThreads.id, threadId));

      expect(threads[0].status).toBe("answered");
    });
  });

  // ===================
  // Trace Logging (Drizzle)
  // ===================
  describe("Trace Logging (Drizzle ORM)", () => {
    test("LOG trace session", async () => {
      const traceId = `trace_${Date.now()}`;
      const now = Date.now();

      await db.insert(schema.traceLog).values({
        traceId,
        query: "oracle patterns",
        queryType: "general",
        foundFiles: JSON.stringify(["/path/to/file.md"]),
        foundCommits: JSON.stringify([{ hash: "abc123", message: "test" }]),
        status: "raw",
        createdAt: now,
        updatedAt: now,
      });

      const traces = await db
        .select()
        .from(schema.traceLog)
        .where(eq(schema.traceLog.traceId, traceId));

      expect(traces.length).toBe(1);
      expect(traces[0].query).toBe("oracle patterns");
    });
  });

  // ===================
  // FTS5 (Raw SQL)
  // ===================
  describe("FTS5 Full-Text Search (Raw SQL)", () => {
    beforeAll(() => {
      sqlite.exec(`INSERT INTO oracle_fts (id, content, concepts) VALUES ('fts_1', 'The Oracle philosophy emphasizes patterns', 'oracle,philosophy')`);
      sqlite.exec(`INSERT INTO oracle_fts (id, content, concepts) VALUES ('fts_2', 'Integration testing with Drizzle ORM', 'testing,drizzle')`);
    });

    test("FTS5 MATCH query", () => {
      const results = sqlite.query("SELECT id, content FROM oracle_fts WHERE oracle_fts MATCH ?").all("oracle") as any[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("FTS5 with porter stemming", () => {
      const results = sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH ?").all("tests") as any[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    test("FTS5 concept column search", () => {
      const results = sqlite.query("SELECT id FROM oracle_fts WHERE oracle_fts MATCH 'concepts:philosophy'").all() as any[];
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });
});
