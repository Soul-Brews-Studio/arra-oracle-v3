# hook-menu package

> **Status**: Extracted, not yet consumed. This repo still uses the in-tree copy under `src/routes/menu/` and `src/menu/`.

The reusable parts of the Oracle navigation system — TypeBox schemas, `buildMenuItems`, studio-tag helpers, and the Elysia plugin — have been lifted into a standalone repo:

**→ https://github.com/Soul-Brews-Studio/hook-menu**

## What moved

| In-tree source | hook-menu module |
|---|---|
| `src/routes/menu/model.ts` | `hook-menu/model` — `MenuItem`, `MenuItemSchema`, `MenuResponseSchema` |
| `src/routes/menu/menu.ts` (`buildMenuItems` + route-declared `detail.menu.path`) | `hook-menu/build` — `buildMenuItems`, `defineMenu` |
| `src/routes/menu/studio-tag.ts`, `studio-href.ts` | `hook-menu/studio` — `parseStudioTag`, `studioHref` |
| `src/menu/frontend.ts` (hardcoded items) | `hook-menu/frontend` — `defineFrontendMenu` (parametrized — takes items as input) |
| `src/routes/menu/menu.ts` (`createMenuEndpoint`) | `hook-menu/elysia` — `mountMenu` |

## What did not move

- The hardcoded frontend items list (`/canvas`, `/planets`, `/map`, …) stays arra-specific. The package exposes a parametrized `defineFrontendMenu` that accepts an items array.
- React hooks / components — explicitly out of scope for v0.1 (backend only).

## Install pattern

No npm publish. Consume directly from GitHub via Bun:

```bash
bunx github:Soul-Brews-Studio/hook-menu
```

Or as a dep:

```json
{ "dependencies": { "hook-menu": "github:Soul-Brews-Studio/hook-menu" } }
```

## Follow-up

Swapping arra-oracle-v3's in-tree `src/routes/menu/*` + `src/menu/*` for `hook-menu` imports is deliberately **not** part of #906. Track that as a separate task — it's a pure migration once the package stabilizes.

## Origin

- Extracted from commits landing Oracle menu work prior to 2026-04-19.
- Closes #906.
