# Hermes Agent Desktop Design Reference for ARRA Oracle

Issue: #1598
Date: 2026-06-17
Scope: architecture review and design guidance only; no implementation.

## Decision Summary

Use Hermes as a reference for **desktop host responsibilities**, not as a stack
template. ARRA should keep its current Tauri + Bun/Elysia direction and avoid an
Electron rewrite unless a later product requirement needs bundled Chromium or
heavy PTY/xterm integration.

Target architecture:

```text
[Tauri desktop host]
  owns: native window/tray/menu, backend process lifecycle, secure storage,
        file dialogs, logs, diagnostics, updates, narrow IPC

[Bun/Elysia backend]
  owns: HTTP API, MCP server/client state, vector config, search/indexing,
        plugins, auth, database, ORACLE_DATA_DIR

[React Studio renderer]
  owns: UI state only; calls Elysia APIs and narrow Tauri commands
```

## Evidence Reviewed

### Official / upstream Hermes sources

- Desktop docs: https://hermes-agent.nousresearch.com/docs/user-guide/desktop
  - Desktop shares config, API keys, sessions, skills, and memory with CLI/TUI.
  - Packaged app ships an Electron shell; first launch installs the runtime into
    `HERMES_HOME`; renderer talks to `hermes dashboard` backend APIs.
  - Desktop can either manage a local backend or attach to a remote dashboard.
- Architecture docs:
  https://hermes-agent.nousresearch.com/docs/developer-guide/architecture
  - Hermes is a multi-surface runtime: CLI, gateway, cron, tools, MCP, plugins,
    sessions, and desktop all reuse the same agent core.
- MCP guide: https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes
  - Hermes recommends allowlisting tools for sensitive systems and supports
    per-server include/exclude plus resources/prompts toggles.
- Upstream source checked via GitHub API on 2026-06-17:
  - `apps/desktop/package.json`: Electron + React/Vite + electron-builder.
  - `apps/desktop/electron/main.cjs`: backend supervision, safe storage, IPC,
    update/bootstrap plumbing.
  - `apps/desktop/electron/hardening.cjs`: sensitive-file blocking, path checks,
    fetch/read limits, secure token storage.
  - `apps/bootstrap-installer/src-tauri/tauri.conf.json`: Tauri is a bootstrap
    installer, not the daily-driver Hermes desktop shell.

### Official Tauri sources

- Tauri security overview: https://v2.tauri.app/security/
  - Tauri explicitly frames Rust core and WebView frontend as separate trust
    zones bridged by IPC, so command payload validation matters.
- Tauri CSP docs: https://v2.tauri.app/security/csp/
  - CSP should be as restrictive as possible and avoid remote script loading.
- Tauri permissions docs: https://v2.tauri.app/security/permissions/
  - Frontend command access should be granted by explicit permissions and scopes.

### Local ARRA facts checked

- `frontend/src-tauri/src/lib.rs` already starts `bun run server`, exposes
  `start_backend`, `stop_backend`, `health_check`, `get_backend_url`, tray/menu
  status, and a fixed `http://localhost:47778` backend URL. It is 244 lines and
  should be split before adding behavior.
- `frontend/src-tauri/tauri.conf.json` builds the Vite frontend and permits
  localhost HTTP/WebSocket connections in CSP.
- `frontend/src/components/BackendGate.tsx` already gates React UI on browser vs
  Tauri backend health checks.
- `src/server.ts` is the existing Elysia composition root; keep product logic
  there, not in desktop IPC.
- `src/mcp/client.ts` is currently a one-shot MCP client. Desktop should not own
  MCP state; it should surface backend-owned MCP registry/status APIs.
- `src/plugins/unified-manifest.ts` is near the file-size limit but provides the
  right declarative plugin source of truth.

## Recommended ARRA Desktop Architecture

### 1. Keep Tauri as the host shell

Hermes uses Electron because it wraps a Python runtime and benefits from a
Chromium/Node desktop ecosystem. ARRA already has Bun/TypeScript, a React/Vite
frontend, and a Tauri scaffold. Tauri keeps the install surface smaller and maps
well to a launcher/supervisor role.

Use Electron only if ARRA later needs:

- guaranteed bundled Chromium behavior across all platforms;
- deep PTY/xterm panes similar to Hermes dashboard chat;
- Electron-only integrations that materially exceed Tauri plugins.

### 2. Split the Rust supervisor before adding features

Proposed module shape:

```text
frontend/src-tauri/src/
  lib.rs        // builder wiring only
  backend.rs    // spawn, stop, readiness, PID/state
  health.rs     // Rust HTTP/TCP probes; no external curl
  tray.rs       // status icon and menu events
  commands.rs   // command registration and typed responses
  paths.rs      // ORACLE_DATA_DIR/profile resolution
  logs.rs       // bounded desktop/backend log capture
  security.rs   // path containment and sensitive-file checks
```

