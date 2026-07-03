/**
 * Fresh-install regression test for issue #1111.
 *
 * Verifies that running drizzle's migrate() against an empty SQLite file
 * creates the FTS5 `oracle_fts` virtual table. Before migration 0017_fts5_bootstrap,
 * fresh installs that ran `bun db:migrate` (or any other migration runner that
 * does not boot the app) ended up without the FTS table — the indexer daemon
 * would then crash on getDocText() returning null.
 */
import { describe, test, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import * as schema from "../schema";

describe("fresh install (#1111)", () => {
	test("drizzle migrate() creates oracle_fts on empty DB", () => {
		const dir = mkdtempSync(join(tmpdir(), "oracle-fresh-"));
		const dbPath = join(dir, "test.db");
		const sqlite = new Database(dbPath);
		const db = drizzle(sqlite, { schema });

		const migrationsFolder = join(import.meta.dir, "../migrations");
		migrate(db, { migrationsFolder });

		const row = sqlite
			.prepare(
				"SELECT name FROM sqlite_master WHERE type='table' AND name='oracle_fts'",
			)
			.get() as { name: string } | undefined;

		expect(row?.name).toBe("oracle_fts");

		// Verify the table is actually queryable (not just registered)
		expect(() => {
			sqlite.exec("INSERT INTO oracle_fts(id, content, concepts) VALUES ('t1', 'hello world', 'greeting')");
		}).not.toThrow();

		const cnt = sqlite
			.prepare("SELECT COUNT(*) AS n FROM oracle_fts")
			.get() as { n: number };
		expect(cnt.n).toBe(1);

		sqlite.close();
		rmSync(dir, { recursive: true });
	});

	test("migration is idempotent — re-running migrate() does not fail", () => {
		const dir = mkdtempSync(join(tmpdir(), "oracle-rerun-"));
		const dbPath = join(dir, "test.db");
		const sqlite = new Database(dbPath);
		const db = drizzle(sqlite, { schema });
		const migrationsFolder = join(import.meta.dir, "../migrations");

		migrate(db, { migrationsFolder });
		// Second run should be a no-op (drizzle skips applied migrations)
		expect(() => migrate(db, { migrationsFolder })).not.toThrow();

		sqlite.close();
		rmSync(dir, { recursive: true });
	});
	test("query optimization indexes are installed on fresh DB", () => {
		const dir = mkdtempSync(join(tmpdir(), "oracle-indexes-"));
		const dbPath = join(dir, "test.db");
		const sqlite = new Database(dbPath);
		const db = drizzle(sqlite, { schema });
		const migrationsFolder = join(import.meta.dir, "../migrations");

		migrate(db, { migrationsFolder });
		const rows = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type='index'")
			.all() as Array<{ name: string }>;
		const names = rows.map((row) => row.name);

		expect(names).toContain("idx_documents_tenant_type_active_updated");
		expect(names).toContain("idx_search_tenant_created");
		expect(names).toContain("idx_thread_tenant_status_updated");
		expect(names).toContain("idx_memory_tenant_created");
		expect(names).toContain("idx_menu_path_studio");
		expect(names).toContain("idx_entity_links_tenant_key");
		expect(names).toContain("idx_entity_links_tenant_doc");
		expect(names).toContain("idx_pointer_tenant_kind_key");
		expect(names).toContain("idx_pointer_tenant_updated");

		sqlite.close();
		rmSync(dir, { recursive: true });
	});

	test("bi-temporal valid_time column is installed on fresh DB", () => {
		const dir = mkdtempSync(join(tmpdir(), "oracle-valid-time-"));
		const dbPath = join(dir, "test.db");
		const sqlite = new Database(dbPath);
		const db = drizzle(sqlite, { schema });
		const migrationsFolder = join(import.meta.dir, "../migrations");

		migrate(db, { migrationsFolder });
		const columns = sqlite.prepare("PRAGMA table_info(oracle_documents)").all() as Array<{ name: string }>;
		const indexes = sqlite
			.prepare("SELECT name FROM sqlite_master WHERE type='index'")
			.all() as Array<{ name: string }>;

		expect(columns.map((row) => row.name)).toContain("valid_time");
		expect(indexes.map((row) => row.name)).toContain("idx_documents_tenant_valid_time");

		sqlite.close();
		rmSync(dir, { recursive: true });
	});

});
