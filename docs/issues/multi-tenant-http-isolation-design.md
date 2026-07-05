# Multi-tenant HTTP isolation design

Issue: #1650  
Status: as-built summary + planned hardening

## Goal

Allow one ARRA Oracle V3 server to host multiple organizations while keeping
HTTP, SQLite, FTS, vector, logs, and plugin-visible data scoped to the active
organization. Existing single-tenant installs must keep working without a tenant
header.

## Current baseline

- HTTP runs through Elysia routes composed in `src/server.ts`.
- API auth is token-based (`ARRA_API_KEY` for middleware and `ARRA_API_TOKEN`
  for API-token guarded routes/workers).
- `src/middleware/tenant.ts` parses `X-Oracle-Tenant`, validates optional
  `X-Oracle-Tenant-Token`, accepts aliases, and exposes request/async context
  helpers.
- Drizzle migrations add `tenant_id` to the major user-data tables, including
  documents, search/access logs, traces, memories, export jobs, schedule, and
  menu rows.
- Vector/memory routes propagate tenant scope through metadata and tenant-aware
  helpers; some deeper admin workflows remain planned.

## Shipped vs planned

| Status | Scope | Source / note |
| --- | --- | --- |
| Shipped | Header parsing and token validation | `src/middleware/tenant.ts` with `ORACLE_TENANT_TOKENS` and `ORACLE_TENANT_API_KEYS`. |
| Shipped | Tenant columns and indexes | Migrations `0022`, `0025`-`0028`; `trace_log` and `oracle_memories` are tenant-aware. |
| Shipped | Basic tenant admin routes | `GET/POST /api/tenants`, `GET /api/tenants/:id` in `src/routes/tenants/index.ts`. |
| Shipped | Tenant-aware memory/vector paths | `src/routes/memory/store.ts`, `vector.ts`, and proxy/header tests. |
| Planned | Persistent hashed tenant-token table | Env-backed token maps are current; DB-managed token CRUD is not shipped. |
| Planned | Full tenant lifecycle | PATCH/delete/purge flows and backup-gated deletion remain future work. |
| Planned | Exhaustive route coverage audit | Continue adding route-level isolation tests before claiming every route is tenant-complete. |

## Tenancy model

A tenant is an org slug. Valid examples: `default`, `soul-brews`, `team_a`.
Invalid header values are rejected before route handlers run.

Headers:

- `X-Oracle-Tenant: <tenant-slug>` selects the tenant.
- `Authorization: Bearer <api-key>` authenticates the caller.
- `X-Oracle-Tenant-Token: <tenant-token>` is an optional tenant-scoped guard for
  deployments that cannot yet mint scoped bearer tokens.

Backward compatibility:

- Missing tenant header maps to `default` in scoped storage helpers.
- Legacy unscoped rows are readable only through the default tenant migration
  view until backfilled.

## Authorization contract

Tenant choice must not be a trust boundary by itself. The auth decision is:

1. Validate the bearer/API token as today.
2. Resolve allowed tenants for that token.
3. Resolve requested tenant from `X-Oracle-Tenant` or `default`.
4. Allow only when requested tenant is in the token scope or the token is admin.
5. Store `{ tenantId, principalId, scopes }` on Elysia context and AsyncLocalStorage.

Initial token storage can be environment-backed for self-hosted installs:

```text
ORACLE_TENANT_TOKENS=tenant-a=tok_a,tenant-b=tok_b
```

The production-ready target is a Drizzle-managed `tenants` table and
`tenant_tokens` table with hashed tokens, status, scope, and audit timestamps.

## Data isolation

### SQLite

Add `tenant_id TEXT NOT NULL DEFAULT 'default'` to every persisted user data table
that can appear in HTTP responses or search results. Minimum phase-1 tables:

- `oracle_documents`
- `search_log`
- `consult_log`
- `learn_log`
- `document_access`
- `forum_threads`
- `trace_log`
- memory/menu/settings tables if exposed per org

Indexes should lead with `tenant_id` for common filters, for example
`idx_documents_tenant_type` and `idx_search_tenant_created`.

All route/tool queries must compose tenant filters via one helper, not ad hoc SQL:

```ts
where(and(eq(table.tenantId, tenantId), existingCondition))
```

Writes must stamp `tenant_id` from request context. Background jobs must receive
an explicit tenant id in their job payload instead of reading ambient context.

### FTS5

SQLite FTS tables cannot enforce tenant isolation alone. Use one of these paths:

1. Recommended: add `tenant_id` to the external content table and join/filter by
   `oracle_documents.tenant_id` for search result hydration.
2. If FTS rows are copied into a standalone table, include `tenant_id` in the FTS
   table and use `tenant_id = ?` with the `MATCH` query.

Never return an FTS hit until the hydrated document row matches the tenant.

### Vector / LanceDB

Use per-tenant storage namespaces, not metadata-only filtering, as the default:

```text
${ORACLE_DATA_DIR}/tenants/<tenant>/lancedb/<collection>
```

A collection-prefix mode (`<tenant>__<collection>`) may be supported for remote
stores that cannot use directories, but local LanceDB should prefer tenant
directories for backup and deletion safety.

`VectorStoreConfig` should resolve `dataPath` through a tenant-aware helper. The
proxy adapter must forward `X-Oracle-Tenant` to remote vector services so sidecars
can enforce the same scope.

## HTTP middleware order

Place tenant authorization after API key auth and before metrics/routes:

1. request id, CORS, security, body limit, rate limit
2. API key / legacy token auth
3. tenant auth + context attach
4. metrics lifecycle
5. routes

Reason: rate limiting should still protect unauthenticated traffic, but routes
and metrics labels must see validated tenant context.

## Admin APIs

Add admin-only endpoints under `/api/tenants`:

- `GET /api/tenants` list tenants and status
- `POST /api/tenants` create tenant
- `GET /api/tenants/:id` inspect storage and counts
- `PATCH /api/tenants/:id` enable/disable metadata
- `POST /api/tenants/:id/tokens` mint token and return it once
- `DELETE /api/tenants/:id/tokens/:tokenId` revoke token

Tenant deletion must be two-phase: disable first, then explicit purge after a
backup/export checkpoint.

## Migration plan

1. Add schema tables/columns through Drizzle migrations only.
2. Backfill existing rows to `tenant_id = 'default'`.
3. Add tenant context to HTTP fetch/Elysia pipeline.
4. Convert read paths to tenant helper filters, starting with search/list/detail.
5. Convert write paths to stamp tenant id.
6. Move vector store path resolution behind a tenant-aware helper.
7. Forward tenant headers through proxy/vector sidecars.
8. Add admin tenant CRUD and token management.
9. Add migration/backup docs and an operator runbook.

## Test plan

- Middleware: valid tenant, invalid slug, missing scoped token, wrong scoped token.
- HTTP isolation: same document ids/content in two tenants never cross in search,
  list, stats, forum, memory, and trace routes.
- Migration: old DB with no tenant columns migrates to default tenant and remains
  readable without headers.
- Vector: two tenants indexing the same collection produce separate LanceDB paths
  and query results.
- Proxy: remote vector request includes `X-Oracle-Tenant` and rejects cross-tenant
  queries in a fake sidecar.
- Admin: non-admin tokens cannot list/create/delete tenants.

## Rollout and risks

Ship in compatibility mode first: default tenant, env-backed token map, and scoped
query helpers. Then add persistent tenant tables and admin UX. The main risk is a
missed query path; mitigate with helper-only query patterns, integration tests
that seed two tenants, and PR review that treats unscoped SQL as a blocker.
