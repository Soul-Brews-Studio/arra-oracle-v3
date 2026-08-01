# Read-only MCP path validation design

## Goal

Allow Arra's stdio MCP server to start against an existing read-only Oracle data store while preserving the current writable-path requirements for every write-capable startup.

## Current failure

`src/index.ts` recognizes `ORACLE_READ_ONLY=true` and hides non-read-only tools, but `validateEnv()` always calls writable path checks first. In a managed Codex sandbox where `~/.arra-oracle-v2` is readable but not writable, startup exits before MCP initialization even though `oracle_search`, `oracle_read`, `oracle_list`, and `oracle_stats` only need read access.

## Design

Path validation derives its required access mode from `ORACLE_READ_ONLY`:

- read-only mode validates existing data directories, database paths, repo roots, and local vector paths with `R_OK`;
- write-capable mode retains `W_OK` and the existing nearest-writable-parent behavior for paths that do not exist yet;
- shape checks remain unchanged: directory settings must name directories and file settings must not name directories;
- a missing read-only path is invalid because the server cannot create it in read-only mode.

The change stays inside `src/config/validate.ts`. It does not modify storage behavior, tool classification, sandbox policy, database bytes, vector configuration, or write-mode defaults.

## Verification

1. A regression test creates a readable directory with no write bits and proves read-only validation accepts it.
2. The paired write-mode assertion proves the same path is rejected as non-writable.
3. Existing config validation tests remain green.
4. The real MCP server starts with `ORACLE_READ_ONLY=true` against `~/.arra-oracle-v2` and passes MCP tool discovery plus `oracle_stats` and `oracle_search` calls.
5. Codex registers the server as `arra-oracle`; a fresh nested Codex process discovers and calls the tools.

## Rollback

Revert the validator and regression-test change, then remove the Codex registration with `codex mcp remove arra-oracle`.
