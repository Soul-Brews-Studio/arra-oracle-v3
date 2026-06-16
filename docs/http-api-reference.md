# Arra Oracle V3 HTTP API Reference

OpenAPI-style route inventory for Elysia modules under `src/routes/`.
Most `/api/*` endpoints are also reachable as `/api/v1/*`; unversioned infrastructure paths such as `/api/health` remain direct.
Common error body: `{ "error": string }` or route-specific `{ success: false, error: string }`.
Protected routes may require API token/session auth; tenant-aware routes honor `X-Oracle-Tenant`.

## Auth and settings

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/auth/status` | Cookie/session context. | `{ authenticated, authEnabled, localBypass }` |
| POST | `/api/auth/login` | `{ password }` | Sets `oracle_session`; `{ success: true }` |
| POST | `/api/auth/logout` | Session cookie. | Clears session; `{ success: true }` |
| GET | `/api/settings` | Session auth. | Settings object. |
| POST | `/api/settings` | Partial settings JSON. | Updated settings. |
| GET | `/api/settings/system` | Session auth. | Storage, embedder, migration status. |

## Health, metrics, dashboard

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/health` | None. | Aggregate `{ status, uptime, version, db, vectorStatus, pluginStatus }` |
| GET | `/api/stats` | Optional `X-Oracle-Tenant`. | Document, vector, vault, tenant-scoped counts. |
| GET | `/api/oracles` | Optional tenant header. | Oracle identities/projects summary. |
| GET | `/api/oracles/profiles` | None. | Code-backed Oracle profile registry. |
| GET | `/api/oracles/profiles/:slug` | Profile slug/id. | Oracle profile detail or 404. |
| GET | `/api/oracles/thor` | None. | Thor Oracle Stormforge profile alias. |
| GET | `/api/metrics` | None. | Runtime metrics snapshot. |
| GET | `/api/dashboard` | Query filters optional. | Dashboard summary cards. |
| GET | `/api/dashboard/summary` | Query filters optional. | Same summary alias. |
| GET | `/api/dashboard/activity` | `days?` | Search/learning activity. |
| GET | `/api/dashboard/growth` | `period?, days?` | Growth series. |
| GET | `/api/session/stats` | None. | Session/runtime stats. |

