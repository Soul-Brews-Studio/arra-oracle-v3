# MORNING-TAPE — ARRA Oracle V3 Codex Builder

Purpose: recover enough context to work safely in under two minutes after a fresh session or compaction.

Boot self-check:

- ✅ Target read time is ≤2 minutes.
- ✅ Wake protocol, repo identity, memory map, task loop, and blocked format are present.
- ✅ Reflection explains why this stays short and operational.
- ✅ Test drill: a cold reader should know what to inspect, what not to touch, and how to report.

## 0. Wake protocol

1. Read the current user task and latest lead message first.
2. Run `git status --short --branch` before editing.
3. If a task is active, report `starting #ISSUE` through `maw hey` immediately.
4. Work only in this isolated worktree and branch; do not checkout/switch.
5. Merge current `origin/alpha` before feature work, resolve conflicts locally, and never force.
6. Never push to `main`; PRs target `alpha`.

## 1. Current operating identity

- Role: codex builder for `arra-oracle-v3`.
- Project: MCP memory/search layer for the Oracle family.
- Runtime: Bun + Elysia + Drizzle SQLite + LanceDB/vector surfaces.
- Build gate before push: `bunx tsc --noEmit` plus scoped `bun test ...` named by the task.
- File discipline: keep source, tests, and docs ≤250 lines.

## 2. Oracle heartbeat

Check these before claiming certainty:

- Branch/worktree: use only your assigned `agents/1-codex-N` worktree; do not switch to another coder branch.
- Working trunk: `alpha`; `main` is release-only.
- Framework: Elysia route clusters under `src/routes/`.
- Runtime: Bun commands, not Node-only scripts.
- Current truth: code + tests outrank stale docs.

## 3. Memory system map

- Human-readable durable memory: repo docs, `MORNING-TAPE.md`, `docs/MORNING-TAPE-TEMPLATE.md`, and `ψ/memory/` when present.
- DB memory: `oracle_memories` through `/api/memory/save`, `/api/memory/recall`, and `/api/memory/search`.
- Session close-out: `/api/memory/closeout` saves the summary, next action, blockers, and artifacts for future boot.
- Morning recovery API: `/api/memory/morning-tape` renders recent persisted memories into a two-minute briefing.
- Vector search helps recall but is not authority; verify against files before claiming done.

## 4. Two-minute recovery drill

1. Read this file top to bottom once.
2. Run `git status --short --branch` and identify dirty files to preserve.
3. Read the active GitHub issue or lead message.
4. Search the repo for the exact route/module/test surface.
5. State the next safe action, then execute without asking for permission.
6. Verify with the smallest test that proves the changed behavior, then `bunx tsc --noEmit`.

## 5. Default task loop

1. Read the issue and relevant source files.
2. Implement the smallest precise change.
3. Run scoped tests.
4. Run `bunx tsc --noEmit`.
5. Merge current `origin/alpha` and rerun the gate.
6. Push branch and open PR with `--base alpha`.
7. Report `done #ISSUE — commit <sha>, build pass, PR <url>`.

## 6. When blocked

Report exactly:

```text
blocked: <exact error/question>; tried <alternative>
```

Do not go silent. Do not ask for permission on reversible local work.

## 7. Reflection from Challenge 2

A useful memory system is not a diary; it is a bootloader. This tape is intentionally short, operational, and testable. It stores the identity, safety rails, memory map, and recovery drill needed to resume work without reconstructing chat history. If future-me reads it and can safely inspect git, find the task, run the right checks, and report status within two minutes, it is working.
