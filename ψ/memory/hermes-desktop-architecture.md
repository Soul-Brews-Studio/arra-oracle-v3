# Hermes Desktop Architecture Review for arra-oracle-v3

Issue: #1598  
Date: 2026-06-16  
Purpose: turn Hermes Agent Desktop research into an ARRA Oracle V3 design reference.

## Executive recommendation

Hermes validates a **thin desktop host over one shared local runtime**. ARRA should not copy Hermes wholesale. ARRA should first harden the existing Bun/Elysia HTTP runtime and React Studio, then add a Tauri 2 desktop shell that launches and supervises that runtime.

Recommended target:

```text
[Tauri shell]
  -> resolve ARRA_HOME, token, profile, logs
  -> spawn `maw arra serve --port 0 --json-ready`
  -> wait for /api/v1/health and vector/plugin readiness
  -> load bundled Studio or localhost Studio
  -> expose restart, logs, diagnostics, import/export, notifications
```

Use Electron only if ARRA later needs bundled Chromium consistency, deep PTY panes, or Hermes-style heavy desktop surfaces that Tauri cannot support cleanly.

## Hermes reference model

Hermes is a multi-surface agent runtime with a desktop shell, not a desktop-only product.

- Desktop shell: Electron + React/Vite.
- Bootstrap installer: separate Tauri 2 setup path.
- Backend: Python/FastAPI dashboard/runtime spawned on loopback.
- Startup contract: shell picks an ephemeral port, passes a session token, waits for backend-ready output, then loads the renderer.
- State root: `HERMES_HOME` for config, sessions, logs, memories, MCP installs, plugins, and bootstrap metadata.
- Auth: local loopback session token; public binding requires stronger dashboard auth; websocket access uses short-lived tickets.
- MCP: backend/CLI-owned catalog and config, surfaced in UI with install-time tool selection.
- Packaging: Electron Builder for macOS/Windows/Linux; signing/notarization paths; custom runtime updater.

## Current ARRA anchors to preserve

ARRA already has the better core shape for this repo:

- Bun/TypeScript/Elysia server in `src/server.ts` and `src/routes/`.
- React/Vite Studio in `frontend/`.
- SQLite/Drizzle schema in `src/db/schema.ts`.
- Vector/search/indexing core in `src/vector/`, `src/indexer/`, and `src/tools/`.
- Unified plugin manifest and loader in `src/plugins/`.
- Versioned HTTP surface under `/api/v1/*` with backward-compatible `/api/*` support.

Do not move MCP, search, vector, memory, indexing, or plugin behavior into a desktop renderer. The desktop should be a launcher, supervisor, and native integration layer.

## Hermes patterns ARRA should adopt

### 1. Health-gated startup

Desktop should never show a half-dead Studio. The host should render boot state, logs, repair actions, and precise failures while waiting for:

- server health;
- database readiness;
- vector backend readiness;
- plugin registry load;
- indexer job state;
- auth/session token availability.

### 2. One local data root

Formalize `ARRA_HOME` as the desktop data root for:

- SQLite and WAL files;
- vector metadata and collections;
- plugin manifests and server logs;
- `ψ/memory` exports/imports;
- config, profiles, and tenant context;
- diagnostics bundles.

This mirrors `HERMES_HOME` while staying aligned with ARRA’s existing local-first model.

### 3. Loopback auth boundary

For desktop-local calls:

```text
Shell generates local session token
  -> spawns Bun server with token/env
  -> renderer calls 127.0.0.1:<port> with X-Oracle-Session
  -> server rejects missing/invalid desktop token
  -> remote/public mode uses normal API-token auth
```

Keep desktop-local auth separate from API keys used by remote clients and MCP peers.

### 4. Observable subprocesses

Hermes treats external tools as supervised, logged, degraded components. ARRA should do the same for plugin server surfaces, external MCP servers, vector backends, and indexer workers:

- per-component status;
- bounded startup timeouts;
- stderr/log capture;
- restart/stop controls;
- credential redaction;
- support bundle export.

### 5. MCP catalog and capability UX

Hermes’ MCP install/catalog flow is a strong operator pattern. ARRA’s stricter unified manifests should add:

- plugin/tool provenance;
- declared capabilities by surface: HTTP, MCP, CLI, menu, server, hook;
- enable/disable per plugin and per surface;
- visible tool inclusion/exclusion;
- status for remote MCP and local stdio servers.

### 6. Studio as operator console

Hermes validates the direction of ARRA Studio: bento cards, command palette, previews, status rail, and activity HUD. Near-term Studio should expose:

- runtime readiness;
- vector provider and index status;
- plugin capability inventory;
- memory/search diagnostics;
- recent jobs and failures;
- “copy diagnostics” action.

## Patterns not to copy

- Do not default to Electron while ARRA can stay Bun-native and lightweight.
- Do not introduce a second backend stack for desktop.
- Do not adopt broad heuristic plugin discovery; keep manifest declarations explicit.
- Do not make desktop packaging block core server, MCP, or search work.
- Do not store secrets in renderer state or expose broad filesystem IPC.
- Do not replace ARRA’s vector/FTS/indexer with Hermes-like session memory.

## Proposed ARRA roadmap

### Phase 0 — web/server readiness

- Stabilize `maw arra serve` as the one server lifecycle command.
- Add `--port 0 --json-ready` output for launcher integration.
- Add readiness cards in Studio backed by health, vector, plugins, and indexer endpoints.
- Add diagnostics bundle command/endpoint with redacted config and log tails.

### Phase 1 — Tauri launcher prototype

- Spawn the Bun server on loopback with a local session token.
- Wait for health before loading Studio.
- Add native menu items for restart, open logs, open data dir, copy diagnostics.
- Keep all application behavior behind the existing HTTP API.

### Phase 2 — desktop-safe operations

- Add secure token storage for remote gateway credentials.
- Add native file dialogs for import/export and vault selection.
- Add OS notifications for indexing completion and plugin failures.
- Add safe process teardown before updates.

### Phase 3 — distribution

- Decide whether to bundle Bun or require system Bun.
- Align updater channels with ARRA alpha/stable release policy.
- Add signing/notarization and platform-specific installer checks.
- Keep CLI/web install path available for developers.

## Open decisions

1. Bundle Bun sidecar or require an installed Bun runtime?
2. Serve Studio from bundled Tauri assets or from Bun/Elysia static output?
3. Should desktop-local token auth be middleware-only or integrated with API key scopes?
4. How should tenant/profile context map to `ARRA_HOME` and SQLite/vector paths?
5. What update mechanism fits alpha prerelease cadence without unsafe self-modification?

## Final design stance

Use Hermes as a reference for **agent host ergonomics**: bootstrap, health-gated startup, profile-aware local state, MCP catalog UX, plugin provenance, logs, diagnostics, and safe subprocess management. Keep ARRA’s product identity as a Bun/Elysia **Oracle memory/search MCP backend** with a React Studio operator console. Native desktop should be a thin Tauri launcher and supervisor after the server and web surfaces are stable.
