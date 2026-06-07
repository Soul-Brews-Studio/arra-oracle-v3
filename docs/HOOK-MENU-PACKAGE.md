# hook-menu package

> **Status**: Partially consumed in-tree. Arra now imports compatible backend helpers from `hook-menu`; the richer in-tree menu model/build endpoint remains local until the package catches up with route-owned `detail.menu.path/studio`, DB-backed ordering, custom/gist items, and submenu fields.

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

Part 1 of #1398 consumes the compatible `hook-menu/studio` helpers in-tree and removes those duplicated local implementations. Full replacement of `src/routes/menu/model.ts`, `src/routes/menu/menu.ts`, and `src/menu/*` is intentionally deferred until the package exposes the newer Arra-specific capabilities: route-owned `detail.menu.path/studio`, DB-backed menu rows, `id`/`parentId`, `scope`, `query`, `sourceName`, gist/custom sources, and plugin merging. React `useMenu` / `MenuRenderer` remains part 2.

## Origin

- Extracted from commits landing Oracle menu work prior to 2026-04-19.
- Closes #906.
