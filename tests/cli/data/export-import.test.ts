import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runCli, tryParseJson } from "../_run.ts";

const savedDataDir = process.env.ORACLE_DATA_DIR;
const savedDbPath = process.env.ORACLE_DB_PATH;

async function openDataDb(dbPath: string) {
  const mod = await import("../../../src/db/index.ts");
  const connection = mod.createDatabase(dbPath);
  return { connection, oracleDocuments: mod.oracleDocuments };
}

async function seedDocument(dbPath: string) {
  const { connection, oracleDocuments } = await openDataDb(dbPath);
  const now = Date.now();
  connection.db.insert(oracleDocuments).values({
    id: "export-import-doc",
    type: "learning",
    sourceFile: "ψ/learnings/export-import.md",
    concepts: JSON.stringify(["export", "import"]),
    createdAt: now,
    updatedAt: now + 1,
    indexedAt: now + 2,
    origin: "human",
    project: "github.com/soul-brews-studio/arra-oracle-v3",
    createdBy: "test",
  }).run();
  connection.storage.close();
}

async function loadDocument(dbPath: string) {
  const { connection, oracleDocuments } = await openDataDb(dbPath);
  const row = connection.db.select().from(oracleDocuments)
    .where(eq(oracleDocuments.id, "export-import-doc")).get();
  connection.storage.close();
  return row;
}

async function clearDocuments(dbPath: string) {
  const { connection, oracleDocuments } = await openDataDb(dbPath);
  connection.db.delete(oracleDocuments).run();
  connection.storage.close();
}

describe("data export/import CLI", () => {
  let root: string;
  let env: Record<string, string>;
  let dbPath: string;

  beforeEach(async () => {
    root = join(tmpdir(), `arra-data-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(root, { recursive: true });
    dbPath = join(root, "oracle.db");
    process.env.ORACLE_DATA_DIR = root;
    process.env.ORACLE_DB_PATH = dbPath;
    env = { HOME: join(root, "home"), ORACLE_DATA_DIR: root, ORACLE_DB_PATH: dbPath };
    const mod = await import("../../../src/db/index.ts");
    mod.resetDefaultDatabaseForTests(dbPath);
  });

  afterEach(async () => {
    const mod = await import("../../../src/db/index.ts");
    if (savedDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
    else process.env.ORACLE_DATA_DIR = savedDataDir;
    if (savedDbPath === undefined) delete process.env.ORACLE_DB_PATH;
    else process.env.ORACLE_DB_PATH = savedDbPath;
    mod.resetDefaultDatabaseForTests(":memory:");
    rmSync(root, { recursive: true, force: true });
  });

  test("round-trips vault documents through JSON", async () => {
    const outFile = join(root, "vault-export.json");
    await seedDocument(dbPath);

    const exported = await runCli(["export", "--format", "json", "--out", outFile], env);
    expect(exported.code).toBe(0);
    const payload = tryParseJson(readFileSync(outFile, "utf8")) as { tables?: { oracleDocuments?: Array<{ id: string }> } } | null;
    expect(payload?.tables?.oracleDocuments?.map((doc) => doc.id)).toContain("export-import-doc");

    await clearDocuments(dbPath);
    expect(await loadDocument(dbPath)).toBeUndefined();

    const imported = await runCli(["import", "--format", "json", "--in", outFile], env);
    expect(imported.code).toBe(0);
    expect(tryParseJson(imported.stdout)).toEqual({ imported: 1 });

    const restored = await loadDocument(dbPath);
    expect(restored?.sourceFile).toBe("ψ/learnings/export-import.md");
    expect(restored?.concepts).toBe(JSON.stringify(["export", "import"]));
    expect(restored?.createdBy).toBe("test");
  }, 20_000);
});
