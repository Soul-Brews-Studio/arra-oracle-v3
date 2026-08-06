# #1598 Hermes Agent desktop architecture review for ARRA

Date: 2026-06-17  
Reviewer: codex-3  
Hermes source reviewed: `NousResearch/hermes-agent@d1ecebcbfd8c7f2b942fd9cc425cea028e34111c`  
ARRA baseline reviewed: `origin/alpha@d9d0d9a2a831e48e162e1f736f248b60cee67225`

## Scope and sources

This is an implementation-oriented addendum to the existing #1598 research. It
focuses on what ARRA should copy, adapt, or avoid before treating Hermes Desktop
as a reference architecture.

Primary sources:

- Hermes Desktop docs: <https://hermes-agent.nousresearch.com/docs/user-guide/desktop>
- Hermes architecture docs: <https://hermes-agent.nousresearch.com/docs/developer-guide/architecture>
- Hermes MCP reference: <https://hermes-agent.nousresearch.com/docs/reference/mcp-config-reference>
- Hermes desktop package: <https://github.com/NousResearch/hermes-agent/blob/d1ecebcbfd8c7f2b942fd9cc425cea028e34111c/apps/desktop/package.json>
- Hermes desktop supervisor: <https://github.com/NousResearch/hermes-agent/blob/d1ecebcbfd8c7f2b942fd9cc425cea028e34111c/apps/desktop/electron/main.cjs>
- Hermes hardening helpers: <https://github.com/NousResearch/hermes-agent/blob/d1ecebcbfd8c7f2b942fd9cc425cea028e34111c/apps/desktop/electron/hardening.cjs>
- Hermes backend readiness parser: <https://github.com/NousResearch/hermes-agent/blob/d1ecebcbfd8c7f2b942fd9cc425cea028e34111c/apps/desktop/electron/backend-ready.cjs>
- ARRA files checked: `frontend/src-tauri/src/lib.rs`,
  `frontend/src-tauri/tauri.conf.json`, `frontend/src/components/BackendGate.tsx`,
  `src/server.ts`, `src/config.ts`, `src/mcp/client.ts`,
  `src/plugins/unified-manifest.ts`.

## Hermes structure worth learning from

Hermes Desktop is not a separate product brain. It is a native shell around the
same local agent runtime used by CLI, dashboard, and gateway surfaces.

- **Shell:** Electron + React/Vite, packaged by `electron-builder` for DMG/zip,
  NSIS/MSI, AppImage/deb/rpm. `apps/bootstrap-installer/` is Tauri, but it is a
  bootstrap installer path, not the main daily desktop shell.
- **Runtime boundary:** the packaged app ships a shell, resolves or installs the
  Hermes runtime under `HERMES_HOME`, then launches the local dashboard backend.
- **Readiness:** Electron starts the backend on `127.0.0.1` with `--port 0` and
  waits for stdout like `HERMES_DASHBOARD_READY port=<N>` before connecting the
  renderer to the actual ephemeral port.
- **Auth:** the dashboard injects a per-server session token and gates API routes
  with it. Desktop also handles remote gateway tokens through OS secure storage.
- **Local-first state:** `HERMES_HOME` is shared across desktop, CLI, dashboard,
  sessions, plugins, logs, and update/repair flows.
- **MCP:** MCP servers are backend/CLI-owned config, not renderer-local state.
  Hermes supports catalog entries, install/probe flows, and per-server tool
  filters.
- **Plugins:** plugin YAML and Python modules register tools, hooks, dashboard
  components, and related surfaces. The useful idea for ARRA is capability
  provenance, not the imperative Python API shape.
- **Hardening:** desktop-specific helpers cover secret encryption, URL/token
  validation, path containment, and many platform-specific process/update tests.

## Current ARRA baseline

ARRA already has the better default host for this repo: **Tauri 2 + Bun/Elysia**.

- `frontend/src-tauri/tauri.conf.json` builds the existing Vite frontend, bundles
  a native app, and allows localhost API/WebSocket connections.
- `frontend/src-tauri/src/lib.rs` autostarts `bun run server`, owns tray actions,
  exposes `start_backend`, `stop_backend`, `get_backend_url`, and `health_check`.
- `BackendGate.tsx` already separates browser health checks from Tauri `invoke()`
  checks and provides a backend-start UX.
- `src/server.ts` is the correct product boundary: Elysia route composition,
  middleware, plugin route registration, startup self-test, and graceful shutdown.
- `ORACLE_DATA_DIR` in `src/config.ts` is ARRA's equivalent to `HERMES_HOME`.
- `src/mcp/client.ts` is still a one-shot stdio client. It is useful, but it is
  not yet a persistent MCP registry/catalog with status, logs, and allow-lists.
