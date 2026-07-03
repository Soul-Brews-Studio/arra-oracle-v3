# Arra Oracle docs index

Use this page as the one-hop navigation map for Arra Oracle install, plugin,
HTTP/MCP, operations, and contributor docs. Every Markdown guide under `docs/`
is linked here; keep new docs in the right section when adding files.

## Navigate by task

- **Deploy**: start with [architecture/deploy-topologies.md](./architecture/deploy-topologies.md), then pick [deploy-production.md](./deploy-production.md), [deploy-cloudflare.md](./deploy-cloudflare.md), [deploy-cloudflare-mcp.md](./deploy-cloudflare-mcp.md), [deploy-vercel.md](./deploy-vercel.md), or [DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md).
- **Architecture**: read [architecture.md](./architecture.md), [architecture/modular-backend.md](./architecture/modular-backend.md), [architecture/https-localhost-vector-flow.md](./architecture/https-localhost-vector-flow.md), and [architecture/modular-backend-current-state.md](./architecture/modular-backend-current-state.md).
- **Memory/search**: run [memory-demo.md](./memory-demo.md), then read [architecture/memory-layer.md](./architecture/memory-layer.md), [architecture/memory-pipeline.md](./architecture/memory-pipeline.md), [HUGINN-MUNINN.md](./HUGINN-MUNINN.md), and [vector-runtime.md](./vector-runtime.md).
- **MCP**: read [mcp-tools.md](./mcp-tools.md), [architecture/mcp-remote-transport.md](./architecture/mcp-remote-transport.md), [MCP-FROM-OPENAPI.md](./MCP-FROM-OPENAPI.md), and [deploy-cloudflare-mcp.md](./deploy-cloudflare-mcp.md).

## Start here

| Guide | Use when you need | Key surfaces |
| --- | --- | --- |
| [INSTALL.md](./INSTALL.md) | Install from Bun, plugins, Docker, or Docker MCP Toolkit | `bun add -g`, `arra plugin install`, GHCR |
| [CLI-GUIDE.md](./CLI-GUIDE.md) | Full CLI, MCP, HTTP, scripts, deploy, and env usage guide | `arra`, `arra-oracle-v3`, Claude MCP |
| [QUICKSTART-10MIN.md](./QUICKSTART-10MIN.md) | Docker-first non-dev path: mine notes, then ask | Docker, `arra mine`, `/api/v1/ask` |
| [QUICKSTART.md](./QUICKSTART.md) | Complete a five-minute first run | `arra-oracle-v3 serve`, `arra health`, MCP config |
| [SIMPLE-MODE-SPEC.md](./SIMPLE-MODE-SPEC.md) | Explain the non-dev `/simple` screen and never-silent health states | Simple Mode, health hero, recovery copy |
| [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) | Diagnose install, MCP, HTTP, vector, plugin, and Docker issues | health checks, auth, tenants, logs |
| [FAQ.md](./FAQ.md) | Answer common operator and contributor questions | install path, binaries, data, vectors, tenants |
| [architecture.md](./architecture.md) | Understand the installable runtime architecture | HTTP, MCP, CLI, plugins, storage |
| [architecture/modular-backend.md](./architecture/modular-backend.md) | Modular backend target: CF Workers edge, maw plugin backend, vector server, MCP plugins | backend split, edge, vector, MCP |
| [architecture/modular-backend-current-state.md](./architecture/modular-backend-current-state.md) | Current modular-backend extraction status and boundaries | backend split, current state |
| [architecture/mcp-remote-transport.md](./architecture/mcp-remote-transport.md) | Remote MCP Worker transport and `mcp-remote` client bridge contract | Workers, MCP bridge, OAuth |
| [architecture/deploy-topologies.md](./architecture/deploy-topologies.md) | Choose all-local, Cloudflare edge, Vercel, or federation tunnel deployment. | deploy options, edge/backend/vector split |
| [architecture/https-localhost-vector-flow.md](./architecture/https-localhost-vector-flow.md) | Sequence diagram for hosted HTTPS Studio calling a localhost Oracle backend and local vector flow. | #2312, localhost, PNA, vector |
| [architecture/memory-layer.md](./architecture/memory-layer.md) | Memory confidence ranking, retrieval reinforcement, supersede, and consolidation contracts from #2251. | memory, confidence, supersede, consolidation |
| [architecture/memory-pipeline.md](./architecture/memory-pipeline.md) | Diagram the write, FTS, async consolidation, confidence ranking, and bi-temporal read pipeline. | memory pipeline, FTS, asOf, ranking |
| [memory-demo.md](./memory-demo.md) | Run the #2251 memory walkthrough for provenance, confidence, heat, valid-time, and consolidation. | memory demo, provenance, confidence, heat |
| [architecture/cloudflared-origin-contract.md](./architecture/cloudflared-origin-contract.md) | `ORACLE_ORIGIN_URL` secret and Cloudflare Tunnel origin contract for Workers. | Cloudflare Tunnel, origin URL, Workers secrets |
| [architecture/proxy-terminology.md](./architecture/proxy-terminology.md) | Disambiguate request-tier, storage-tier, and manifest passthrough proxy meanings. | proxy vocabulary, external-only adapters |
| [PLUGIN-GUIDE.md](./PLUGIN-GUIDE.md) | Author installable Oracle plugins | `plugin.json`, CLI/MCP/menu/API surfaces |
| [API-REFERENCE-INDEX.md](./API-REFERENCE-INDEX.md) | Choose the right API reference | `/api/docs`, `openapi.json`, route family map |

