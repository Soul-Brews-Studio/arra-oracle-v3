# #1598 Hermes Agent Desktop App architecture review

**Research date:** 2026-06-16  
**Upstream reviewed:** `nousresearch/hermes-agent` at `c6b0eb4de0e5010a752e312c0577a4d04d2a08a5`  
**Scope:** source-code architecture deep dive for desktop app, MCP, local-first state, plugin system, and packaging.

## Executive summary

Hermes Desktop is an **Electron + React/Vite shell** around the existing Hermes Python agent/gateway rather than a separate desktop-native agent implementation. The most useful pattern for `arra-oracle-v3` is not the exact framework choice, but the boundary: a thin desktop host owns bootstrap, process lifecycle, OS integrations, secure storage, updates, and IPC hardening; the agent backend remains the same local HTTP/WebSocket service used by CLI/gateway surfaces.

## Architecture findings

- **Desktop framework:** Electron, not Tauri/Wails. `apps/desktop/package.json` sets `main` to `electron/main.cjs`, uses Vite for the renderer, and ships with `electron-builder` targets for macOS, Windows, and Linux.
- **Renderer stack:** React 19, Vite, assistant-ui, xterm, React Query, Radix-ish UI primitives, Tailwind. The renderer talks to the existing Hermes dashboard/gateway APIs instead of directly importing Python agent logic.
- **Backend lifecycle:** `electron/main.cjs` owns runtime discovery, first-run bootstrap, Python backend spawning, dashboard readiness probing, per-profile backend pooling, update orchestration, and teardown. This is a large but clear desktop-host layer.
- **Packaged app model:** Hermes README says the packaged app ships the Electron shell and installs/uses the Hermes Agent runtime in `HERMES_HOME` on first launch. That keeps CLI and desktop interchangeable.
- **Distribution:** `electron-builder` outputs DMG/zip for macOS, NSIS/MSI for Windows, and AppImage/deb/rpm for Linux. macOS hardened runtime, entitlements, signing, and notarization hooks are present.

## MCP integration

- MCP is a first-class CLI/config surface, not desktop-only. `hermes_cli/mcp_config.py` stores servers under `mcp_servers` in `~/.hermes/config.yaml` and validates stdio/server entries before saving.
- Optional MCPs are shipped as a curated catalog under `optional-mcps/<name>/manifest.yaml`; users install them into `~/.hermes/mcp-installs/<name>` and write config entries.
- This suggests ARRA should keep MCP server config as backend-owned data exposed to desktop UI, not renderer-owned state.

## Local-first storage

- `HERMES_HOME` is the root for config, sessions, logs, memories, plugins, MCP installs, backups, and the bootstrapped runtime. Defaults are platform-aware: `~/.hermes` on POSIX and `%LOCALAPPDATA%\hermes` on Windows.
- `config.yaml` is the primary user configuration file; `.env` is used for secrets/env material with migration away from storing normal settings in env.
- The backup module treats SQLite databases specially via the SQLite backup API and includes critical state such as `config.yaml`, `.env`, state DBs, sessions, and skills.
- Desktop secrets use Electron `safeStorage` for remote gateway tokens where available, with explicit fallback guidance when OS keychain support is unavailable.

## Plugin system

Hermes has a richer plugin model than ARRA currently needs:

- Discovery sources: bundled plugins, user plugins in `~/.hermes/plugins`, project plugins in `./.hermes/plugins` behind an opt-in env flag, and pip entry points in `hermes_agent.plugins`.
- Plugins use `plugin.yaml` / `plugin.yml` manifests plus Python modules.
- `PluginContext` can register tools, hooks, middleware, slash commands, platform adapters, model/media providers, memory providers, auxiliary tasks, and skills.
- User-installed plugins are gated by config allow-lists/disable lists; bundled platform plugins can auto-load.

For ARRA, the important lesson is **capability-specific registration with provenance**. Hermes tracks plugin-provided tools/commands/platforms separately, which makes UI listing and safe disable flows easier.

## Security and hardening patterns worth adopting

- The Electron host has a dedicated `hardening.cjs` module for path resolution, sensitive file blocking, file URL handling, data URL limits, and safe IPC errors.
- Packaged build tests assert entrypoints do not depend on unpackaged npm modules.
- Windows-specific environment handling reads user-scoped env vars from the registry because Explorer-launched apps inherit stale environment blocks.
- Update code explicitly stops desktop-owned backend processes and child trees before replacing binaries, especially on Windows.

## ARRA recommendations

1. **Use a thin desktop host around the current Elysia backend.** If ARRA builds a desktop app, the host should launch/monitor the local server and open the existing frontend, not duplicate agent/search logic in the shell.
2. **Keep one local data root.** Mirror Hermes' `HERMES_HOME` pattern with a single ARRA home containing config, DBs, logs, plugins, backups, and runtime metadata. The desktop UI should edit backend-owned config via HTTP APIs.
3. **Move desktop-sensitive operations behind audited IPC helpers.** File reads, path browsing, shell/serve controls, and token storage need a small hardened bridge rather than broad renderer privileges.
4. **Model plugin provenance explicitly.** Extend the unified plugin manifest/runtime to track registered tools, commands, surfaces, and lifecycle hooks by plugin ID so the UI can explain and disable effects safely.
5. **Prefer backend-owned MCP catalog/config.** A desktop MCP settings panel should read/write the same MCP registry/config used by CLI/server.
6. **Adopt package verification tests early.** Add tests that the packaged desktop entrypoints only require bundled/staged modules and that app update/teardown paths do not leave child processes alive.

## Risks / non-goals

- Hermes' Electron main process is very large. ARRA should avoid copying that shape directly; start with smaller modules for bootstrap, process control, IPC hardening, updates, and settings.
- Hermes' plugin system is powerful but broad. ARRA should not expose arbitrary project plugins by default; keep project-local plugins opt-in and visibly scoped.
- I did not run the Hermes Desktop installer, so UI/UX observations here are from `apps/desktop/README.md`, renderer source layout, and package/build configuration rather than hands-on use.

## Source references

- Hermes Desktop README: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/README.md
- Desktop package/build config: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/package.json
- Electron main process: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/electron/main.cjs
- IPC/path hardening: https://github.com/NousResearch/hermes-agent/blob/main/apps/desktop/electron/hardening.cjs
- Hermes home constants: https://github.com/NousResearch/hermes-agent/blob/main/hermes_constants.py
- MCP config: https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/mcp_config.py
- MCP catalog: https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/mcp_catalog.py
- Plugin manager: https://github.com/NousResearch/hermes-agent/blob/main/hermes_cli/plugins.py
- Memory provider architecture: https://github.com/NousResearch/hermes-agent/blob/main/agent/memory_provider.py