## Search, knowledge, learn, memory

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/search` | `q` required; `limit?, type?, project?, cwd?, mode?` | `{ query, results, total, searchTimeMs }` |
| GET | `/api/reflect` | None. | Reflection content or fallback error object. |
| GET | `/api/list` | Optional filters. | Document list. |
| GET | `/api/learn` | None. | `{ items, total }` active learn entries. |
| POST | `/api/learn` | `{ pattern, concepts?, source?, project?, id?, origin?, sourceFile? }` | Created learning `{ success, id, file }` or row. |
| GET | `/api/learn/:id` | `id` path. | Learning row or 404. |
| PUT | `/api/learn/:id` | Partial learn update. | Updated learning row. |
| DELETE | `/api/learn/:id` | `id` path. | Soft-delete marker. |
| POST | `/api/handoff` | Handoff JSON payload. | Persisted handoff result. |
| GET | `/api/inbox` | None. | Inbox/knowledge messages. |
| POST | `/api/memory/save` | `{ content, title?, tags?, source? }` | `{ success, memory, vector }` |
| POST | `/api/memory/closeout` | `{ summary, title?, next?, blockers?, artifacts?, tags? }` | Challenge 2 close-out memory plus vector index result. |
| GET | `/api/memory/recall` | `q?, limit?` | `{ query, total, items }` keyword memories. |
| GET | `/api/memory/search` | `q` required; `limit?` | `{ success, query, total, results }` vector-enriched memories. |
| GET | `/api/memory/morning-tape` | `limit?, format=json|markdown|md` | Morning tape JSON or `text/markdown`. |
| GET | `/api/memory/fanout` | `q, collections?, limit?` | Rank-fused memory collection results. |

## Vector and indexer

| Method | Path | Request | Response |
|---|---|---|---|
| ALL | Manifest vector proxy paths | Sidecar path/body/headers. | Proxied vector sidecar response. |
| GET | `/api/vector/search` | `q, limit?, offset?, type?, project?, cwd?, model?` | Vector search results. |
| GET | `/api/vector/fanout` | `q, fanout?, limit?, type?, cache?` | Merged multi-backend results/errors. |
| GET | `/api/vector/fanout/cache` | None. | Query cache stats. |
| DELETE | `/api/vector/fanout/cache` | None. | `{ success, cache }` |
| GET | `/api/similar` | `id?, limit?, model?` | Nearest-neighbor docs. |
| GET | `/api/compare` | `q?, models?, limit?, type?, project?, cwd?` | Cross-model comparison. |
| GET | `/api/map` | Query filters optional. | 2D vector map. |
| GET | `/api/map3d` | `model?` | 3D projection. |
| GET | `/api/vector/stats` | None. | Per-engine collection counts. |
| GET | `/api/vector/health` | None. | `{ status, engines, providers?, freshness? }` |
| GET | `/api/vector/status` | None. | Health alias. |
| GET | `/api/vector/documents` | `collection?, limit?, offset?` | Paged vector docs. |
| GET | `/api/vector/export/formats` | None. | Registered export formats. |
| GET | `/api/vector/export` | `collection, format?, limit?, offset?` | Stream/export docs. |
| GET | `/api/vector/export/progress` | Export query. | Progress event stream. |
| GET | `/api/vector/config` | None. | Vector config + health/counts. |
| PATCH | `/api/vector/config` | `{ embedder? }` | Updated config. |
| POST | `/api/vector/config/reload` | None. | Cache reload result. |
| POST/PUT | `/api/vector/config/:collection` | Collection config body. | Upsert/update collection. |
| DELETE | `/api/vector/config/:collection` | `collection` path. | Deleted config result. |
| POST | `/api/vector/config/:collection/test` | `collection` path. | Probe result. |
| POST | `/api/vector/config/:collection/primary` | `collection` path. | Primary selection. |
| GET | `/api/vector/providers` | None. | Detected embedding providers. |
| POST | `/api/vector/providers/test` | `{ provider, model?, text? }` | Probe vector dimensions/status. |
| GET | `/api/vector/cost-estimate` | `docs?, tokensPerDoc?, provider?, model?, collection?` | Token/cost estimate + recommendation. |
| GET | `/api/vector/services` | None. | Registered proxy/vector services + health. |
| POST | `/api/vector/services/register` | `{ name, type, endpoint, ... }` | Service registration. |
| POST | `/api/vector/services/:name/test` | `name` path. | Service health probe. |
| DELETE | `/api/vector/services/:name` | `name` path. | Service removal. |
| GET | `/api/vector/index/models` | None. | Available vector models/counts. |
| GET | `/api/vector/models` | None. | Model registry alias. |
| POST | `/api/vector/index/start` | `{ model?, batchSize? }` | `{ jobId, status, model, batchSize }` |
| GET | `/api/vector/index/status` | None. | Current index job status. |
| GET | `/api/indexer/config` | None. | Indexer config/status. |
| POST | `/api/indexer/scan` | Scan request body. | Scan result/jobs. |
| POST | `/api/indexer/start` | Start request body. | Start result. |
| GET | `/api/indexer/progress` | None. | Indexing progress. |
| POST | `/api/indexer/stop` | None. | Stop result. |

## Menu, plugins, MCP, files

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/menu` | `group?, source?, page?, limit?` | Menu items. |
| GET | `/api/menu/search` | `q` | Matching menu items. |
| GET | `/api/menu/tree` | Admin query optional. | Menu tree. |
| GET | `/api/menu/items` | Admin query optional. | Raw menu rows. |
| POST | `/api/menu/items` | Menu item body. | Created item. |
| PATCH | `/api/menu/items/:id` | Partial item body. | Updated item. |
| DELETE | `/api/menu/items/:id` | `id` path. | Delete result. |
| POST | `/api/menu` | Custom/menu item body. | Created menu item. |
| PUT | `/api/menu/:id` | Menu update body. | Updated item. |
| DELETE | `/api/menu/:id` | `id` path. | Delete result. |
| GET | `/api/menu/custom` | None. | Custom menu config. |
| POST | `/api/menu/custom` | Custom item body. | Save result. |
| DELETE | `/api/menu/custom/*` | Wildcard path. | Delete custom entry. |
| POST | `/api/menu/reorder` | Ordered ids. | Reorder result. |
| POST | `/api/menu/reset/:id` | `id` path. | Reset item. |
| GET | `/api/menu/source` | None. | Menu source status. |
| POST | `/api/menu/source` | Source config body. | Save source. |
| DELETE | `/api/menu/source` | Source selector. | Remove source. |
| GET | `/api/menu/source/official` | None. | Official menu source. |
| POST | `/api/menu/reset-all` | None. | Reset all menu rows. |
| POST | `/api/menu/reload` | None. | Reload/seed menu. |
| GET | `/api/plugins` | `kind=canvas?` | Plugin registry entries or CanvasPlugin metadata. |
| GET | `/api/plugins/:name` | `name` path. | Plugin details or file plugin details. |
| PATCH | `/api/plugins/:name/state` | `{ enabled }` | Enable/disable state. |
| GET | `/api/plugins/canvas` | `kind?` | Canvas plugin entries. |
| GET | `/api/plugins/canvas/:id` | `id` path. | Canvas plugin detail. |
| GET | `/api/canvas/plugins` | `kind?` | Canvas registry entries. |
| GET | `/api/canvas/plugins/:id` | `id` path. | Canvas registry detail. |
| GET | `/api/canvas/registry` | `kind?` | Standalone canvas registry manifest. |
| GET | `/api/mcp/tools` | None. | Core + plugin MCP tools. |
| GET | `/api/graph` | None. | Knowledge graph data. |
| GET | `/api/context` | Query context selector. | Context file/metadata. |
| GET | `/api/file` | `path` | File metadata/content. |
| GET | `/api/read` | `path` | File text. |
| GET | `/api/doc/:id` | `id` path. | Document detail. |
| PATCH | `/api/doc/:id` | Partial doc body. | Updated doc. |
| POST | `/api/doc` | Document body. | Created doc. |
| GET | `/api/logs` | `lines?` | Log tail. |

