import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";

const tmp = mkdtempSync(join(tmpdir(), "arra-unified-menu-db-"));
const previousDbPath = process.env.ORACLE_DB_PATH;
const previousDataDir = process.env.ORACLE_DATA_DIR;
let closeDb: (() => void) | undefined;

afterAll(() => {
  closeDb?.();
  if (previousDbPath === undefined) delete process.env.ORACLE_DB_PATH;
  else process.env.ORACLE_DB_PATH = previousDbPath;
  if (previousDataDir === undefined) delete process.env.ORACLE_DATA_DIR;
  else process.env.ORACLE_DATA_DIR = previousDataDir;
  rmSync(tmp, { recursive: true, force: true });
});

describe("seedUnifiedPluginMenuItems", () => {
  test("uses Drizzle to insert, update, and skip owned rows", async () => {
    process.env.ORACLE_DATA_DIR = tmp;
    process.env.ORACLE_DB_PATH = join(tmp, "oracle.db");
    const { seedUnifiedPluginMenuItems } = await import("../../src/plugins/unified-loader.ts");
    const dbModule = await import("../../src/db/index.ts");
    const { db, menuItems } = dbModule;
    closeDb = dbModule.closeDb;
    const now = new Date();

    await seedUnifiedPluginMenuItems([
      { plugin: "demo", label: "Inserted", path: "/plugin-insert", group: "tools", order: 7 },
      { plugin: "demo", label: "Old", path: "/plugin-update" },
    ]);
    db.insert(menuItems).values({
      path: "/custom-owned",
      label: "Custom",
      groupKey: "tools",
      position: 1,
      enabled: true,
      access: "public",
      source: "custom",
      createdAt: now,
      updatedAt: now,
    }).run();

    await seedUnifiedPluginMenuItems([
      { plugin: "demo", label: "Updated", path: "/plugin-update", group: "main", order: 2, icon: "spark" },
      { plugin: "demo", label: "Skipped", path: "/custom-owned" },
    ]);

    const inserted = db.select().from(menuItems).where(eq(menuItems.path, "/plugin-insert")).get();
    const updated = db.select().from(menuItems).where(eq(menuItems.path, "/plugin-update")).get();
    const skipped = db.select().from(menuItems).where(eq(menuItems.path, "/custom-owned")).get();
    expect(inserted).toMatchObject({ label: "Inserted", groupKey: "tools", position: 7, source: "plugin" });
    expect(updated).toMatchObject({ label: "Updated", groupKey: "main", position: 2, icon: "spark" });
    expect(skipped).toMatchObject({ label: "Custom", source: "custom" });
  });
});
