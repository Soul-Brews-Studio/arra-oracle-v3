# Arra Oracle docs index

Use this page as the one-hop navigation map for Arra Oracle install, plugin,
HTTP/MCP, operations, and contributor docs. Every Markdown guide under `docs/`
is linked here; keep new docs in the right section when adding files.

## Start here

| Guide | Use when you need | Key surfaces |
| --- | --- | --- |
| [INSTALL.md](./INSTALL.md) | Install from Bun, plugins, Docker, or Docker MCP Toolkit | `bun add -g`, `arra plugin install`, GHCR |
| [QUICKSTART.md](./QUICKSTART.md) | Complete a five-minute first run | `arra-oracle-v3 serve`, `arra health`, MCP config |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Diagnose install, MCP, HTTP, vector, plugin, and Docker issues | health checks, auth, tenants, logs |
| [FAQ.md](./FAQ.md) | Answer common operator and contributor questions | install path, binaries, data, vectors, tenants |
| [architecture.md](./architecture.md) | Understand the installable runtime architecture | HTTP, MCP, CLI, plugins, storage |
| [architecture/modular-backend.md](./architecture/modular-backend.md) | Modular backend target: CF Workers edge, maw plugin backend, vector server, MCP plugins. |
| [architecture/mcp-remote-transport.md](./architecture/mcp-remote-transport.md) | Remote MCP Worker transport and `mcp-remote` client bridge contract. |
| [architecture/deploy-topologies.md](./architecture/deploy-topologies.md) | Choose all-local, Cloudflare edge, Vercel, or federation tunnel deployment. | deploy options, edge/backend/vector split |
| [architecture/memory-layer.md](./architecture/memory-layer.md) | Memory confidence ranking, retrieval reinforcement, supersede, and consolidation contracts from #2251. | memory, confidence, supersede, consolidation |
| [architecture/memory-pipeline.md](./architecture/memory-pipeline.md) | Diagram the write, FTS, async consolidation, confidence ranking, and bi-temporal read pipeline. | memory pipeline, FTS, asOf, ranking |
| [architecture/cloudflared-origin-contract.md](./architecture/cloudflared-origin-contract.md) | `ORACLE_ORIGIN_URL` secret and Cloudflare Tunnel origin contract for Workers. | Cloudflare Tunnel, origin URL, Workers secrets |
| [architecture/proxy-terminology.md](./architecture/proxy-terminology.md) | Disambiguate request-tier, storage-tier, and manifest passthrough proxy meanings. | proxy vocabulary, external-only adapters |
| [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md) | Author installable Oracle plugins | `plugin.json`, CLI/MCP/menu/API surfaces |
| [API-REFERENCE-INDEX.md](./API-REFERENCE-INDEX.md) | Choose the right API reference | `/api/docs`, `openapi.json`, route family map |

## Install, onboarding, and operations

| Guide | Focus |
| --- | --- |
| [BINS.md](./BINS.md) | Published command binaries and aliases. |
| [DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md) | Small public Arra HTTP node on DigitalOcean. |
| [deploy-cloudflare-mcp.md](./deploy-cloudflare-mcp.md) | One-click Cloudflare Workers remote MCP deploy and Claude `/mcp` setup. |
| [deploy-vercel.md](./deploy-vercel.md) | One-click Vercel deploy for the Oracle Studio frontend and `/api/*` proxy. |
| [DOCKER-MCP-TOOLKIT.md](./DOCKER-MCP-TOOLKIT.md) | Docker MCP Toolkit package and profile setup. |
| [LOCAL-DEV.md](./LOCAL-DEV.md) | Local development setup and repo workflow. |
| [ONBOARDING.md](./ONBOARDING.md) | Progressive onboarding UI and first-use flow. |
| [REBRAND-RUNBOOK.md](./REBRAND-RUNBOOK.md) | Arra Oracle naming and migration checklist. |
| [RTK-SETUP.md](./RTK-SETUP.md) | RTK setup for Claude Code sessions. |
| [SWAGGER-DEPLOY.md](./SWAGGER-DEPLOY.md) | Public Swagger/API docs deployment notes. |
| [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md) | Shipped feature knobs and first commands. |

## API, MCP, middleware, and data

