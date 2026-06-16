# Hermes Desktop Architecture Reference for arra-oracle-v3

Issue: #1598  
Date: 2026-06-16  
Purpose: convert Hermes Agent desktop research into concrete `arra-oracle-v3` architecture guidance.

## Short conclusion

Hermes proves the right product boundary: **desktop is a thin host around one local runtime**. It should own install, boot, process supervision, OS integration, secure token storage, updates, diagnostics, and IPC hardening. It should not fork backend logic away from the CLI/API/MCP runtime.

For ARRA, that means a future desktop shell should launch and monitor the existing Bun/Elysia server, then load the existing React Studio. ARRA should keep memory/search/vector/plugin behavior in `src/`, not in a desktop renderer.

## Hermes pattern summary

- Main desktop app: Electron + React/Vite shell.
- Backend: existing Hermes Python runtime/dashboard spawned locally.
- State root: `HERMES_HOME` holds config, sessions, logs, memories, plugins, MCP installs, backups, and runtime bootstrap metadata.
- MCP: backend/CLI-owned config and catalog, surfaced in UI rather than stored only in renderer state.
- Plugins: capability registration with provenance, enable/disable controls, and runtime status.
- Packaging: Electron installers for macOS/Windows/Linux, plus a separate Tauri bootstrap installer path.
- Security posture: hardened IPC/path helpers, sensitive-file blocking, safe token storage, process teardown before updates.

## Current ARRA patterns to preserve

### Shared Bun/Elysia runtime

Relevant ARRA anchors:
- `src/server.ts`
- `src/routes/`
- `src/middleware/api-version.ts`
- `src/routes/health/`

ARRA already has a modular HTTP runtime with versioned API compatibility, direct `/api/health`, and route clusters. A desktop shell should treat this server as the product core and gate launch on health readiness.

Recommended desktop boot contract:

```text
Desktop host
  -> resolve ARRA_HOME / data dir
  -> start Bun/Elysia server on 127.0.0.1:0
  -> pass local session token / profile env
  -> wait for /api/health = ok
  -> load Studio UI
  -> stream logs + expose repair/restart actions
```

### React Studio as the UI shell

Relevant ARRA anchors:
- `frontend/src/pages/VectorPage.tsx`
- `frontend/src/pages/VectorSettingsPage.tsx`
- `frontend/src/pages/IndexManagerPanel.tsx`
- `frontend/src/api/client.ts`

ARRA should continue improving Studio as a web-first/PWA shell before native packaging. Hermes’ value is the shell supervision and OS integration, not a need to rebuild UI in native widgets.

Adopt from Hermes:
- status bar for server/vector/indexer/MCP/plugin health;
- preview rail for search results, traces, documents, and plugin output;
- command palette over pages, collections, plugins, tools, and jobs;
- one-click diagnostics bundle with logs and health JSON.

### Unified plugin manifest

Relevant ARRA anchors:
- `src/plugins/unified-manifest.ts`
- `src/plugins/unified-loader.ts`
- `src/plugins/path-containment.ts`
- `src/plugins/unified-server.ts`
- `src/plugins/error-containment.ts`

ARRA’s declarative manifest is stricter than Hermes’ broad plugin registration model and should remain the spine. Borrow Hermes’ provenance/status ideas without allowing arbitrary hidden side effects.

Recommended manifest evolution:
- track every registered API route, MCP tool, CLI command, menu item, server, proxy, and hook by plugin ID;
- add visible capability/provenance fields;
- support safe enable/disable at plugin and surface level;
- keep project-local plugins opt-in and clearly scoped;
- show per-plugin server logs, health, and last error in Studio.

### Memory and search core

Relevant ARRA anchors:
- `src/tools/`
- `src/vector/`
- `src/indexer/`
- `src/routes/memory/`
- `ψ/memory/`

Hermes is useful for session/user memory lifecycle ideas, but ARRA is already stronger as a knowledge/search backend. Do not replace ARRA’s vector/FTS/indexer pipeline with a desktop-specific memory model.

Recommended separation:
- **Knowledge index:** current ARRA SQLite/FTS/vector/indexer pipeline.
- **Agent memory layer:** future Hermes-like lifecycle for profile/session memory, background prefetch/sync, and memory tools.
- **Human memory:** `ψ/memory/` markdown for reviewable long-term notes and architecture records.

## Recommended ARRA desktop architecture

Prefer this staged path:

1. **Web/PWA first**
   - Finish Studio readiness, health cards, plugin status, vector/indexer controls, and diagnostics.
   - Keep all core behavior testable through HTTP contract tests.

2. **Tauri shell prototype**
   - Tauri is likely a better first ARRA fit than Electron because ARRA is Bun-native and does not need bundled Chromium/Node for backend compatibility.
   - Use the shell only for process lifecycle, native menus, notifications, file dialogs, secure storage, and update UX.

3. **Electron only if requirements force it**
   - Consider Electron if ARRA needs deep PTY/xterm workflows, bundled Chromium consistency, or Hermes-like complex desktop panes.
   - If chosen, copy Hermes’ security posture: context isolation, no Node in renderer, preload bridge, strict navigation, IPC allow-list, and path hardening.

4. **Installer/update layer**
   - Decide whether to bundle Bun or require system Bun.
   - Support alpha/stable channels aligned with ARRA release policy.
   - Stop child processes cleanly before update.
   - Include logs and health output in support bundles.

## Concrete adoption backlog

Near-term, before native desktop:
- Add a Studio runtime readiness page backed by `/api/health`, `/api/plugins`, vector health, and index status.
- Add plugin provenance/capability display in the plugin UI.
- Add per-plugin logs and restart/stop actions for plugin server surfaces.
- Add backup/export flow that includes SQLite, vector metadata, config, plugin manifests, and `ψ/memory`.
- Add a diagnostics endpoint or CLI command that bundles health, config redactions, log tails, and plugin status.

Medium-term desktop prototype:
- Define `ARRA_HOME` as the single desktop data root.
- Add `maw arra serve --port 0 --json-ready` or equivalent readiness output.
- Add local-only auth/session token for desktop renderer calls.
- Add shell-owned log file paths and recovery actions.
- Add a minimal Tauri launcher that opens existing Studio after health passes.

Later polish:
- Native file dialogs for import/export and vault selection.
- OS notifications for index completion and plugin failures.
- Secure storage for remote gateway tokens.
- Signed installers and updater with explicit channel selection.

## Risks and guardrails

- Do not duplicate server logic in a desktop renderer.
- Do not make desktop packaging block core MCP/search/server delivery.
- Do not expose project-local plugins by default.
- Do not rely on renderer-side secrets or broad filesystem IPC.
- Keep health probes fast, direct, and independent of optional plugins.
- Keep every native-shell capability behind a small audited bridge.

## Final recommendation

Use Hermes as a reference for **agent host ergonomics**: bootstrap, health-gated startup, profile-aware local state, MCP/catalog UX, plugin provenance, logs, and diagnostics. Keep ARRA’s identity as the stricter Bun/Elysia **Oracle memory/search MCP backend** with a React Studio operator console. Native desktop should arrive as a thin launcher and supervisor only after the web/server experience is stable.