## Install, onboarding, and operations

| Guide | Focus |
| --- | --- |
| [BINS.md](./BINS.md) | Published command binaries and aliases. |
| [CLI-GUIDE.md](./CLI-GUIDE.md) | Full CLI and usage guide across local, MCP, HTTP, scripts, Workers, and env vars. |
| [DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md) | Small public Arra HTTP node on DigitalOcean. |
| [deploy-cloudflare.md](./deploy-cloudflare.md) | Cloudflare deployment guide for Oracle surfaces. |
| [deploy-cloudflare-mcp.md](./deploy-cloudflare-mcp.md) | One-click Cloudflare Workers remote MCP deploy and Claude `/mcp` setup. |
| [deploy-production.md](./deploy-production.md) | Production Cloudflare Workers deploy with cloudflared origin, secrets, Studio, MCP, and federation. |
| [hosted-studio-local-backend.md](./hosted-studio-local-backend.md) | Hosted Studio direct-to-local backend connection and CORS/PNA checklist. |
| [workers-deploy-configs.md](./workers-deploy-configs.md) | Validate Cloudflare MCP, Studio, and federation Worker configs and env vars. |
| [deploy-vercel.md](./deploy-vercel.md) | One-click Vercel deploy for the Oracle Studio frontend and `/api/*` proxy. |
| [DOCKER-MCP-TOOLKIT.md](./DOCKER-MCP-TOOLKIT.md) | Docker MCP Toolkit package and profile setup. |
| [LOCAL-DEV.md](./LOCAL-DEV.md) | Local development setup and repo workflow. |
| [ONBOARDING.md](./ONBOARDING.md) | Progressive onboarding UI and first-use flow. |
| [QUICKSTART-10MIN.md](./QUICKSTART-10MIN.md) | 10-minute Docker path for non-dev note mining and grounded ask. |
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
| [cloudflare-vector-backend.md](./cloudflare-vector-backend.md) | Cloudflare vector backend configuration and tradeoffs. |
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
| [FEDERATION.md](./FEDERATION.md) | Opt-in `/api/federation/*` mesh capability provider. |
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
| [issues/2227-maw-arra-serve-findings.md](./issues/2227-maw-arra-serve-findings.md) | #2227 maw arra serve capability findings. |
| [issues/2227-vector-proxy-audit.md](./issues/2227-vector-proxy-audit.md) | #2227 vector proxy audit notes. |
| [issues/hermes-agent-architecture-review-1598.md](./issues/hermes-agent-architecture-review-1598.md) | #1598 Hermes desktop review. |
| [issues/memory-systems-ai-agents-1648.md](./issues/memory-systems-ai-agents-1648.md) | #1648 memory-systems research. |
| [issues/multi-tenant-http-isolation-design.md](./issues/multi-tenant-http-isolation-design.md) | Multi-tenant HTTP isolation design. |
| [issues/trace-log-feature-spec.md](./issues/trace-log-feature-spec.md) | Trace log feature specification. |

## Specs and source references

| Guide | Focus |
| --- | --- |
| [SPEC-original.md](./SPEC-original.md) | Original Arra Oracle V3 specification. |
| [README.md](../README.md) | Project overview and top-level install snippets. |
