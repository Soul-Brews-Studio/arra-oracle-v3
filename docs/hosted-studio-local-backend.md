# Hosted Studio local backend connection

Hosted Oracle Studio can talk directly to a user's local backend, matching the
Drizzle Studio pattern:

```text
https://god.buildwithoracle.com/?host=localhost:47778
```

The frontend host resolver owns `?host=` persistence. `BackendGate` is the
support screen around that resolver: it hides the dashboard while `/api/health`
is unreachable and shows a "Connect to your Oracle" form that reloads Studio
with a `host` query parameter.

## User flow

1. Start the local backend:

   ```bash
   arra-oracle-v3 serve
   ```

2. Open hosted Studio with an optional host override:

   ```text
   https://god.buildwithoracle.com/?host=localhost:47778
   ```

3. If the backend is not reachable, use the setup form to enter a local host
   such as `localhost:47778` or `127.0.0.1:47778`.

## Backend CORS and PNA

The Bun backend default CORS policy allows:

- `http://localhost:3000`
- `http://127.0.0.1:3000`
- `http://localhost:4321`
- `http://127.0.0.1:4321`
- `https://god.buildwithoracle.com`

Chrome Private Network Access preflights are handled by the existing
private-network middleware. For hosted Studio to local backend requests, the
preflight must include:

```http
Origin: https://god.buildwithoracle.com
Access-Control-Request-Private-Network: true
```

The backend responds with:

```http
Access-Control-Allow-Origin: https://god.buildwithoracle.com
Access-Control-Allow-Private-Network: true
```

Operators can still override defaults with `ARRA_CORS_ORIGINS`,
`ORACLE_CORS_ORIGIN`, or `CORS_ORIGIN`; include the hosted Studio origin when
using custom values.
