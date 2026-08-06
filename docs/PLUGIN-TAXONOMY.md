# Plugin taxonomy

Arra currently has several plugin-shaped extension points. Keep the names below
precise so `unified plugin system` work does not mix backend lifecycle code with
frontend renderer code.

## ServerPlugin

**Meaning:** server-side API/lifecycle plugin.

**Code:** `src/server/plugin/types.ts`, `src/server/plugin/loader.ts`,
`src/server/plugin/unified.ts`.

**Owns:** Elysia routes, API mount paths, startup/shutdown lifecycle, optional
menu seeding, and server feature boundaries such as federation/maw, gateway,
vector, trace, and plugin manifest routes.

**Does not own:** browser rendering or canvas scene mounting.

## InstalledPlugin / WasmPlugin

**Meaning:** local plugin package discovered from the user's plugin directory and
optionally exposed through menu metadata.

**Code:** `src/routes/plugins/model.ts`, `src/routes/plugins/*`,
`src/routes/menu/*`.

**Owns:** scanning `~/.oracle/plugins` or `ORACLE_PLUGIN_DIR`, reading
`plugin.json`/`.wasm`, serving `/api/plugins`, and contributing menu entries.

**Does not own:** server lifecycle hooks or bundled canvas renderer execution.

## CanvasPlugin

**Meaning:** frontend renderer plugin for canvas hosts.

**Code:** `src/canvas/plugin.ts`.

**Owns:** a stable renderer contract selected by `/canvas?plugin=<id>` or a
future `canvas.buildwithoracle.com` host.

Canvas plugins are bundled frontend renderers, not arbitrary code loaded from the
server plugin registry. The first supported kinds are:

```ts
type CanvasPlugin =
  | { id: string; label: string; kind: 'three'; mount: CanvasSceneMount }
  | { id: string; label: string; kind: 'react'; renderer: CanvasReactRenderer };
```

`GET /api/plugins?kind=canvas` exposes CanvasPlugin metadata (`id`, `label`,
`kind`, `renderer`) for Studio and future canvas hosts to share one plugin list.
It exposes metadata only and does not imply dynamic execution of unsigned React
or Three code from the database.
