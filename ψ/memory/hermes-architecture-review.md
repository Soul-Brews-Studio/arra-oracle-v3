# Hermes Agent Desktop Architecture Review for arra-oracle-v3

Issue: #1598  
Source reviewed: `NousResearch/hermes-agent` shallow clone, especially `README.md`, `apps/desktop/README.md`, `apps/desktop/package.json`, `apps/desktop/electron/*.cjs`, `tools/mcp_tool.py`, `tools/memory_tool.py`, `tools/session_search_tool.py`, and `hermes_cli/plugins.py`.

## Executive summary

Hermes is not primarily a single desktop app; it is a multi-surface agent runtime with a desktop shell. The desktop app is an Electron + React/Vite wrapper around the same Python Hermes runtime used by CLI and gateway. It emphasizes shared backend state, first-run bootstrap, provider/tool configuration, local history, MCP extensibility, and rich terminal-like UX.

For arra-oracle-v3, the strongest takeaways are:

1. Treat desktop/web/UI as a thin client over the same HTTP/plugin runtime, not a forked product.
2. Invest in first-run and backend health UX before adding more feature panels.
3. Make plugin/tool subprocesses observable, bounded, and recoverable.
4. Preserve local-first data ownership while adding profile-aware and backup-safe storage patterns.
5. Adopt Hermes-style command/search UX selectively; avoid copying its dependency and packaging complexity.

## Hermes architecture patterns worth applying

### 1. Thin desktop shell over a shared runtime

Hermes Desktop ships an Electron shell, then resolves or bootstraps the Hermes backend into `HERMES_HOME`. The renderer talks to a dashboard/backend API instead of reimplementing agent logic. This mirrors what arra should do with the Elysia API and unified plugin runtime.

Apply to arra:
- Keep `frontend/` and any future desktop shell as API clients over `src/server.ts`.
- Do not duplicate command logic in the UI; expose CLI/plugin/server actions through unified manifests and typed HTTP endpoints.
- Add a desktop/launcher layer only after the server lifecycle is reliable (`maw arra serve`, health checks, config status).

Pros:
- One backend truth for CLI, UI, MCP, and plugins.
- Easier testing via HTTP contract tests.
- Lower risk of UI drift.

Cons:
- Requires robust backend boot/status/error reporting.
- First-run failure modes become product-critical.

### 2. First-run bootstrap and backend readiness as first-class UX

Hermes Desktop has explicit boot overlays, backend probes, install stamps, backend env construction, and logs under `HERMES_HOME/logs/desktop.log`. This is more mature than simply opening a web UI and hoping the server is up.

Apply to arra:
- Extend Vector first-run wizard into a general Studio first-run checklist: server reachable, DB path, plugin dir, vector adapter, embedder status, API token status.
- Expose `/api/health` details that UI can render as actionable cards, not raw JSON.
- Add a persistent boot log location and a “copy diagnostics” action in Settings.

Pros:
- Reduces support burden.
- Makes local-first install trustworthy for non-developers.

Cons:
- Requires discipline to keep probes fast and side-effect-light.

### 3. Safe subprocess and external tool management

Hermes isolates backend resolution, probes candidate commands before trusting them, hides Windows child process windows, logs MCP subprocess stderr to profile logs, and treats missing optional dependencies as degraded rather than fatal.

Apply to arra:
- For unified plugin `server` surfaces, add per-plugin logs, startup health timeouts, and clear degraded status in `/api/plugins`.
- For `maw arra serve`, keep PID tracking but add log path output and stale-PID cleanup.
- For MCP-IN/out, log third-party server stderr away from the interactive UI and redact credentials in errors.

Pros:
- Plugins become safer to run locally.
- Better debugging when external MCP servers fail.

Cons:
- More lifecycle state to test across platforms.

### 4. MCP as an optional extension layer, not the core dependency

Hermes supports stdio, HTTP/streamable HTTP, and SSE MCP transports, but the MCP package is optional and failures degrade. The architecture separates discovery/registration from the main agent loop.

Apply to arra:
- Keep `muninn_search` and core HTTP routes usable without any external MCP server.
- Treat external MCP servers as unified plugin capabilities that register tools into the existing MCP manifest.
- Add transport metadata and capability flags to plugin registry responses.

Pros:
- Keeps base install light and reliable.
- Lets power users extend without blocking core search/indexing.

Cons:
- More compatibility matrix: stdio vs HTTP vs SSE, auth headers, timeouts.

