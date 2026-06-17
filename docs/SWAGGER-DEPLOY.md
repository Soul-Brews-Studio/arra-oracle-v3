# Deploying `/api/docs` Publicly

Verified against `src/server.ts`, `src/server/api-token-auth.ts`,
`scripts/export-openapi.ts`, and `tests/http/swagger/export-openapi.test.ts`.
The main Elysia app uses `@elysiajs/swagger` with `provider: 'swagger-ui'`.

## Live routes

| Route | Behavior |
| --- | --- |
| `/api/docs` | Swagger UI. Public even when `ARRA_API_TOKEN` is set. |
| `/api/docs/json` | Canonical OpenAPI JSON. |
| `/swagger` | `308` redirect to `/api/docs`. |
| `/swagger/json` | `308` redirect to `/api/docs/json`. |
| `/api/openapi.json` | `308` redirect to `/api/docs/json`. |

`/api/docs-malicious` is not public; the API-token guard only exempts
`/api/docs` and descendants.

## Export the spec

`scripts/export-openapi.ts` starts `bun src/server.ts` on a scratch port,
polls `/`, fetches a spec path, validates OpenAPI 3 metadata, writes JSON, then
stops the child process.

Use the canonical path when exporting fresh docs:

```bash
bun scripts/export-openapi.ts --spec-path /api/docs/json --out docs/openapi.json
```

The script default currently asks `/api/openapi.json`, which works only because
that route redirects to `/api/docs/json`.

## Option A — proxy live docs

Forward only `GET`/`HEAD` for `/api/docs` and `/api/docs/json` to the Oracle
HTTP backend. Do not expose the whole `/api/*` surface just to publish docs.

```caddy
studio.buildwithoracle.com {
  @docs path /api/docs /api/docs/json
  reverse_proxy @docs http://oracle-world.wg:47778

  reverse_proxy http://127.0.0.1:3000
}
```

Cloudflare Worker sketch:

```ts
export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const allowed = url.pathname === '/api/docs' || url.pathname === '/api/docs/json';
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('method not allowed', { status: 405 });
    if (!allowed) return new Response('not found', { status: 404 });
    return fetch(new URL(url.pathname + url.search, 'https://oracle-origin.example.com'));
  },
};
```

## Option B — static OpenAPI artifact on Workers

Serve `docs/openapi.json` plus a viewer shell as static Worker assets. This does
not expose the live backend, but the artifact must be regenerated whenever API
routes or schemas change.

Minimal layout:

```text
docs/
├── openapi.json
└── site/
    └── index.html
```

A viewer shell can point to `/openapi.json` with Swagger UI, Scalar, or Redoc.
The live backend UI is Swagger UI; static docs are just an OpenAPI artifact.

`wrangler.jsonc` shape:

```json
{
  "name": "arra-oracle-docs",
  "main": "docs/worker.ts",
  "compatibility_date": "2026-06-17",
  "assets": { "directory": "docs/", "binding": "ASSETS" },
  "observability": { "enabled": true }
}
```

`docs/worker.ts` can serve `/site/index.html` for `/` and otherwise delegate to
`ASSETS`.

## Verification

```bash
bun scripts/export-openapi.ts --spec-path /api/docs/json --out docs/openapi.json
bun test --isolate tests/http/swagger/export-openapi.test.ts src/integration/api-token-auth.test.ts
bunx tsc --noEmit
```

Manual route checks on a running server:

```bash
curl -i http://127.0.0.1:47778/api/docs
curl -i http://127.0.0.1:47778/api/docs/json
curl -i http://127.0.0.1:47778/swagger
curl -i http://127.0.0.1:47778/api/openapi.json
```
