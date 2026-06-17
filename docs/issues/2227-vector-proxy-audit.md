# #2227 Slice 0b — vector proxy audit

## Scope

Read-only audit for c6 documentation: list the current vector proxy surfaces and
separate the older `VECTOR_URL` route proxy from the newer vector-store proxy
protocol and manifest passthrough.

## Evidence commands

```bash
rg -n -i "proxy" src/vector src/vector-server.ts
rg -n "VECTOR_URL|VECTOR_DB_URL|ORACLE_PROXY_VECTOR|ORACLE_VECTOR_DB" src tests docs package.json
```

## Executive summary

- There are three distinct proxy contracts; docs should not collapse them into
  one env var.
- `VECTOR_URL` is the legacy/coarse HTTP route gateway for moving vector routes
  and the vector leg of hybrid search to a separate vector HTTP process.
- `ORACLE_VECTOR_DB=proxy` selects `ProxyVectorAdapter`, which speaks the
  `vector-proxy-v1` storage protocol. It resolves its endpoint from an explicit
  config endpoint, then `ORACLE_PROXY_VECTOR_URL`, then `VECTOR_DB_URL`.
- `vector-server.json.proxy[]` is a manifest passthrough surface. Its default
  manifest exposes `/api/vector-db/*` and forwards to `targetEnv: VECTOR_DB_URL`.
- The same `VECTOR_DB_URL` string can therefore mean either the fallback endpoint
  for `ProxyVectorAdapter` or the target URL for manifest passthrough.

## Proxy surface map

### 1. `VECTOR_URL` route/gateway proxy

Files:

- `src/config.ts` resolves `VECTOR_URL`, falling back to durable
  `vectorProxyUrl` / `vectorUrl` from `vector-server.json`, and ignores inherited
  `VECTOR_URL` inside `src/vector-server.ts` to avoid self-proxy loops.
- `src/server.ts` wires `gatewayPlugin(ORACLE_DATA_DIR, VECTOR_URL || undefined)`.
- `src/gateway/config.ts` synthesizes a gateway config from `VECTOR_URL` when no
  gateway JSON exists.
- `src/gateway/index.ts` maps proxy failures to configured fallbacks.
- `src/server/vector-proxy.ts` is the typed route client for `/api/search`,
  `/api/similar`, `/api/compare`, `/api/map`, `/api/map3d`, `/api/vector/stats`,
  and `/api/vector/health`.
- `src/server/handlers.ts` uses `createVectorProxy(VECTOR_URL)` for the vector
  leg of hybrid/vector search, with FTS5 fallback when the proxy fails.
- `src/routes/vector/{map,map3d,similar,compare,stats}.ts` use route-level
  `VECTOR_URL` proxy clients.
- `src/vector/runtime-status.ts` reports `vectorMode: "proxied"` when
  `VECTOR_URL` resolves.

Doc guidance: describe this as a coarse HTTP split of the existing API surface,
not as the storage-adapter protocol.

### 2. `ProxyVectorAdapter` storage protocol

Files:

- `src/vector/types.ts` includes `proxy` in `VectorDBType`.
- `src/vector/factory.ts` maps `type: "proxy"` / `ORACLE_VECTOR_DB=proxy` to
  `new ProxyVectorAdapter(...)` after `requireVectorProxyContract(...)`.
- `src/vector/proxy-contract.ts` owns endpoint resolution and validation:
  `ORACLE_PROXY_VECTOR_URL` first, `VECTOR_DB_URL` second, http(s) only,
  credentials/hash stripped, default timeout `15000`, health timeout `5000`.
- `src/vector/proxy-protocol.ts` defines `vector-proxy-v1` routes:
  `/vectors/add`, `/vectors/query`, `/vectors/stats`, `/vectors/collection`,
  and `/health`.
- `src/vector/adapters/proxy.ts` implements the adapter, including tenant header
  forwarding through `TENANT_HEADER` when `currentTenantId()` is available.