## Collaboration, social, traces, schedule

| Method | Path | Request | Response |
|---|---|---|---|
| GET/POST | `/api/feed` | GET list; POST feed item body. | Feed list or created item. |
| GET | `/api/oraclenet/feed` | Query filters optional. | OracleNet feed. |
| GET | `/api/oraclenet/oracles` | None. | OracleNet oracle list. |
| GET | `/api/oraclenet/presence` | None. | Presence map. |
| GET | `/api/oraclenet/status` | None. | OracleNet status. |
| GET | `/api/threads` | Query filters optional. | Forum threads. |
| POST | `/api/thread` | Thread body. | Created thread. |
| GET | `/api/thread/:id` | `id` path. | Thread detail. |
| PATCH | `/api/thread/:id/status` | `{ status }` | Updated thread status. |
| GET | `/api/traces` | Filters optional. | Trace list. |
| GET | `/api/traces/:id` | `id` path. | Trace detail. |
| GET | `/api/traces/:id/chain` | `id` path. | Trace chain. |
| GET | `/api/traces/:id/linked-chain` | `id` path. | Linked trace chain. |
| POST | `/api/traces/:id/link` | Link body. | Link result. |
| DELETE | `/api/traces/:id/link` | Link selector. | Unlink result. |
| POST | `/api/traces/:id/distill` | Distill body; optional `finding`/`metadata`. | Distillation result. |
| GET | `/api/schedule` | Date/query filters optional. | Schedule entries. |
| POST | `/api/schedule` | Schedule item body. | Created event. |
| PATCH | `/api/schedule/:id` | Partial event body. | Updated event. |
| GET | `/api/schedule/md` | Date/query filters optional. | Markdown schedule. |
| POST | `/api/session/:id/summary` | Summary request body. | Session summary. |
| POST | `/api/vault/sync` | Sync request body. | Vault sync result. |
| GET | `/api/supersede` | Filters optional. | Supersede records. |
| POST | `/api/supersede` | Supersede create body. | Created supersede link. |
| GET | `/api/supersede/chain/:path` | Encoded path. | Supersede chain. |
| GET | `/api/tenants` | None. | `{ tenants, count }` |
| POST | `/api/tenants` | `{ id, name?, status? }` | Upserted tenant. |
| GET | `/api/tenants/:id` | `id` path. | Tenant detail. |

## Peer and daemon-local routes

| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/info` | None. | Peer node info. |
| GET | `/identity` | None. | Peer identity. |
| GET | `/peers` | None. | Known peers. |
| GET | `/peer/feed` | Query filters optional. | Peer feed. |
| POST | `/peer/search` | Peer search body. | Federated search results. |
| POST | `/search` | Peer search alias body. | Federated search results. |
| GET | `/health` | Daemon-local only. | Indexer daemon health/queue depth. |
| POST | `/index` | `{ doc_id, model_key? }` | Enqueued daemon jobs. |
| GET | `/jobs` | `status?, model?, limit?` | Recent daemon jobs. |
| GET | `/events` | SSE client. | Worker event stream. |
| POST | `/drain` | None. | Request daemon drain/shutdown. |