### 5. Local-first state with explicit profiles and backups

Hermes centralizes home/profile paths via `HERMES_HOME`, stores sessions in local SQLite/FTS, stores curated memory in local markdown files, and includes backup logic that handles live SQLite safely. It also warns loudly when profile env propagation is wrong.

Apply to arra:
- Formalize one source of truth for `ORACLE_DATA_DIR`, DB path, plugin dir, and profile/tenant context.
- Add backup/export commands that use SQLite backup APIs instead of copying WAL files blindly.
- Keep `ψ/memory` and DB-backed memory/search complementary: markdown for human review, DB/FTS/vector for retrieval.

Pros:
- Strong local ownership story.
- Better recovery and migration path.

Cons:
- Profiles/tenants can introduce data-placement bugs if env propagation is weak.

### 6. Skills/plugins as procedural memory

Hermes has a large skills/plugin system with security scanning, approval staging, install provenance, and optional skill directories. The valuable pattern is not the exact implementation; it is the lifecycle: discover, inspect, stage, approve, activate, audit.

Apply to arra:
- Evolve unified manifests with provenance fields, declared capabilities, and explicit enable/disable state.
- Add “pending plugin changes” UX before enabling new local plugins that can spawn servers or access files.
- Keep plugin manifests small and declarative; command handlers should be testable functions.

Pros:
- Safer plugin ecosystem.
- Better auditability for local automation.

Cons:
- Approval UX can slow developer iteration unless dev-link workflows stay easy.

### 7. Rich command/search UX

Hermes Desktop uses command/search overlays, session switchers, model/tool settings, side-by-side previews, file browser, voice, and status overlays. Arra has already moved toward bento pages and command palette; Hermes validates that direction.

Apply to arra:
- Make command palette index plugins, MCP tools, pages, recent traces, and vector collections.
- Add side-panel previews for search results, trace chains, and plugin docs.
- Surface long-running jobs (indexing, plugin servers, imports) in a persistent activity HUD.

Pros:
- Turns arra from “API dashboard” into an operator console.
- Makes memory/search workflows faster.

Cons:
- UX polish can hide backend ambiguity unless every card links to raw status/details.

## Patterns to avoid copying directly

- **Dependency weight:** Hermes Desktop carries Electron, Vite, React, node-pty, native dependency staging, Python runtime bootstrapping, and platform-specific installers. Arra should not adopt this until the web app and server lifecycle are stable.
- **Many surfaces at once:** Hermes supports CLI, TUI, gateway, web, desktop, skills, MCP, cron, voice, and messaging. Arra should stay focused on memory/search/indexing/plugin operations.
- **Implicit plugin magic:** Hermes has extensive heuristic plugin discovery. Arra’s unified manifest should remain stricter and easier to reason about.
- **Desktop-first packaging too early:** Electron installer work should wait until `maw arra serve`, config wizard, plugin registry, and backup/export are reliable.

## Recommended roadmap for arra-oracle-v3

### Near term

1. Add a Studio “runtime readiness” panel fed by `/api/health`, `/api/plugins`, and vector config endpoints.
2. Add per-plugin server logs/status in the unified plugin registry.
3. Expand `maw arra serve status` to include PID, port, health, data dir, plugin count, and log paths.
4. Add backup/export command using SQLite backup semantics and include `ψ/memory` files.

### Medium term

1. Convert command palette into an operation launcher: pages, plugins, MCP tools, traces, collections, jobs.
2. Add plugin capability/provenance fields and a safe enable/disable workflow.
3. Add profile/tenant-aware data-dir diagnostics to prevent “wrong home” writes.
4. Add first-run wizard steps for storage backend, vector adapter, embedder, and plugin directory.

### Later / only after server UX is solid

1. Consider a thin Tauri or Electron shell that launches/monitors `maw arra serve` and embeds Studio.
2. Package installers only if users need non-terminal onboarding; otherwise keep web+CLI install path.
3. Add native file dialogs and OS notifications via shell layer, not backend rewrites.

## Final recommendation

Adopt Hermes’ architectural principle — one local-first runtime shared by CLI, UI, gateway, and plugins — but not Hermes’ full desktop complexity yet. Arra should first harden its existing Elysia server, unified manifest loader, `maw arra` CLI, and React Studio into a coherent operator console. A desktop wrapper becomes valuable only when it can be a thin launcher/monitor around that stable runtime.
