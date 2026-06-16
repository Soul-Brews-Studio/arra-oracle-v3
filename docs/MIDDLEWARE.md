# HTTP Middleware Order

Source of truth: `src/server.ts`. The server has two layers: outer fetch wrappers, then the Elysia app pipeline.
Keep this order stable unless a middleware explicitly needs to run earlier for short-circuit responses.

## Outer fetch wrappers

1. `trackRequest` (`src/lifecycle/shutdown.ts`)
   - Tracks in-flight requests for graceful shutdown.
   - Config: none.
2. `createRequestTimeoutFetch` (`src/middleware/timeout.ts`)
   - Aborts slow handlers and returns structured `408` JSON.
   - Config: `ARRA_REQUEST_TIMEOUT_MS` (default `30000`).
3. `createApiVersionedFetch` (`src/middleware/api-version.ts`)
   - Serves `/api/v1/*` by rewriting internally to `/api/*` and redirects legacy `/api/*` callers.
   - Config: none; current version is `v1`.

## Elysia app pipeline

1. `requestLogger.onRequest` (`src/middleware/logger.ts`)
   - Captures start metadata and redacted request headers for after-response logging.
   - Config: none.
2. `createCorrelationMiddleware` (`src/middleware/correlation.ts`)
   - Adds `X-Request-Id` and `X-Response-Time`; runs before short-circuiting middleware.
   - Config: none. Accepts inbound `X-Request-Id` / `x-correlation-id` only when needed by helpers.
3. `createPrivateNetworkPreflightMiddleware` (`src/middleware/cors.ts`)
   - Handles Private Network Access preflight before route/auth work.
   - Config: `ARRA_CORS_ORIGINS` (or legacy `ORACLE_CORS_ORIGIN` / `CORS_ORIGIN`);
     defaults to explicit local development origins, not `*`.
4. `createCorsMiddleware` (`src/middleware/cors.ts`)
   - Handles normal CORS preflight and response CORS headers.
   - Config: `ARRA_CORS_ORIGINS` (or legacy `ORACLE_CORS_ORIGIN` / `CORS_ORIGIN`);
     defaults to explicit local development origins, not `*`.
5. `createApiVersionHeaderMiddleware` (`src/middleware/api-version.ts`)
   - Adds `X-API-Version: v1` to responses and errors.
   - Config: none.
6. `createSecurityHeadersMiddleware` (`src/middleware/security-headers.ts`)
   - Adds `X-Content-Type-Options`, `X-Frame-Options`, `X-XSS-Protection`, optional HSTS.
   - Config: `ARRA_HSTS=true` enables `Strict-Transport-Security`.
7. `createContentTypeMiddleware` (`src/middleware/content-type.ts`)
   - Enforces JSON response negotiation and sets `Content-Type` when missing.
   - Config: none.
8. `createBodyLimitMiddleware` (`src/middleware/body-limit.ts`)
   - Rejects oversized request bodies before route parsing.
   - Config: `ARRA_MAX_BODY_KB` (default `1024`).
9. `createRateLimitMiddleware` (`src/middleware/rate-limit.ts`)
   - In-memory per-IP request limiting; bypasses `/api/health`.
   - Config: `ARRA_RATE_LIMIT_RPM` (default `60`). Profile envs `ARRA_RATE_LIMIT_*` feed startup config/banner defaults.
10. `createApiKeyAuthMiddleware` (`src/middleware/auth.ts`)
   - Optional bearer-token auth for API routes; bypasses `/api/health`.
   - Config: `ARRA_API_KEY`.
11. `createMetricsLifecycle` (`src/routes/metrics/index.ts`)
    - Records request metrics and exposes metrics routes.
    - Config: none.
12. Inline legacy API-token guard (`src/server/api-token-auth.ts`)
    - Protects legacy API paths when token auth is configured.
    - Config: `ORACLE_API_TOKEN`, `ARRA_API_TOKEN`.
13. Inline cache/referrer headers (`src/server.ts`)
    - Adds `Cache-Control` and `Referrer-Policy` after handlers.
    - Config: none.
14. `requestLogger.onAfterResponse` (`src/middleware/logger.ts`)
    - Emits the final structured request log.
    - Config: `ARRA_VERBOSE_LOGGING` / `DEBUG` affect broader runtime verbosity, not this logger directly.
15. `createErrorMiddleware` (`src/middleware/errors.ts`)
    - Converts errors to structured JSON and preserves request/timing headers.
    - Config: none.
16. Swagger, gateway, peer, API, MCP, and menu route modules
    - Registered after global middleware so routes inherit the headers/auth/timeout stack.
    - Config examples: `VECTOR_URL`, `ORACLE_GATEWAY_HOT_RELOAD`, plugin and route-specific env vars.

## Verification

`tests/integration/middleware-order.test.ts` starts the real server and asserts:

- `X-Request-Id` is present on an API response.
- `X-Response-Time` is present on an API response.
- Security headers are present on an API response.
- CORS preflight returns the expected CORS headers.
