# Session Memory & Agent Lessons — Specification

**Status**: draft v1 · **Date**: 2026-08-16 · **Branch**: `spec/session-memory-and-lessons`

What this is: the Oracle can search documents. It cannot search **the conversations that produced
them**. 6,024 sessions and 1,031,567 turns already sit on disk, exported nightly, and nothing can
query them. This spec adds that, lets an AI write summaries back with full provenance, and completes
a promotion path from trace → durable lesson that the codebase already declares but never implemented.

Every number here was measured on m5 on 2026-08-16, not estimated. A working proof exists — see
[proof.md](proof.md).

---

## 1. Why

Three gaps, each verified:

**(a) Conversations are unsearchable.** `/opt/data/.lens/all.db` is 2.68 GB of session history
produced by the `jsonl-lens` maw plugin. No MCP tool can read it. The knowledge is on disk and
unreachable.

**(b) Summaries have nowhere to live.** An AI reading a session can summarise it, but there is no
table to write to, no flag saying whether a session has been summarised, no record of who did it,
and no way to replace a summary without destroying the old one.

**(c) The promotion path is declared but empty.** `src/trace/status.ts:6-16`:

```ts
export function distillTrace(input): { success: boolean; status: string; learningId?: string } {
  …
  return { success: true, status: 'distilled' };   // learningId is NEVER populated
}
```

Marking a trace `distilled` produces no lesson. The type promises an artefact the function does not
create. A working pattern for exactly this already exists at `src/huginn/capture.ts:210`.

---

## 2. User scenarios

**S1 — Ask what was said, not what was written.**
An agent asks *"when did we decide to use two database files, and why?"* Today: no answer, the
reasoning lived in a conversation. After: the answer comes back with a session id, a timestamp, and
the surrounding turns.

**S2 — An AI summarises a session it just read.**
An agent reads session `06040d20` over MCP, writes a summary back, and it is attributed to that
agent by name. A human opens the web UI later and reads it without touching a terminal.

**S3 — A better summary replaces a worse one, and the old one survives.**
A second agent re-summarises the same session. The first summary is **superseded, not deleted** —
still readable, marked replaced, with who replaced it and why.

**S4 — A hard-won lesson outlives the session that taught it.**
A trace is distilled into a durable, named lesson in a category an agent will actually think to
query at the *start* of a task, not after repeating the mistake.

---

## 3. Requirements

### Must

| # | Requirement | Acceptance |
|---|---|---|
| R1 | Session transcripts are queryable by **session id** and **timestamp** | An MCP call returns turns for a session id, and turns within a time range |
| R2 | Full-text search across conversation turns | A keyword query returns matching turns with session id + timestamp |
| R3 | Session data lives in a **separate database file** from `oracle.db` | Two files; `oracle.db` size is unchanged by import |
| R4 | An AI can write a summary back over MCP | A tool call creates a summary row |
| R5 | Every summary records **who** wrote it | `created_by` is non-null on every row |
| R6 | Sessions expose a **summarised / not summarised** flag | The list distinguishes both states |
| R7 | Every summarisation is **logged** | Each create and supersede appends a log row |
| R8 | Re-summarising **supersedes**, never overwrites | The prior summary remains readable and marked replaced |
| R9 | Humans read summaries in the **web UI** | A page lists sessions, state, author, and history |
| R10 | `distillTrace` returns a real `learningId` | Distilling produces a retrievable lesson document |
| R11 | Lessons have a **queryable category** distinct from the 6,843 existing `learning` rows | A query returns lessons without returning ordinary learnings |

### Must not

| # | Constraint | Why |
|---|---|---|
| N1 | Must not write to `all.db` | It is a rebuildable export owned by `jsonl-lens`; attach it read-only |
| N2 | Must not enlarge `oracle.db` materially | The indexer **backs up the entire file before every run** — measured `oracle.db.backup-*` at ~92 MB. At 2.7 GB every reindex copies 2.7 GB |
| N3 | Must not place session rows where smart-delete can reach them | Issue #2996: reconciliation over `oracle_documents` is not project-scoped. A separate file puts 1M turns outside that blast radius permanently |
| N4 | Must not invent a second supersession mechanism | One already exists — reuse it (§5) |
| N5 | Must not use raw SQL DDL in application code | CLAUDE.md: Drizzle + `bun db:push` only |

