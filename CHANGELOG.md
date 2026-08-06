# Changelog

All notable changes to the **Neo ARRA V3** consumer surface (CLI + Web + pluggable localhost backend).

This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and CalVer (`vYY.M.D[-alpha.N]`).

## [Unreleased]

### 2026-06-15 session wave — unified surfaces, coverage, and UI

34 PRs merged into `alpha` on 2026-06-15 (13:16-15:52 UTC). Each PR is
represented once below.

#### Surfaces

- Menu route internals were split under the file-size rule, and duplicate route
  menu seeding now keys by `(path, studio)` so multi-studio paths can coexist.
  PRs: #1463, #1466.
- Unified plugin support landed end-to-end: manifest loader foundation, CLI
  adapter, API route/menu row adaptation, MCP routing through the manifest,
  preserved plugin menu aggregation, and plugin-owned web-server routing.
  PRs: #1468, #1471, #1473, #1474, #1476, #1478.
- Vector and storage surfaces gained production-ready swappability: sidecar vector
  proxy manifests, optional none/local/remote embedders with FTS fallback, and a
  swappable storage backend. PRs: #1475, #1469.

#### Coverage

- HTTP and route contracts were isolated and expanded for trace, menu edge cases,
  unified plugin example registration, vector proxy/embedder paths, learn
  frontmatter, ORM-only storage, MCP bridges, CLI plugin adapter/loader, and
  sqlite-vector default behavior. PRs: #1465, #1472, #1477, #1479, #1480,
  #1481, #1482, #1483, #1485.
- Live smoke coverage now exercises CLI/API data paths, health/storage/plugin
  registration, and React proxy behavior with unified plugin data.
  PRs: #1490, #1491, #1492.

#### UI

- Frontend work added the server status dashboard, React app shell, menu/plugins
  views, vector and MCP widgets, shared loading/error states, routed pages, the
  runtime settings page, MCP detail pages, and vector results pages.
  PRs: #1487, #1488, #1493, #1496, #1501, #1502, #1503.

#### Docs

- Documentation now includes the unified plugin authoring guide and a focused API
  reference for menu, plugin, vector, and MCP tool-listing endpoints.
  PRs: #1495, #1499.

#### Infra

- Drizzle migration workflow docs/scripts were aligned, the Docker test stage is
  self-contained, and alpha PR CI now runs scoped Bun tests.
  PRs: #1486, #1494, #1500.

### 2026-06-06 alpha wave — source release notes

#### Core / MCP

