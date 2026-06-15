# AGENTS.md — arra-oracle-v3 Operating Contract

<!-- last verified: 2026-06-15 — re-check claims against code if >7 days old (/rrr should flag). -->

Top-level contract for **every** agent working in this repo (codex/omx coders,
Claude leads, human contributors). omx auto-generates a session-local AGENTS.md
for its own runtime; **this** file is the project-level source of truth and
overrides anything that conflicts. Mirrors `CLAUDE.md` Project Conventions.

**Verify claims against code, not this file.** Docs go stale (the Hono→Elysia
note lagged the real state by ~57 days). A `grep`/`tsc`/`bun test` is cheaper
than acting on a stale claim. Coders: when a task contradicts the verified code
state, BLOCK and ask the lead — do not guess.

> arra-oracle-v3 is the **MCP memory / search layer** for the Oracle family:
> semantic search over 20k+ docs (bge-m3 + nomic + qwen3 + FTS5), the indexer
> pipeline, federation plumbing, and the `muninn_search` MCP surface.

---

## 1. Team Model

- **Lead** (`claude`): architecture, reference modules, contract/boundary
  decisions, review-before-merge. Reasoning-heavy work stays here.
- **Coders** (`codex-N`, engine `omx`): mechanical fan-out once a reference
  module + pattern exist. One coder = one route cluster / module.
- **Pattern — Reference-First Fan-Out:** the lead ships ONE reference module
  first; coders copy that shape. No reference → codex drift → inconsistent work.
- Engine map lives in `.maw/maw.config.80.json` (`claude48` lead, `omx` coders,
  `sonnet` digger). Worktrees: `agents/1-codex-N/` (git worktrees, gitignored).

## 2. Branch Rules — push to `alpha`, never `main`

- **`alpha` is the working trunk.** All feature/fix work targets `alpha`.
- **`main` → STABLE release** (`calver-release.yml` tags `vX.Y.Z` marked latest).
  ⚠️ NEVER push or merge to `main` without explicit user direction in-session.
  A repo-local hook (`.claude/hooks/block-push-main.sh`) blocks pushes to main.
- **`alpha` → PRE-RELEASE** (`vX.Y.Z-alpha.N`, prerelease, not latest). This is
  the default. RELEASE POLICY: **always alpha.**
- Coders work in their existing worktree; **merge `origin/main`/`origin/alpha`
  before starting** so you branch from current trunk.

## 3. No Force Ops (safety)

- **Never** `git push --force` / `-f`, `git checkout -f`, `git clean -f`,
  `rm -rf`. Resolve conflicts with a normal merge.
- **Never** merge a PR without explicit user approval (`gh pr merge` is gated).
- Destructive/outward actions (push, PR, deploy) are confirm-first.

## 4. Issue → PR Flow

1. Branch from current `alpha`.
2. Implement; keep commits descriptive (`feat:`/`fix:`/`chore:` …).
3. **Build gate must pass** (§6) before push.
4. `git push -u origin <branch>` → `gh pr create` targeting **`alpha`**.
5. Report (§7). Wait for review. Do not self-merge.

## 5. File Layout & Size

- **≤ 250 lines per file** (source, tests, docs). Over → split by concern,
  don't pad with helpers.
- **Tests: nested, one behavior per file**, mirroring the route tree:
  `tests/http/<cluster>/<endpoint>.test.ts`. HTTP contract tests are
  fetch-based against a spawned Elysia server.
- **Web framework: Elysia** (TypeBox schemas). The Hono → Elysia migration is
  **complete** — all route clusters in `src/routes/` are native Elysia sub-apps
  composed in `src/server.ts`; no Hono remains. New clusters: add a `new Elysia()`
  sub-app under `src/routes/<cluster>/` and `.use()` it in `src/server.ts`.
  `src/routes/health/` is the cleanest reference module. maw-js is the family ref.

## 6. Build Gate

- Runtime: **Bun ≥ 1.2** — `bun test`, `bun run`, `bunx --bun`. No Node-only APIs.
- Type-check is the build: `tsc --noEmit` must pass (github-only repo, no binary).
- `bun test` (or the scoped cluster, e.g. `bun test tests/http/forum/`) green
  before any push.

## 7. Reporting (codex → lead)

**Three reports, no intermediate noise** (family standard; cross-checked tee+ting):
- 🟢 `starting <task> — plan: ...` — send ON RECEIPT. This is a delivery-ACK:
  `maw hey` can silently fail to reach a coder, so without it the lead can't tell
  a lost dispatch from a working coder. Keep it.
- ❌ `blocked: <exact reason>` (+ the alternative you already tried)
- ✅ `done <task> — commit <sha>, build pass, PR <url>` (+ screenshot if UI)

Do NOT report intermediate failures — handle your own implement→verify→fix loop
silently (this is the ~70% noise cut, NOT dropping `starting`). Never go dark;
never forget `done` — silence after `starting` reads as stalled, and the lead
will peek/nudge.

### Done-criteria checklist (self-verify BEFORE reporting done)
- [ ] `bun run build` / `tsc --noEmit` passes
- [ ] scoped `bun test tests/http/<cluster>/` green (NOT bare `bun test` — it
      pulls agents/ worktree copies)
- [ ] every changed file ≤ 250 lines (`wc -l`)
- [ ] self `git diff` review — no stray `console.log`/debug, no dead code
- [ ] no endpoint/function others rely on was removed or renamed
- [ ] `actionlint` if a workflow was touched; screenshot if UI changed
- [ ] branched from current `origin/alpha`; no force operations used
- [ ] committed to your branch; PR targets `alpha`

### Review & merge
The **lead reviews every PR before merge** (mergeable? file sizes? build/test
report? screenshot?). No peer review between coders — worktrees are isolated, so
coders cannot see each other's uncommitted work and coordinate only through the
lead. **Coders never self-merge.**

## 8. Data / Schema

- Schema changes go through **Drizzle** (`src/db/schema.ts`) + `bun db:push`.
  Never inline `CREATE TABLE` / `ALTER TABLE` / raw `CREATE INDEX` in code.
  Back up before migrations (db:push index `IF NOT EXISTS` caveat).

## 9. Tech Stack (quick map)

- `src/vector/`, `src/indexer/` — embeddings (batch via Ollama) + indexing
- `src/tools/` — MCP tools (`muninn_search`)
- `src/gateway/`, `src/peer/` — federation
- `src/vault/`, `src/trace/`, `src/learn/` — knowledge management
- `src/routes/` — Elysia route clusters (`.use()`-composed in `src/server.ts`)
- HTTP backend on `:47778`; frontend (Vite) on `:3000` proxying `/api/*`

**Route clusters (21, all under `src/routes/<cluster>/`):** auth, dashboard,
feed, files, forum, health, indexer, indexer-daemon, knowledge, menu, oraclenet,
peer, plugins, schedule, search, sessions, settings, supersede, traces, vault,
vector. Auth-guarded `/api/*` except open `/health`, `/peer/*`, `/identity`
(federation). To regenerate this list: `ls src/routes/`. `src/routes/health/` is
the reference module for a new cluster.

---

**Source of truth precedence:** `AGENTS.md` ≡ `CLAUDE.md` Project Conventions >
omx session AGENTS.md > role prompts. When in doubt, ask the lead — and never
touch `main`.
