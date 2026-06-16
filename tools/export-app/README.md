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
`format: "markdown"` writes a readable document vault file.

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
```

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