- MCP stdio can run embedded or proxy supported tool calls to a long-running HTTP server via `ORACLE_HTTP_URL` / `ORACLE_API` / `NEO_ARRA_API`. ([tracker #5][t5], [source PR #1334][s1334])
- MCP tools are loaded from a local plugin manifest with tier/weight ordering and `dig` / `trace` plugin groups. ([tracker #24][t24], [source PR #1340][s1340])
- Legacy MCP tool enable/disable toggles are preserved through the manifest loader, so #11 is superseded rather than a separate source gap. ([tracker #11][t11], [source PR #1340][s1340])
- Raw Bun test isolation was hardened so the suite can run hermetically after the alpha wave. ([source PR #1350][s1350])

#### Vector

- Vector collections can select adapters independently through explicit config instead of one global vector backend. ([tracker #10][t10], [source PR #1336][s1336])
- Qdrant now has parity with local adapters for precomputed vectors, avoiding unnecessary re-embedding. ([tracker #19][t19], [source PR #1337][s1337])
- Qdrant point IDs now use stable SHA-256-derived UUIDs for deterministic upserts. ([tracker #19][t19], [source PR #1337][s1337])

#### Commands

- `arra` is now a short operator CLI bin alias alongside `arra-cli`. ([tracker #7][t7], [source PR #1335][s1335])
- CLI target resolution is layered across `ORACLE_API`, `--at`, project `.arra/config.json`, XDG config, legacy `NEO_ARRA_API`, and localhost. ([tracker #16][t16], [source PR #1338][s1338])
- `arra doctor` diagnoses server reachability, DB/vector status, adapter config, layered config, and MCP mode. ([tracker #25][t25], [source PR #1341][s1341])
- `arra plugins list|enable|disable` manages the local MCP plugin manifest from the CLI. ([tracker #31][t31], [source PR #1343][s1343])
- `arra completions bash|zsh|fish` emits shell completion scripts for the operator CLI. ([tracker #37][t37], [source PR #1348][s1348])

#### Federation

- Peer identity endpoints (`/info`, `/api/identity`) and persistent identity keys landed in source via migration #39. ([tracker #6][t6], [tracker #39][t39], [source PR #1353][s1353])
- Scout HELLO announcement support landed in source via migration #39. ([tracker #17][t17], [tracker #39][t39], [source PR #1353][s1353])
- Reverse peer query support for named peers landed in source via migration #39. ([tracker #20][t20], [tracker #39][t39], [source PR #1353][s1353])
- TOFU peer-key pinning and verification landed in source via migration #39. ([tracker #23][t23], [tracker #39][t39], [source PR #1353][s1353])
- Peer feed routes landed in source via migration #39; these are separate from the local/oraclenet feed surface. ([tracker #27][t27], [tracker #39][t39], [source PR #1353][s1353])
- Peer search integration landed in source via migration #39. ([tracker #29][t29], [tracker #39][t39], [source PR #1353][s1353])
- Peer endpoint token auth with `ARRA_PEER_TOKEN` landed in source via migration #39. ([tracker #33][t33], [tracker #39][t39], [source PR #1353][s1353])

#### Docker / Distribution

- The repo now has multi-target Docker builds for HTTP API and MCP stdio images. ([tracker #12][t12], [source PR #1339][s1339])
- Docker Compose provides a local HTTP smoke path on port `47778`. ([tracker #12][t12], [source PR #1339][s1339])
- GHCR publishing covers HTTP and stdio images, including arm64 support for Apple Silicon and fleet nodes. ([source PR #1339][s1339], [source PR #1342][s1342])
- Docker MCP Toolkit catalog/install docs and fresh install verification now cover bunx, Docker GHCR, and Docker MCP Toolkit channels. ([tracker #41][t41], [source PR #1349][s1349], [source PR #1351][s1351])

#### Process

- `CONTRIBUTING.md` documents the two-repo topology and requires code PRs to use `gh pr create --repo Soul-Brews-Studio/arra-oracle-v3 --base alpha`. ([tracker #43][t43], [source PR #1352][s1352])

[t5]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/5
[t6]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/6
[t7]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/7
[t10]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/10
[t11]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/11
[t12]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/12
[t16]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/16
[t17]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/17
[t19]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/19
[t20]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/20
[t23]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/23
[t24]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/24
[t25]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/25
[t27]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/27
[t29]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/29
[t31]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/31
[t33]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/33
[t37]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/37
[t39]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/39
[t41]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/41
[t43]: https://github.com/Soul-Brews-Studio/arra-oracle-v3-oracle/issues/43
[s1334]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1334
[s1335]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1335
[s1336]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1336
[s1337]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1337
[s1338]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1338
[s1339]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1339
[s1340]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1340
[s1341]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1341
[s1342]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1342
[s1343]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1343
[s1348]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1348
[s1349]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1349
[s1350]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1350
[s1351]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1351
[s1352]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1352
[s1353]: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/1353

### Added — Neo ARRA V3 | Build with Oracle

The MCP server (this repo, `src/`) now has two new consumer surfaces:

- **`cli/`** — `neo-arra` CLI with a maw-js-style plugin system.
  - Plugin loader (`cli/src/plugin/loader.ts`) scans bundled (`cli/src/plugins/`) + user (`~/.neo-arra/plugins/`) plugins. Emits startup line `loaded N plugins (M bundled, K user)`. (#769)
  - Universal flags `--version`, `--help`, `-h <command>`. (#769)
  - 5 bundled plugins wrapping MCP HTTP API: `search`, `learn`, `list`, `trace`, `read`. Shared helper `cli/src/lib/api.ts` with `NEO_ARRA_API` env var (default `http://localhost:47778`, the real `ORACLE_DEFAULT_PORT`). (#770)
  - `neo-arra plugin {init|list|install|build|remove}` lifecycle commands. `remove` archives to `/tmp/neo-arra-removed-<name>-<ts>/` before unlinking — Principle 1: Nothing is Deleted. (#771)
  - Sample plugin `cli/src/plugins/hello/` proves the pattern end-to-end.

- **`web/`** — legacy static site stack for `neo.buildwithoracle.com` (Pigment pattern, _not_ CF Pages).
  - `web/src/lib/backend.ts` — `BackendClient` interface with `MockBackend` + `RealBackend(baseUrl)` implementations. Selected by `PUBLIC_BACKEND_URL` env var or `?api=http://localhost:47778` query param (drizzle.studio style). (#773)
  - `wrangler.json` routes `neo.buildwithoracle.com` as custom domain with `assets.directory: "./dist"`. Preview via `wrangler.preview.json`.
  - `bun run build` produces static `dist/` with `index.html` + compiled Tailwind CSS.

### Planned (issues filed, implementation gated)

- **#772** Canvas plugin system — Three.js 2D/3D widgets uploadable as Web Worker + OffscreenCanvas (JS v1) or WASM (v2). Plan: `ψ/plans/2026-04-19_canvas-plugin-system.md` on the arra-oracle-v3-oracle vault.

### Process notes (new for this cycle)

- **Issues-first workflow**: every task starts with a filed issue; commits use `refs #N` / final commit `closes #N`; PRs reference and close issues.
- **Lean PRs (maw-js discipline)**: target ≤200 lines/PR. One-issue-one-branch-one-PR. Never bundle.
- **Autonomous build loop**: `BUILD-PROGRESS.md` is the state file; `cron 6348f8be` fires every 30 minutes to pick the next unchecked item.

### PRs merged in this cycle

- #773 `feat: scaffold cli/ + web/ directories for Neo ARRA V3 surfaces` (bootstrap — scaffolding boilerplate, ~1.6k lines generated)
- #774 `feat(cli): plugin loader + universal flags` (86 lines, closes #769)
- #775 `feat(cli): 5 bundled MCP plugins + api helper` (347 lines, closes #770)
- #776 `feat(cli): plugin lifecycle subcommands (init|list|install|build|remove)` (154 lines, closes #771)
