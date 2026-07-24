import { drizzle, type BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { Database } from "bun:sqlite";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema.ts";

const MIGRATIONS_FOLDER = path.join(import.meta.dir, "migrations");

export type AppDatabase = BunSQLiteDatabase<typeof schema>;

export function createDatabase(dbPath: string): { sqlite: Database; db: AppDatabase } {
  const isMemory = dbPath === ":memory:";
  if (!isMemory) {
    const dir = path.dirname(dbPath);
    if (dir !== "." && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(dbPath);
  if (!isMemory) {
    sqlite.exec("PRAGMA journal_mode = WAL");
    sqlite.exec("PRAGMA busy_timeout = 5000");
  }

  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

  return { sqlite, db };
}

export * from "./schema.ts";
