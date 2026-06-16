# FAQ

## What is Arra Oracle V3?

Arra Oracle V3 is the Oracle-family memory, search, MCP, and HTTP layer. It
stores and searches project knowledge, exposes MCP tools, and is being shaped so
capabilities can be installed like plugins instead of editing the core engine.

## Which install path should I use?

Use the global Bun install path for local operators and agents. Use Docker or
Docker MCP Toolkit when you need isolated runtime packaging. Use a source clone
only when contributing code.

## What command starts the server?

For a local source checkout, run `bun run server`. For an installed package, use
`arra-oracle-v3 serve` or the command shown by `arra-oracle-v3 --help`.

## What is `arra` vs `arra-oracle-v3`?

`arra` is the short operator CLI. `arra-oracle-v3` is the package binary and is
useful when validating installation or starting the packaged server directly.

## Does Arra require vector search?

No. Vector adapters improve recall, comparison, and map views, but keyword/FTS
paths and many HTTP/MCP surfaces still work while vector services are offline.
Use `/api/vector/health` to check adapter status.

## Where is data stored?

Local installs use the configured Oracle data directory and SQLite-backed state.
Docker installs should mount a persistent volume. Treat exported Markdown/JSON as
portable recovery material and re-index when adapters change.

## How do I connect an MCP client?

For embedded mode, leave `ORACLE_HTTP_URL` unset. For HTTP-proxy mode, set
`ORACLE_HTTP_URL=http://localhost:47778`. Always set `ORACLE_LOG_TARGET=stderr`
so MCP stdout stays valid JSON-RPC.

## How do I install plugins?

Install or copy a plugin directory with a valid `plugin.json` manifest into the
configured plugin path, then restart or reload the server. Confirm registration
with `/api/plugins`, `/api/menu`, and `/api/mcp/tools`.

## Why do docs and PRs target alpha?

`alpha` is the working trunk. `main` is reserved for stable releases, so feature,
fix, and docs PRs should target `alpha` unless the maintainer explicitly says
otherwise.

## Can I run multi-tenant?

Yes. Tenant-aware HTTP routes honor `X-Oracle-Tenant` and optional
`X-Oracle-Tenant-Token`. Use tenant headers consistently for reads, writes,
imports, and indexing jobs so data remains isolated.

## What API docs should I read first?

Start with [API-REFERENCE-INDEX.md](./API-REFERENCE-INDEX.md). It points to the
Swagger UI, OpenAPI JSON, route inventory, and deeper API notes.

## Where do UI screenshots go?

Post UI screenshots to the relevant GitHub issue or PR comment. Keep docs under
`docs/` and do not store docs or screenshots in unrelated private folders.
