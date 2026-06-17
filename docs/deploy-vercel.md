# Deploy Oracle Studio on Vercel

Use this path when you want Vercel to serve the React/Vite Studio while a
running Oracle HTTP backend handles `/api/*` requests. The repository keeps the
make-it-work-first Vercel config in `vercel.json` and the proxy function in
`api/proxy.ts`.

## One-click deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3&env=ORACLE_URL&envDescription=Oracle%20HTTP%20API%20base%20URL%20for%20the%20Studio%20API%20proxy&envLink=https%3A%2F%2Fgithub.com%2FSoul-Brews-Studio%2Farra-oracle-v3%2Fblob%2Falpha%2Fdocs%2Fdeploy-vercel.md%23environment-variables&project-name=arra-oracle-studio&repository-name=arra-oracle-studio)

1. Click **Deploy with Vercel** in the root README or this guide.
2. Set `ORACLE_URL` to the Oracle backend, for example
   `https://oracle.example.com`.
3. Deploy. Vercel runs `cd frontend && bun run build` and serves
   `frontend/dist`.
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

## Project settings

`vercel.json` owns the Vite build, static output directory, SPA fallback, and
`/api/:path*` rewrite:

```json
{
  "framework": "vite",
  "buildCommand": "cd frontend && bun run build",
  "outputDirectory": "frontend/dist"
}
```

Vercel's deploy button flow reads this repo config after cloning. If you test a
branch without `vercel.json`, set equivalent values in Project Settings.

## Environment variables

| Name | Required | Description |
| --- | --- | --- |
| `ORACLE_URL` | yes | Public or private Oracle HTTP API base URL. |
| `ORACLE_HTTP_URL` | fallback | Backward-compatible alias for `ORACLE_URL`. |
| `ORACLE_API` | fallback | Legacy alias for `ORACLE_URL`. |

Do not commit tokens or tenant secrets to `vercel.json`; configure them in
Vercel project environment variables.

## Runtime shape

```text
Vercel static files     frontend/dist
/api/*                 api/proxy.ts -> ORACLE_URL/api/*
SPA fallback            /index.html
```

## Local smoke check

Before deploying a branch preview, run:

```bash
bun install
bunx tsc --noEmit
cd frontend
bun install
bun run build
```

Then confirm the backend is reachable from the public internet:

```bash
curl -sf "$ORACLE_URL/api/health"
```

## Troubleshooting

- **Build cannot find `dist`:** verify the build command runs from the repo root
  and the output directory is `frontend/dist`.
- **Studio loads but API calls fail:** set `ORACLE_URL` to the backend origin,
  not to a path under `/api`.
- **CORS errors:** allow the Vercel preview/production origin in the backend or
  route calls through the Vercel proxy.
- **404 on deep links:** confirm the SPA fallback rewrite to `/index.html` is
  present.

## Notes

- The proxy strips hop-by-hop headers and overwrites the Host header.
- `OPTIONS /api/*` stays local for browser preflight.
- The proxy adds `x-oracle-studio-vercel` and `cache-control: no-store`.
- Phase 2 can add an MCP-specific function if `/mcp` needs separate handling.

## References

- Vercel Deploy Button: https://vercel.com/docs/deploy-button
- Deploy Button source parameters: https://vercel.com/docs/deploy-button/source
- Deploy Button environment variables: https://vercel.com/docs/deploy-button/environment-variables
- Vite on Vercel: https://vercel.com/docs/frameworks/frontend/vite
