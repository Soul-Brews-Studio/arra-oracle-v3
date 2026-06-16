# Export App

The export app gives operators a portable snapshot of Arra Oracle data. It can
dump local database collections in batch mode, export vector collections through
the HTTP/UI surface, and emit graph relationship data for preview or downstream
analysis.

## Connect To A Backend

The browser UI and `maw arra` API commands use the Arra Oracle backend URL.

```sh
export ORACLE_API=http://localhost:47778
maw arra health
maw arra frontend --no-open
```

The hosted or local frontend can also receive the backend URL in the page URL:

```text
https://studio.buildwithoracle.com/?api=http://localhost:47778
```

Local batch exports under `tools/export-app` read SQLite directly. Use `--db`
when the database is not at the default `ORACLE_DB_PATH` / configured data dir.
The core document exporter reads the legacy Oracle v2 `oracle_documents` plus
`oracle_fts` tables directly, so document Markdown preserves the original body
content while JSON keeps the full database metadata.

## Supported Formats

- JSON: structured records for automation and restore tooling.
- JSONL: newline-delimited vector records for streaming and large collections.
- CSV: spreadsheet-friendly rows with stable columns where available.
- Markdown / MD: readable knowledge snapshots and vault handoff files.

The vector HTTP exporter advertises formats from
`GET /api/v1/vector/export/formats`. The local batch exporter writes collection
files under `collections/` and a top-level relationship export.
When `/api/export/run` is pointed at a legacy Oracle v2 backend with
`oracleV2Url`, `format: "json"` writes the metadata dump and
`format: "markdown"` writes a readable document vault file, and
`format: "csv"` writes a spreadsheet review artifact.
The direct fallback download path is
`/api/v1/export/app?collection=oracle_documents&format=markdown`.

## Graph Export

Batch export builds graph relationships from document supersession, supersede
logs, and trace links. The output is written as `relationships.<ext>` beside
`all-collections.json` and `manifest.json`.

Each relationship has:

```ts
{ type: string; from: string; to: string; metadata?: Record<string, unknown> }
```

Use this data with the UI graph preview to inspect node labels and edge
connections before moving the export bundle elsewhere.

## Batch Mode

Batch mode exports all schema collections from a local readonly database
connection.

```sh
bun run tools/export-app/index.ts --output ./backup/export-app
bun run tools/export-app/index.ts --output ./backup/export-app --db ./oracle.db
bun run tools/export-app/index.ts --output ./backup/export-app --dry-run
bun run tools/export-app/index.ts --output ./backup/export-app --progress json
```

Use `--dry-run` to print collection, row, relationship, and document counts
without creating files. It is a safe preflight before long-running exports.

The batch output includes:

- `documents/markdown/<source-or-id>.md`
- `documents/json/<source-or-id>.json`
- `documents/documents.csv`
- `documents/index.json`
- `collections/<collection>.json`
- `collections/<collection>.csv`
- `collections/<collection>.md`
- `relationships.<ext>`
- `all-collections.json`
- `manifest.json`
- `manifest.schema.json`

`manifest.json` includes a `files` inventory with each artifact path, byte
count, and SHA-256 checksum so operators can verify the bundle before migration.
It also includes `collections.<table>.rowCount` so restore/preflight tooling can
compare source and destination collection sizes without loading every artifact.
Progress writes to stderr by default as collection counts, percentages, and row
counts. Use `--progress json` or `--progress-json` for machine-readable events,
`--progress silent` or `--quiet` when another wrapper owns progress display.

## CLI Usage

Use `maw arra export` for the operator-facing CLI bridge.

```sh
maw arra export --format json --out vault-export.json
maw arra export --format markdown --out vault.md
maw arra export --source vector --collection bge-m3 --format jsonl --out bge-m3.jsonl
maw arra export --source vector --collection bge-m3 --format csv --out bge-m3.csv
```

`maw arra export` resolves the repository through `ORACLE_ROOT` or `ghq locate`
and delegates to the repo CLI. Set `ORACLE_API` for backend-connected UI/API
commands; set `ORACLE_ROOT` when the local CLI should run from a specific clone.

### Standalone Remote CLI

Use the repo-local `bun run export` command when you need a portable export from
an Oracle v2-compatible HTTP backend without going through `maw`:

```sh
bun run export -- --url http://localhost:47778 \
  --collection oracle_documents \
  --format jsonl \
  --output ./backup/oracle_documents.jsonl
```

Format-specific examples:

```sh
bun run export -- --url http://localhost:47778 --collection oracle_documents --format json --output ./backup/docs.json
bun run export -- --url http://localhost:47778 --collection oracle_documents --format markdown --output ./backup/docs.md
bun run export -- --url http://localhost:47778 --collection oracle_documents --format jsonl --output ./backup/docs.jsonl
```

Useful flags:

- `--include-graph` / `--graph` includes relationship graph rows when the
  backend supports them.
- `--retries <count>` and `--retry-delay-ms <ms>` retry transient network,
  408, 429, and 5xx failures during export start or artifact download.
- `--version` / `-v` / `-V` prints the standalone export CLI version.
- `--help` / `-h` prints the complete flag reference.

Example with graph relationships and retry hardening:

```sh
bun run export -- --url http://localhost:47778 --collection oracle_documents \
  --format json --output ./backup/docs-with-graph.json \
  --graph --retries 3 --retry-delay-ms 500
```

## Recommended Flow

1. Point the UI or `maw arra` at the backend with `ORACLE_API`.
2. Check `/api/v1/health` or run `maw arra health`.
3. Review collection counts and estimated size in the UI.
4. Preview graph relationships when exporting a full bundle.
5. Run `maw arra export` for one collection or batch mode for full snapshots.

## UI Loading And Error States

The React export app is intentionally safe to use before a migration:

- **Loading collections** calls `GET /api/v1/export/app/collections` on the
  selected backend and disables the reload button while the request is active.
- **Backend errors** display the backend `error`, `message`, or nested
  `data.message` value when one is returned; invalid JSON is reported as a
  response-shape problem so operators do not mistake it for an empty export.
- **Empty collection lists** show a no-data state instead of enabling an export
  button against an unknown collection.
- **Older Oracle v2 backends** that do not implement `POST
  /api/v1/export/app/run` fall back to the direct download URL with the selected
  collection, format, graph, and metadata query parameters.

If the UI cannot reach the backend, verify the backend URL, check CORS/proxy
configuration, then retry loading collections before starting migration work.
