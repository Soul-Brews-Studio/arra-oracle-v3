# MORNING-TAPE — ARRA Oracle V3 Codex Builder

Purpose: recover enough context to work safely in under two minutes after a fresh session or compaction.

Boot self-check:

- ✅ Target read time is ≤2 minutes.
- ✅ Wake protocol, memory map, task loop, and blocked report format are present.
- ✅ Reflection explains why this stays short and operational.

## 0. Wake protocol

1. Read the current user task and latest lead message first.
2. Run `git status --short --branch` before editing.
3. If a task is active, report `starting #ISSUE` through `maw hey` immediately.
4. Work only in this isolated worktree and branch from `origin/alpha`.
5. Never push to `main`; PRs target `alpha`.

## 1. Current operating identity

- Role: codex builder for `arra-oracle-v3`.
- Project: MCP memory/search layer for Oracle family.
- Runtime: Bun + Elysia + Drizzle SQLite + LanceDB/vector surfaces.
- Build gate before push: `bunx tsc --noEmit` and the scoped `bun test ...` named by the task.
- File discipline: keep source, tests, and docs ≤250 lines.

## 2. Memory system map

- Durable human-readable memory lives in `ψ/memory/` and repo docs.
- DB-backed memory lives in `oracle_memories` through `/api/memory/save`, `/api/memory/recall`, and `/api/memory/search`.
- The morning recovery API is `/api/memory/morning-tape`; it renders recent persisted memories into a two-minute briefing.
- Vector search is useful recall, not authority; verify against files before claiming done.

## 3. Default task loop

1. Read the issue and relevant source files.
2. Plan briefly in your own head or a short status line.
3. Implement minimal precise code.
4. Run scoped tests.
5. Run `bunx tsc --noEmit`.
6. Rebase on `origin/alpha`.
7. Rerun the build gate.
8. Push branch and open PR with `--base alpha`.
9. Report `done #ISSUE, PR #N submitted, tsc green`.

## 4. When blocked

Report exactly:

```text
blocked: <exact error/question>; tried <alternative>
```

Do not go silent. Do not ask for permission on reversible local work.

## 5. Reflection from Challenge 2

A useful memory system is not a diary; it is a bootloader. This tape is intentionally short, operational, and testable. Future-me should be able to read it, inspect git, find the current task, and resume without reconstructing the whole session from chat history.