This follows repo conventions, keeps files under 250 lines, and avoids copying
Hermes' large Electron `main.cjs` shape.

### 3. Replace fixed port with readiness handshake

Current Tauri code assumes `localhost:47778`. Desktop should support dynamic
ports to avoid collisions with a separately running Oracle backend.

Recommended contract:

```text
Tauri starts: bun run server -- --host 127.0.0.1 --port 0 --desktop
Backend emits: ORACLE_READY {"port":12345,"token":"...","dataDir":"..."}
Tauri stores: backendUrl=http://127.0.0.1:12345, desktopToken=...
Renderer calls: get_backend_url(), then uses backend APIs with token header
```

If port `0` is not supported by the current server path, add it first behind a
small startup contract rather than hardcoding another desktop-only path.

### 4. Add a per-launch desktop token

Localhost is not a sufficient authorization boundary for a desktop-owned backend.
The desktop host should mint or receive a short-lived token and inject it into
renderer requests:

```http
Authorization: Bearer <desktop-session-token>
X-Oracle-Desktop: 1
```

Keep this separate from user API keys and remote auth. It is a local
process-bound capability for the renderer to call the supervised backend.

### 5. Keep MCP, vector, and plugin config backend-owned

Hermes' strongest MCP lesson is policy-controlled registration: allowlists,
excludes, resource/prompt toggles, reloads, and capability-aware tool exposure.
For ARRA:

- persist MCP server registry under `ORACLE_DATA_DIR`;
- support stdio and remote HTTP/SSE transports in backend code;
- expose per-server status, logs, include/exclude policy, and reload endpoints;
- attach MCP-provided tools to `UnifiedPluginManifest` provenance where possible;
- never store MCP/plugin/vector settings in renderer localStorage.

### 6. Harden desktop IPC like a privilege boundary

Copy Hermes' security posture, not its Electron code:

- one Tauri command per capability;
- no broad shell passthrough;
- path normalization and containment checks;
- deny reads/previews for `.env`, SSH/GPG/AWS credentials, key/cert stores;
- file-size and timeout limits;
- structured error codes for UI display;
- explicit Tauri permissions/scopes and narrow CSP.

### 7. Add diagnostics as a product feature

Desktop should make local-first operations debuggable:

```text
ORACLE_DATA_DIR/logs/desktop.log
ORACLE_DATA_DIR/logs/backend.log
health snapshot
vector config summary
plugin manifest summary
MCP registry status
recent startup/update errors
redacted env/config summary
```

Expose this as a “Copy diagnostics” / “Export support bundle” action in Studio
and the Tauri menu.

## P0 Build Sequence

1. Split `frontend/src-tauri/src/lib.rs` into supervisor modules.
2. Replace `curl` health checks with Rust HTTP/TCP checks and typed JSON return.
3. Add `--host`, `--port`, and `--json-ready` server startup support if missing.
4. Add per-launch desktop token middleware for desktop mode.
5. Extend `BackendGate.tsx` to render structured states: starting, port occupied,
   token rejected, DB migration failed, vector degraded, plugin degraded.

## P1 Product Sequence

1. Backend-owned MCP registry with include/exclude policy and server logs.
2. Plugin provenance and per-surface enable/disable in the unified manifest UI.
3. Native dialogs for import/export paths while backend owns the actual export.
4. Desktop diagnostics bundle and log viewer.
5. OS notifications for indexing completion, plugin failures, and backup/export.

## Non-goals

- Do not implement desktop features in this research task.
- Do not switch ARRA to Electron based only on Hermes' choice.
- Do not fork product logic into Tauri commands.
- Do not make desktop packaging block server, MCP, export, or vector work.
- Do not weaken CSP or expose filesystem APIs broadly for convenience.

## Open Decisions

1. Should the bundled desktop include Bun, or require system Bun for developer
   builds only and bundled sidecar for releases?
2. Should Studio load from bundled Tauri assets, from Elysia static output, or a
   hybrid depending on dev vs release mode?
3. How should `ORACLE_DATA_DIR`, tenant, and profile context map to desktop
   windows and remote backends?
4. Should desktop token auth be middleware-only or integrated into existing API
   key scopes?
5. Which release channel maps to project policy: alpha prerelease, stable, or a
   separate desktop canary channel?

## Final Recommendation

Ship ARRA Desktop as a **thin Tauri supervisor over the existing Bun/Elysia
Oracle runtime**. Use Hermes to validate the host boundary: startup, health,
secure storage, MCP/tool policy, logs, diagnostics, and updates. Keep ARRA's
backend as the only product brain and keep React Studio usable in browser/PWA
mode so desktop remains an enhanced local shell, not a separate application.
