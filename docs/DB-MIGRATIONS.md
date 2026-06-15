# Database migration workflow

Arra uses Drizzle as the source of truth for managed SQLite tables.
Schema changes must flow through `src/db/schema.ts`, generated migrations in
`src/db/migrations/`, and the Drizzle config in `drizzle.config.ts`.

## Configuration

`drizzle.config.ts` is the canonical drizzle-kit config:

- `schema`: `./src/db/schema.ts`
- `out`: `./src/db/migrations`
- `dialect`: `sqlite`
- DB path: `ORACLE_DB_PATH`, or `${ORACLE_DATA_DIR}/oracle.db`, or
  `~/.oracle/oracle.db`
- `tablesFilter`: managed app tables only; FTS5 support stays in migrations.

## Change workflow

1. Edit `src/db/schema.ts` with Drizzle ORM table/index definitions.
2. Generate a migration:

   ```bash
   bun db:generate
   ```

   Use a descriptive name when helpful:

   ```bash
   bun run db:generate -- --name add_example_column
   ```

3. Review the generated SQL before commit. It must be safe for an existing DB
   and a fresh DB. Do not add runtime raw SQL in `src/db/*` or `src/storage/*`.
4. Keep generated files reviewable. If a generated snapshot is huge, minify the
   JSON snapshot after generation; drizzle-kit reads valid JSON either way.
5. Verify a fresh DB can be created from the current schema:

   ```bash
   tmp=$(mktemp -d /tmp/arra-db-push-XXXXXX)
   ORACLE_DATA_DIR="$tmp" ORACLE_DB_PATH="$tmp/oracle.db" bun db:push
   ```

6. Verify committed SQL migrations can replay from empty state:

   ```bash
   tmp=$(mktemp -d /tmp/arra-db-migrate-XXXXXX)
   ORACLE_DATA_DIR="$tmp" ORACLE_DB_PATH="$tmp/oracle.db" bun db:migrate
   ```

7. Run the normal gates before opening a PR:

   ```bash
   bun run build
   bun test --isolate tests/storage/
   ```

## Snapshot alignment migrations

Migrations `0008` through `0017` existed as SQL before matching Drizzle snapshot
metadata was committed. Migration `0018_volatile_jimmy_woo.sql` is therefore a
no-op alignment migration: its snapshot records the current schema so future
`bun db:generate` runs diff from the right baseline, while `SELECT 1;` keeps the
CLI migrator happy on fresh replay.
