# Read-only MCP Path Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Arra's read-only stdio MCP server start against a readable, non-writable Oracle data store and expose it to Codex.

**Architecture:** Derive a single path access mode from `ORACLE_READ_ONLY` during environment validation. Reuse the existing path-shape checks, but require existing readable paths in read-only mode and preserve current writable/creatable-path behavior in write mode.

**Tech Stack:** Bun, TypeScript, `node:fs`, MCP stdio, Codex `config.toml`.

## Global Constraints

- Write-capable startup must remain fail-closed when data, database, repo-root, or local-vector paths are not writable.
- Read-only startup must not create data paths or advertise write tools.
- No database, vector index, dependency, or sandbox-policy changes.

---

### Task 1: Lock the read-only path contract

**Files:**
- Modify: `tests/config/validate.test.ts`
- Modify: `src/config/validate.ts`

**Interfaces:**
- Consumes: `validateEnv({ env, emitOptionalWarnings })`
- Produces: access-aware validation selected by `ORACLE_READ_ONLY=true`

- [ ] **Step 1: Write the failing regression test**

Add a test that creates an Oracle data directory and database file, removes write bits, then asserts read-only validation succeeds and write-capable validation throws a writable-path error. Restore permissions in `finally` so cleanup remains possible.

- [ ] **Step 2: Run the focused test to verify RED**

Run: `bun test tests/config/validate.test.ts --test-name-pattern 'read-only startup accepts readable non-writable paths'`

Expected: FAIL because `validateWritablePath()` always requires `W_OK`.

- [ ] **Step 3: Implement the minimal validator change**

Compute `const readOnly = env.ORACLE_READ_ONLY?.trim().toLowerCase() === 'true'` in `validateEnv()`. Pass the flag to runtime and vector path validation. Replace the write-only helper with an access-aware helper that uses `R_OK` for existing paths in read-only mode, reports missing read-only paths, and preserves existing `W_OK`/nearest-parent logic otherwise.

- [ ] **Step 4: Verify GREEN and regressions**

Run:

```bash
bun test tests/config/validate.test.ts
bun run build
```

Expected: all config tests pass and TypeScript reports no errors.

### Task 2: Prove the real stdio MCP seam

**Files:**
- No production-file changes expected.

**Interfaces:**
- Consumes: `src/index.ts`, `ORACLE_READ_ONLY=true`, `ORACLE_DATA_DIR=~/.arra-oracle-v2`
- Produces: MCP initialization, tool list, stats response, search response

- [ ] **Step 1: Run the repository MCP integration test**

Run `MCP_TEST=1 ORACLE_READ_ONLY=true ORACLE_DATA_DIR="$HOME/.arra-oracle-v2" bun test src/integration/mcp.test.ts`.

Expected: discovery includes `oracle_search`, `oracle_list`, and `oracle_stats`; all read-only cases pass.

- [ ] **Step 2: Confirm write tools are absent**

Inspect the tool list from a stdio client and verify non-read-only tools such as `oracle_learn` are not advertised.

### Task 3: Register and smoke-test Codex

**Files:**
- Modify via supported CLI: `~/.codex/config.toml`

**Interfaces:**
- Consumes: absolute Bun and Arra entrypoint paths plus `ORACLE_DATA_DIR`, `ORACLE_READ_ONLY`, and deterministic `PATH`
- Produces: enabled Codex MCP server named `arra-oracle`

- [ ] **Step 1: Add the server through Codex CLI**

Run `codex mcp add arra-oracle` with the absolute local launcher and environment values.

- [ ] **Step 2: Verify declared registration**

Run `codex mcp get arra-oracle --json` and `codex mcp list`.

- [ ] **Step 3: Verify observed tool calls**

Launch a fresh non-interactive Codex process that calls `oracle_stats` and `oracle_search` and records the returned document count and at least one result.

- [ ] **Step 4: Run final safeguards**

Run the Arra focused tests, build, Codex discovery, and Riddler strict-profile filesystem smoke test. Report any restart requirement for the already-open desktop thread separately from fresh-process readiness.