- `src/plugins/unified-manifest.ts` is a safer extension contract than Hermes'
  imperative plugin API, but it is already near the 250-line file limit.

## Recommendation

Keep ARRA Desktop as a thin Tauri supervisor over the Bun/Elysia backend.

```text
[Tauri shell]
  owns: native window/tray, backend process lifecycle, OS keychain, dialogs,
        logs, updates/repair, diagnostics, and narrow IPC commands

[Bun/Elysia backend]
  owns: routes, auth, MCP registry, plugins, vector/indexer config, database,
        tenants, sessions, exports, and ORACLE_DATA_DIR state

[React renderer]
  owns: UI state only; calls Elysia APIs plus narrow Tauri commands
```

Do not switch to Electron only because Hermes uses it. Hermes carries Python +
Node/Electron runtime constraints and benefits from bundled Chromium. ARRA is
already TypeScript/Bun with a working Tauri scaffold, so Electron would add size
and another runtime without solving the current gaps.

## Gaps and proposed sequence

### P0: lifecycle and security contract

1. **Split the Tauri supervisor before adding behavior.** `lib.rs` is 244 lines;
   move backend lifecycle, tray/menu, commands, paths, health, and logs into
   small modules before the next desktop feature.
2. **Replace fixed port `47778`.** Add a backend startup contract that supports
   `ORACLE_PORT=0` or `--port 0` and emits a parseable ready line such as
   `ORACLE_READY port=<N>`.
3. **Add a per-launch desktop token.** The shell should inject backend URL/token
   into the renderer and the backend should require it for desktop-mode local
   API calls. Treat it as a local capability, not user identity.
4. **Remove shell `curl` from health checks.** Implement Rust HTTP/TCP probing
   and return structured health with reachability, status, backend URL, pid, and
   error code.
5. **Keep desktop process ownership explicit.** If a port is already occupied,
   distinguish “ARRA child process” from “unknown local process” before trusting
   it or using its token.

### P1: backend-owned integration surfaces

1. **Build an MCP registry service.** Persist MCP server config under
   `ORACLE_DATA_DIR`, support stdio and HTTP/SSE transports, expose status/logs,
   and allow per-server include/exclude filters.
2. **Keep plugin provenance visible.** Every API route, MCP tool, menu item,
   CLI command, export format, and sidecar server should explain which plugin or
   manifest provided it.
3. **Add a hardened IPC layer.** Tauri commands should enforce path containment,
   sensitive-file denies (`.env`, SSH/GPG/AWS creds, keys/certs), file-size
   limits, and structured renderer-facing errors.
4. **Add desktop diagnostics.** Create a bounded bundle with desktop log,
   backend log, plugin summary, vector config summary, MCP status, and recent
   startup errors.

### P2: packaging and operations

1. Use Tauri bundle targets as the default installer path.
2. Add CI that at least builds the frontend and Tauri Rust code; add matrix
   packaging once P0 lifecycle is stable.
3. Add macOS notarization and Windows signing only after process teardown and
   update/repair are reliable on all target platforms.
4. Keep browser/PWA mode working. Desktop should enhance the same backend, not
   fork the UI or product state.

## What not to copy from Hermes

- Do not copy the large Electron `main.cjs` shape into ARRA. Copy the boundary,
  but keep modules small enough for this repository's file-size convention.
- Do not make the renderer or desktop shell the source of truth for MCP, vector,
  plugin, or tenant config.
- Do not replace ARRA's `UnifiedPluginManifest` with imperative plugin modules.
  Borrow provenance and lifecycle checks instead.
- Do not ship auto-update before reliable process ownership, log capture, and
  rollback/repair are in place.

## Acceptance checks for the next implementation slice

- `frontend/src-tauri/src/lib.rs` is reduced to builder wiring and command
  registration.
- Desktop can start two independent ARRA backends without fixed-port collision.
- Renderer receives backend URL and desktop token through a narrow IPC command.
- `/api/health` or a desktop status endpoint reports startup phase and token
  state clearly enough for `BackendGate.tsx` to show actionable errors.
- MCP/plugin settings remain editable from backend APIs and are shared by CLI,
  web, desktop, and MCP server surfaces.

## Bottom line

Hermes is the right reference for **desktop host responsibilities**: bootstrap,
readiness, local-first continuity, secure token handling, diagnostics, and
backend-owned MCP/plugin state. For ARRA, the equivalent architecture should stay
Tauri + Bun/Elysia, with the desktop shell acting as a small, hardened supervisor
around one canonical local backend and one canonical `ORACLE_DATA_DIR`.
