# Arra Oracle docs index

Use this page as the one-hop map for the 2026-06-06/07 alpha docs wave.

## Start here

| Guide | Use when you need | Key surfaces |
| --- | --- | --- |
| [INSTALL.md](./INSTALL.md) | Fresh install through Bun, Docker GHCR, or Docker MCP Toolkit | `bunx`, `ghcr.io/soul-brews-studio/arra-oracle-v3:{http,stdio}`, `docker mcp` |
| [DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md) | Deploy a small public Arra HTTP node on DigitalOcean | `doctl`, firewall allowlist, `ARRA_API_TOKEN`, seed, teardown |
| [FEDERATION.md](./FEDERATION.md) | Pair and secure Arra peers | `/info`, `/api/identity`, `/api/peer/feed`, `/api/peer/search`, TOFU pins |
| [HUGINN-MUNINN.md](./HUGINN-MUNINN.md) | Understand the capture/recall naming split | Muninn recall, Huginn capture, no `huginn_*` aliases |
| [CONTRIBUTING.md](../CONTRIBUTING.md) | Pick the correct repo/branch for PRs | two-repo rule, source PRs to `arra-oracle-v3:alpha` |
| [CHANGELOG.md](../CHANGELOG.md) | Review what changed in the alpha wave | release notes, tracker issues, source PRs |
| [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md) | Find feature knobs and first commands | MCP modes, plugins, CLI targets, vectors, Docker, federation |

## Feature knobs quick map

| Feature | Main doc | Common knobs / paths |
| --- | --- | --- |
| MCP embedded vs HTTP-proxy | [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#mcp-modes-embedded-vs-http-proxy) | `ORACLE_HTTP_URL`, `ORACLE_API`, `NEO_ARRA_API` |
| MCP tool/plugin toggles | [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#mcp-tool-plugin-toggles) | `arra.config.json`, `plugins.json`, `$ORACLE_DATA_DIR/config.json` |
| Operator CLI targets | [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#operator-cli-arra-targets-config-doctor-plugins) | `ORACLE_API`, `--at`, `.arra/config.json`, XDG config |
| Vector adapters | [TONIGHT-SHIPPED.md](./TONIGHT-SHIPPED.md#vector-store-adapters-and-per-collection-config) | `ORACLE_VECTOR_DB`, `QDRANT_URL`, `VECTOR_URL`, `VECTOR_FALLBACK` |
| Docker/GHCR | [INSTALL.md](./INSTALL.md#channel-2-docker-ghcr-images) | `:http`, `:stdio`, `docker compose`, Docker volumes |
| Docker MCP Toolkit | [INSTALL.md](./INSTALL.md#channel-3-docker-mcp-toolkit-install) | `catalog/arra-oracle.yaml`, `docker mcp profile create` |
| DigitalOcean deploy | [DEPLOY-DIGITALOCEAN.md](./DEPLOY-DIGITALOCEAN.md) | `doctl`, `sgp1`, `s-1vcpu-2gb`, `ARRA_API_TOKEN`, `scripts/deploy-do.sh` |
| Federation | [FEDERATION.md](./FEDERATION.md) | `ARRA_PEER_TOKEN`, `ARRA_NAMED_PEERS`, `ARRA_SCOUT_ANNOUNCE`, `peers-tofu.json` |
| Capture/recall taxonomy | [HUGINN-MUNINN.md](./HUGINN-MUNINN.md) | `oracle_search`, `oracle_trace*`, `oracle_learn`, `oracle_handoff`, no `huginn_*` aliases |

## Source references

- [README.md](../README.md) — project overview and top-level install snippets.
- [API.md](./API.md) — HTTP API notes.
- [architecture.md](./architecture.md) — system architecture.
- [LOCAL-DEV.md](./LOCAL-DEV.md) — local development setup.
