# Deploy Oracle Studio on Vercel

Use this path when you want Vercel to serve the React/Vite Studio while a
running Oracle HTTP backend handles `/api/*` requests.

## One-click deploy

1. Click **Deploy with Vercel** in the root README.
2. Set the `ORACLE_URL` environment variable to your Oracle backend, for
   example `https://oracle.example.com`.
3. Deploy. Vercel builds `frontend/` and serves `frontend/dist`.
4. Open the deployment URL and confirm Studio loads.
5. Test the proxy:

```bash
curl -sf https://<your-vercel-app>.vercel.app/api/health
```

## Manual deploy

```bash
bun install
cd frontend && bun run build
cd ..
vercel deploy --prod
```

Use the Vercel dashboard or CLI to set the production env var:

```bash
vercel env add ORACLE_URL production
```

## Runtime shape

```text
Vercel static files     frontend/dist
/api/*                 api/proxy.ts -> ORACLE_URL/api/*
SPA fallback            /index.html
```

`vercel.json` keeps the Vite build command, static output directory, immutable
asset caching, and the `/api/:path*` rewrite to the proxy function.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `ORACLE_URL` | yes | Public or private Oracle HTTP API base URL. |
| `ORACLE_HTTP_URL` | fallback | Backward-compatible alias for `ORACLE_URL`. |
| `ORACLE_API` | fallback | Legacy alias for `ORACLE_URL`. |

Do not commit tokens or tenant secrets to `vercel.json`; configure them in
Vercel project environment variables.

## Notes

- The proxy strips hop-by-hop headers and overwrites the Host header.
- `OPTIONS /api/*` stays local for browser preflight.
- The proxy adds `x-oracle-studio-vercel` and `cache-control: no-store`.
- Phase 2 can add an MCP-specific function if `/mcp` needs separate handling.
