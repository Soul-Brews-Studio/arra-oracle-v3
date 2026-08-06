# HTTP Middleware Order

Source of truth: `src/server.ts`. Requests pass through outer fetch wrappers,
then the Elysia app pipeline. Keep docs in this file tied to concrete filenames
and env vars; the unsupported per-minute alias and singular rate-limit filename
are intentionally omitted because current source uses profile keys and
`src/middleware/rate-limiter.ts`.

## Outer fetch path

`createStartedApp()` returns a fetch handler equivalent to:

```ts
fetch(request) => drainingResponseFor(request)
  ?? trackRequest(() => createRequestTimeoutFetch(
    createRequestDedupFetch(
      createApiVersionedFetch(
        createTenantFetch(
          createDbContextFetch((request) => app.fetch(request))
        )
      )
    )
  )(request))
```

Order:

1. `drainingResponseFor` / `trackRequest` (`src/lifecycle/shutdown.ts`)
   - Short-circuits during graceful shutdown and tracks in-flight requests.
2. `createRequestTimeoutFetch` (`src/middleware/timeout.ts`)
   - Config: `ARRA_REQUEST_TIMEOUT_MS`, default `30000`.
3. `createRequestDedupFetch` (`src/middleware/dedup.ts`)
   - Coalesces `GET`/`HEAD` by URL plus auth, cookie, range, accept, and tenant headers.
4. `createApiVersionedFetch` (`src/middleware/api-version.ts`)
   - Rewrites `/api/v1/*` internally to `/api/*`; redirects unversioned API callers to `/api/v1/*` except the exact infrastructure path `/api/health`.
   - Temporary compatibility: hosted legacy Studio/Feed origins are allowed to call old unversioned API paths directly; localhost and CLI callers still receive 308 redirects.
5. `createTenantFetch` (`src/middleware/tenant.ts`)
   - Config: `ORACLE_TENANT_TOKENS`, `ORACLE_TENANT_API_KEYS`.
   - Headers: `X-Oracle-Tenant`, `X-Oracle-Tenant-Token`; aliases `X-Tenant-ID`, `X-Org-Id`, `X-API-Key`.
6. `createDbContextFetch` (`src/middleware/db-context.ts`)
   - Stores request id context for DB tracing.
7. `app.fetch` (Elysia app below).

## Elysia app pipeline

Registered by `createApp()` in this order:

1. `createRequestLoggingMiddleware` (`src/middleware/request-logger.ts`)
   - Structured request log, redacts `authorization` and `proxy-authorization`.
2. `createCorrelationMiddleware` (`src/middleware/correlation.ts`)
   - Adds `X-Request-Id`, `X-Response-Time`, and `x-correlation-id`.
3. `createTenantMiddleware` (`src/middleware/tenant.ts`)
   - Adds `X-Oracle-Tenant` response header or returns tenant config errors.
4. `createPrivateNetworkPreflightMiddleware` then `createCorsMiddleware` (`src/middleware/cors.ts`)
   - Config: `ARRA_CORS_ORIGINS`, legacy `ORACLE_CORS_ORIGIN`, `CORS_ORIGIN`.
5. `createApiVersionHeaderMiddleware` (`src/middleware/api-version.ts`)
   - Adds `X-API-Version: v1`.
6. `createSecurityHeadersMiddleware` (`src/middleware/security-headers.ts`)
   - Config: `ARRA_HSTS=true` adds HSTS.
7. `createContentTypeMiddleware` (`src/middleware/content-type.ts`)
   - Enforces JSON response negotiation.
8. `createBodyLimitMiddleware` (`src/middleware/body-limit.ts`)
   - Config: `ARRA_MAX_BODY_KB`, default `1024`.
9. `createApiKeyAuthMiddleware` (`src/middleware/auth.ts`)
   - Config: `ARRA_API_KEY`; bypasses `/api/health` only.
10. `createRateLimiterMiddleware` (`src/middleware/rate-limiter.ts`)
    - Installed with `DEFAULT_RATE_LIMIT_RULES`: `/api/search` 30/min and `/api/learn` 10/min.
    - Profile envs validated by `src/config/schema.ts` and `src/config/profiles.ts`: `ARRA_RATE_LIMIT_ENABLED`, `ARRA_RATE_LIMIT_TOKENS_PER_WINDOW`, `ARRA_RATE_LIMIT_WINDOW_MS`, `ARRA_RATE_LIMIT_BURST`.
11. `createMetricsLifecycle` (`src/routes/metrics/index.ts`).
12. `swagger({ provider: 'swagger-ui', path: '/api/docs', specPath: '/api/docs/json' })`.
13. Response shaping: `createResponseFormatMiddleware`, `createCompressMiddleware`, `createEtagMiddleware`.
14. Inline legacy API-token guard (`src/server/api-token-auth.ts`)
    - Config: `ARRA_API_TOKEN`; exempts `/api/health` and `/api/docs` descendants.
15. Inline no-cache/referrer headers, then `createErrorMiddleware` (`src/middleware/errors.ts`).
16. `gatewayPlugin`, docs redirects, root route, API/MCP/menu modules, plugin route mount, then `createNotFoundMiddleware`.

## Verification

Use current source and tests, not stale docs:

```bash
grep -n "createRequestTimeoutFetch\|createRequestLoggingMiddleware\|swagger" src/server.ts
bun test --isolate tests/http/rate-limiter/rate-limiter.test.ts src/integration/api-token-auth.test.ts
bunx tsc --noEmit
```