- `src/vector/adapters/turbovec.ts` extends `ProxyVectorAdapter` for services
  that speak the same protocol, resolving endpoint from explicit config,
  `ORACLE_TURBOVEC_URL`, or `TURBOVEC_URL`.

Doc guidance: this is the installable/local vector DB abstraction. For sidecars,
prefer documenting `ORACLE_PROXY_VECTOR_URL`; mention `VECTOR_DB_URL` only as
backward-compatible fallback.

### 3. Manifest passthrough using `VECTOR_DB_URL`

Files:

- `src/vector/config.ts` adds `proxy: defaultVectorProxyManifest()` to the
  default vector server config.
- `src/vector/config.ts` default manifest: `path: "/api/vector-db"`,
  `targetEnv: "VECTOR_DB_URL"`, `stripPrefix: true`.
- `src/vector/config-types.ts` aliases `VectorProxyManifest` to
  `UnifiedProxyManifest` and allows `proxy?: VectorProxyManifest[]`.
- `src/vector/config-normalize.ts` preserves configured `proxy` entries or the
  defaults.
- `src/vector/proxy-manifest.ts` returns the active manifests and delegates
  forwarding to `proxyRequestForManifest(...)`.
- `src/routes/vector/proxy.ts` mounts each manifest as an `ALL` Elysia route.

Doc guidance: this is a generic HTTP passthrough mounted under vector routes. It
is not the same as the `vector-proxy-v1` adapter protocol, even though both can
use `VECTOR_DB_URL`.

### 4. V2 registered proxy storage services

Files:

- `src/vector/config-types.ts` defines storage services with
  `type: "builtin" | "proxy"` and optional `endpoint` / `capabilities`.
- `src/vector/config-models.ts` returns an endpoint only for proxy services.
- `src/vector/factory.ts` maps fallback storage services with `type: "proxy"` to
  adapter `proxy` plus the registered endpoint.
- `src/vector/service-registry.ts` validates proxy service endpoints as http(s),
  checks `VECTOR_PROXY_ROUTES.health`, and rejects incompatible protocols.

Doc guidance: use this for multi-service config examples, but keep the endpoint
field separate from env-var-only `ProxyVectorAdapter` examples.

### 5. Standalone vector proxy server

Files:

- `src/vector/proxy-server.ts` serves the `vector-proxy-v1` protocol and backs it
  with `createVectorStore(...)`.
- `src/vector-server.ts` mounts `createVectorProxyServer(...)` and remains the
  intended target for `VECTOR_URL=http://host:port` route proxy deployments.
- `package.json` has `vector:proxy` as
  `ORACLE_VECTOR_DB=lancedb bun src/vector-server.ts`.

Doc guidance: this process can be both a `VECTOR_URL` route target and the server
implementation of `vector-proxy-v1`, but those are separate client contracts.

## Raw `src/vector` proxy hit list

- Contract/runtime: `proxy-contract.ts`, `proxy-protocol.ts`,
  `proxy-server.ts`, `proxy-manifest.ts`, `runtime-status.ts`.
- Adapter/factory: `adapters/proxy.ts`, `adapters/turbovec.ts`,
  `adapters/index.ts`, `factory.ts`, `types.ts`.
- Config/registry: `config.ts`, `config-types.ts`, `config-normalize.ts`,
  `config-models.ts`, `service-registry.ts`.
- Tests/fixtures: `__tests__/proxy-contract.test.ts`,
  `__tests__/proxy-server.test.ts`, and benchmark fixtures that contain the word
  `proxy` only in sample text.

## Recommendation for #2227 docs

Use separate docs headings for:

1. `VECTOR_URL` API route proxy.
2. `ORACLE_VECTOR_DB=proxy` + `ORACLE_PROXY_VECTOR_URL` vector-store protocol.
3. `vector-server.json.proxy[]` manifest passthrough with `VECTOR_DB_URL`.

That separation should prevent plugin docs from promising that one proxy env var
covers every deployment shape.