| Guide | Focus |
| --- | --- |
| [API.md](./API.md) | Menu, plugin, vector, and MCP HTTP API notes. |
| [http-api-reference.md](./http-api-reference.md) | Full Elysia route inventory. |
| [mcp-tools.md](./mcp-tools.md) | MCP tool names, contracts, and usage. |
| [MCP-FROM-OPENAPI.md](./MCP-FROM-OPENAPI.md) | Generate MCP tools from OpenAPI route metadata. |
| [MIDDLEWARE.md](./MIDDLEWARE.md) | HTTP middleware order and request lifecycle. |
| [DB-MIGRATIONS.md](./DB-MIGRATIONS.md) | Drizzle migration workflow. |
| [CLOUD-VECTOR-PROXY.md](./CLOUD-VECTOR-PROXY.md) | Cloud vector proxy runbook. |
| [vector-runtime.md](./vector-runtime.md) | Vector runtime mode reference. |
| [openapi.json](./openapi.json) | Machine-readable OpenAPI export. |

## Plugins, menus, UI, and canvas

| Guide | Focus |
| --- | --- |
| [UNIFIED-PLUGIN.md](./UNIFIED-PLUGIN.md) | Unified plugin manifest fields. |
| [PLUGIN-TAXONOMY.md](./PLUGIN-TAXONOMY.md) | Plugin categories and naming. |
| [PLUGIN-MENU.md](./PLUGIN-MENU.md) | Plugin-provided menu entries. |
| [HOOK-MENU-PACKAGE.md](./HOOK-MENU-PACKAGE.md) | Shared hook-menu package integration. |
| [examples/unified-plugin](./examples/unified-plugin/plugin.json) / [index.ts](./examples/unified-plugin/index.ts) | Example unified plugin manifest and entrypoint. |
| [MENU-AUTOLOAD.md](./MENU-AUTOLOAD.md) | `ORACLE_MENU_DIR` menu autoloading. |
| [MENU-CONFIG.md](./MENU-CONFIG.md) | Menu configuration sources and overrides. |
| [MULTI-STUDIO.md](./MULTI-STUDIO.md) | Multi-studio menu tags and domains. |
| [dashboard-proposal.md](./dashboard-proposal.md) | Dashboard proposal and UI shape. |

## Federation, memory, and oracle workflows

| Guide | Focus |
| --- | --- |
| [FEDERATION.md](./FEDERATION.md) | Pair and secure Arra peers. |
| [HUGINN-MUNINN.md](./HUGINN-MUNINN.md) | Capture/recall taxonomy and naming split. |
| [huginn-capture.md](./huginn-capture.md) | Huginn auto-capture hook behavior. |
| [MORNING-TAPE-TEMPLATE.md](./MORNING-TAPE-TEMPLATE.md) | Challenge 2 memory bootstrapping template. |
| [oracles/thor-stormforge.md](./oracles/thor-stormforge.md) | Thor Oracle Stormforge workflow profile. |

## Contributor and issue docs

| Guide | Focus |
| --- | --- |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Repo-level branch and PR rules. |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Source contributor quickstart. |
| [CONTRIBUTING-AWAKENING.md](./CONTRIBUTING-AWAKENING.md) | Oracle Awakening contribution announcements. |
| [GITHUB-ISSUE-UPDATES.md](./GITHUB-ISSUE-UPDATES.md) | Polished issue update format. |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes and alpha wave changes. |
| [issues/1598-hermes-agent-desktop-codex-3.md](./issues/1598-hermes-agent-desktop-codex-3.md) | #1598 desktop architecture review. |
| [issues/hermes-agent-architecture-review-1598.md](./issues/hermes-agent-architecture-review-1598.md) | #1598 Hermes desktop review. |
| [issues/memory-systems-ai-agents-1648.md](./issues/memory-systems-ai-agents-1648.md) | #1648 memory-systems research. |
| [issues/multi-tenant-http-isolation-design.md](./issues/multi-tenant-http-isolation-design.md) | Multi-tenant HTTP isolation design. |
| [issues/trace-log-feature-spec.md](./issues/trace-log-feature-spec.md) | Trace log feature specification. |

## Specs and source references

| Guide | Focus |
| --- | --- |
| [SPEC-original.md](./SPEC-original.md) | Original Arra Oracle V3 specification. |
| [README.md](../README.md) | Project overview and top-level install snippets. |
