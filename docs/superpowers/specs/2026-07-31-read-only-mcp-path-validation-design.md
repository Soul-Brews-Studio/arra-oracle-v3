# Read-only MCP path validation design

## Goal

Allow Arra's stdio MCP server to start against an existing read-only Oracle data store while preserving the current writable-path requirements for every write-capable startup.

## Current failure

`src/index.ts` recognizes `ORACLE_READ_ONLY=true` and hides non-read-only tools, but two lower layers still assume write access:

1. `validateEnv()` always calls writable path checks, so startup exits before MCP initialization in a managed sandbox where `~/.arra-oracle-v2` is readable but not writable.
2. `OracleMCPServer.initEmbedded()` opens SQLite through `createDatabase()` without forwarding its read-only state, so read tools fail with `attempt to write a readonly database` even after path validation succeeds.

## Design

Path validation derives its required access mode from `ORACLE_READ_ONLY`:

- read-only mode validates existing data directories, database paths, repo roots, and local vector paths with `R_OK`;
- write-capable mode retains `W_OK` and the existing nearest-writable-parent behavior for paths that do not exist yet;
- shape checks remain unchanged: directory settings must name directories and file settings must not name directories;
- a missing read-only path is invalid because the server cannot create it in read-only mode.

The embedded database seam also forwards the same read-only state through `createDatabase()` to the existing `StorageBackendOptions.readonly` support. Write-capable startup keeps the current default. Tool classification, sandbox policy, database bytes, vector configuration, and write-mode behavior remain unchanged.

## Verification

1. A regression test creates a readable directory with no write bits and proves read-only validation accepts it.
2. The paired write-mode assertion proves the same path is rejected as non-writable.
3. An embedded-server regression test proves `readOnly: true` reaches the database factory as `readonly: true`.
4. Existing config and MCP initialization tests remain green.
5. The real MCP server starts with `ORACLE_READ_ONLY=true` against `~/.arra-oracle-v2` and passes MCP tool discovery plus `oracle_stats` and `oracle_search` calls.
6. Codex registers the server as `arra-oracle`; a fresh nested Codex process discovers and calls the tools.

## Rollback

Revert the validator, embedded database forwarding, and their regression tests, then remove the Codex registration with `codex mcp remove arra-oracle`.