---

## 4. The data, as it actually is

`/opt/data/.lens/all.db` — 2.68 GB, produced by `just export-turso` in `jsonl-lens`:

| table | rows | shape |
|---|---:|---|
| `sessions` | 6,024 | `id, project, path, size, created, modified` |
| `beats` | **1,031,567** | `id, session_id, project, seq, ts, who, what, uuid, parent_uuid, is_sidechain, is_meta` |
| `tool_results` | 521,070 | `session_id, seq, tool_use_id, content, is_error` |
| `usage` | 1,113,429 | tokens, model, stop_reason, service_tier |
| `session_meta` | 318,458 | key/value — **schema-less** |
| `turn_durations` | 78,808 | `duration_ms, message_count` |
| `compaction_events` | 1,083 | `pre_tokens, duration_ms` |

Two properties that shape the design:

- **`parent_uuid` + `is_sidechain` make the turn graph a tree.** Subagent branches are in there. A
  flat import silently discards that structure.
- **`session_meta` is key/value.** Anything to be queried must be promoted to a real column or it
  stays unsearchable.

`jsonl-lens` already ships tiering worth reusing rather than rebuilding: `just search` (FTS5 built
*from* an export) and `just embed` (bge-m3 via GPU pool, human/assistant/thinking turns only).

---

## 5. Reuse, do not reinvent

The repository already contains most of the provenance machinery this spec needs:

| Need | Already exists |
|---|---|
| supersession columns | `src/db/schema.ts:19-21` — `supersededBy`, `supersededAt`, `supersededReason` |
| "who" attribution | `src/db/schema.ts:24` — `createdBy` (the indexer writes `'indexer'`, `src/indexer/storage.ts:63`) |
| a supersession log | `src/db/logistics-schema.ts:9-23` — `supersede_log` |
| "what replaced what" | `GET /api/supersede/chain/:path` — `src/routes/supersede/chain.ts` |
| an MCP supersede tool | `src/tools/supersede.ts`, registered `src/tools/index.ts:62` |
| trace status lifecycle | `src/trace/types.ts:54` — `raw \| reviewed \| distilling \| distilled` |
| a working promotion pattern | `src/huginn/capture.ts:210` populates `learningId` from a real result |

**A design that adds a parallel, differently-shaped supersession is wrong.** The proof in
[proof.md](proof.md) deliberately mirrors `supersede_log`'s column shape for this reason.

---

## 6. Open questions — need Nat's decision

These are genuinely undecided. Guessing them would be worse than asking.

**Q1 — What is a "section"?** Nat asked for a summary "of each section". The data supports four
readings: whole session · time window · subtree of the beat tree · compaction boundary
(`compaction_events` exists, 1,083 rows). *Recommendation: whole session for phase 1, because it is
the only one with a natural stable key already present (`sessions.id`).*

**Q2 — Is a summary an `oracle_document`?** If yes, it inherits supersession, tenant scoping, FTS
and the existing web UI **for free**, and lives in the small database while pointing at the big one.
If no, all four are rebuilt. *Recommendation: yes.* This is the highest-leverage decision here.

**Q3 — What is the lesson category called?** It must be a name an agent guesses **unprompted** at
the start of a task. Candidates: `lesson` · `agent-lesson` · `bible` · `rule` · `playbook`.
*Recommendation: `lesson`* — shortest, and the word an agent already reaches for. `bible` is
memorable but nobody types it when searching for how to avoid a mistake.

**Q4 — Import, or attach and never copy?** Copying 1M rows duplicates 2.68 GB; attaching read-only
duplicates nothing but couples the Oracle to a file owned by another tool. *Recommendation: attach
read-only for reads, copy nothing.*

**Q5 — Who is "who" when the caller is an AI over MCP?** It is not yet verified that a caller
identity is actually available at the MCP tool layer. If it is not, `created_by` must be a required
tool parameter rather than something inferred — otherwise R5 silently degrades to "unknown".

---

## 7. Out of scope for v1

- Embeddings over conversation turns (`just embed` already does this; wire it later)
- Backfilling the 6,843 existing `learning` rows into a new category
- Real-time import of a session still being written
- Multi-machine sync of the session database

---

See [plan.md](plan.md) for the technical approach and [proof.md](proof.md) for what has already been
demonstrated working against the real corpus.
