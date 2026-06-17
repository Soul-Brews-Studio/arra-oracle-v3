# Proxy terminology (#2227)

`proxy` names three different seams in Arra Oracle. Use the qualified term
below in issues, PRs, and docs so storage changes do not get confused with HTTP
gateway or plugin passthrough work.

## The three proxy meanings

| Qualified term | Code surface | Config surface | Meaning | Not this |
| --- | --- | --- | --- | --- |
| **Request-tier gateway proxy** | `gatewayPlugin()` in `src/gateway/index.ts` | `VECTOR_URL` or `oracle-gateway.json` | Proxies selected incoming HTTP API routes to another service before local Elysia routes run. `VECTOR_URL` synthesizes routes such as `/api/search`, `/api/vector/**`, `/api/map`, and `/api/map3d`. | It does not select a `VectorStoreAdapter`, implement `/vectors/*`, or mean plugin `proxy[]`. |
| **Storage-tier vector proxy adapter** | `ProxyVectorAdapter` and `TurboVecAdapter` | `ORACLE_VECTOR_DB=proxy`, `ORACLE_PROXY_VECTOR_URL`, `VECTOR_DB_URL`, `ORACLE_TURBOVEC_URL`, or collection `service` endpoint | Makes backend vector calls to an external vector service using the vector protocol: `GET /health`, `POST /vectors/add`, `POST /vectors/query`, `GET /vectors/stats`, `DELETE /vectors/collection`. | It does not route browser/API requests and does not create local storage. |
| **Manifest passthrough proxy** | `plugin.json` `proxy[]`, `createUnifiedProxyRoute()`, `proxyRequestForManifest()` | `targetEnv`, `path`, `methods`, `stripPrefix` in a plugin manifest | Adds a plugin-owned HTTP passthrough route that forwards matching requests to a target URL from an env var. | It does not imply vector storage, `VECTOR_URL`, or automatic service discovery. |

## External-only adapter labels

The `proxy` and `turbovec` vector adapters are **external-only client
adapters**:

- they require an already running remote service;
- they do not open LanceDB, SQLite, or local vector files;
- they do not start TurboVec or any sidecar process;
- they only speak the documented vector HTTP protocol;
- collection export/map/map3d features need explicit remote protocol support
  before treating these adapters as primary full-store replacements.

Use `external-only` in docs or UI labels when an operator must provide the
remote endpoint. Use `embedded` only for adapters that can own their storage in
the Arra backend process.

## Decision checklist

- Are you forwarding **incoming `/api/*` requests** to another HTTP service?
  Use **request-tier gateway proxy**.
- Are you making **vector store calls** from backend code to a vector service?
  Use **storage-tier vector proxy adapter**.
- Are you exposing a **plugin-declared passthrough route**?
  Use **manifest passthrough proxy**.
