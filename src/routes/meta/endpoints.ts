/**
 * The endpoint map the root `/` advertises, and the API root that answers at `/api/v1`.
 *
 * One definition, because it used to be two: `server.ts` listed `docs` both as a top-level
 * field and inside `endpoints`, and they could drift independently.
 *
 * Measured against the live server before this existed:
 *
 * ```
 * /api/docs        308   → only works if the client follows redirects
 * /api/docs/json   308   → same
 * /api/v1          404   → advertised as "api", dead even when followed
 * ```
 *
 * That map is the product's front door — `maw arra` and the #2820 enrichment read it. A
 * discovery document that sends a client to a 404 is the declared-but-not-true defect of
 * #2822 / #2831 / #2862, in the one place where being wrong is most expensive.
 *
 * **Paths here are the PUBLIC ones.** `middleware/api-version.ts` rewrites an incoming
 * `/api/v1/foo` to `/api/foo` before routing, so a handler for the public `/api/v1` must be
 * registered at `/api`. Getting that backwards is why the first attempt still 404'd.
 *
 * Pinned by `tests/http/root/advertised-endpoints.test.ts`, which derives its cases from the
 * running server — so adding an entry here puts it under the same obligation automatically.
 */

/** Public paths, as a client sees them. Every one must answer without a redirect. */
export const PUBLIC_ENDPOINTS = {
  docs: '/api/v1/docs',
  openapi: '/api/v1/docs/json',
  api: '/api/v1',
  mcp: '/mcp',
  health: '/api/v1/health',
  stats: '/api/v1/stats',
  simple: '/simple',
} as const;

/** What `/api/v1` returns: the versioned endpoints, so one GET describes the API. */
export function apiRootResponse(version: string) {
  return {
    version,
    endpoints: {
      docs: PUBLIC_ENDPOINTS.docs,
      openapi: PUBLIC_ENDPOINTS.openapi,
      health: PUBLIC_ENDPOINTS.health,
      stats: PUBLIC_ENDPOINTS.stats,
    },
  };
}
