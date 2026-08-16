# Session Memory & Agent Lessons — Specification

**Status**: draft v1 · **Date**: 2026-08-16 · **Branch**: `spec/session-memory-and-lessons`

What this is: the Oracle can search documents. It cannot search **the conversations that produced
them**. 6,024 sessions and 1,031,567 recorded beats already sit on disk, exported nightly, and nothing can
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

**(b) The summary write path exists and is unused.**

> **Correction (2026-08-16).** An earlier draft said summaries "have nowhere to live". Wrong.
> `POST /api/session/:id/summary` already exists (`src/routes/sessions/summary.ts`), already stores
> summaries as `oracle_documents` with id `session-summary_<sid>` and `createdBy: 'session_summary'`
> (`src/routes/sessions/store.ts:29,101`), already wires FTS + entity links + pointers + `logLearning`
> (`:104-108`), and `sessionsRoutes` is already mounted (`src/server.ts:64,188`). Measured on the live
> corpus: **0 rows** with `created_by='session_summary'`. Live code, never used.

So (b) is not "build a write path" — it is "nothing calls the one that exists, and it has no MCP
tool in front of it". That makes this phase far smaller than drafted, and it answers Q2 below:
**a summary is already an `oracle_document`.**

**(c) Distilling a trace produces nothing by default.**

> **Correction (2026-08-16).** An earlier draft of this spec blamed `distillTrace`
> (`src/trace/status.ts:6-16`). That was wrong, and the correction matters because it changes the
> fix. Verified: `distillTrace` is **dead code** — `rg` finds exactly two references, its own
> definition and a re-export at `src/trace/handler.ts:6`. Nothing calls it. It is a function whose
> return type promises a `learningId` it never sets, sitting unused next to the real one.

The **live** path is `distillTraceAwakening` (`src/trace/distill.ts:102-129`), reached from
`src/tools/oracle.ts:75` (MCP) and `src/routes/traces/distill.ts:48` (HTTP). It *does* create a real
lesson and return its id:

```ts
const learning = input.promoteToLearning ? handleLearn(...) : undefined;   // :112
if (learning?.id) update.distilledToId = learning.id;                      // :119
return { success: true, status: 'distilled', learningId: learning?.id };   // :126
```

The defect is the **default**. `promoteToLearning` is `t.Optional(t.Boolean())`
(`src/routes/traces/distill.ts:29`) with no default anywhere, so an ordinary distill takes the
`: undefined` branch: the trace is marked `distilled` and **no artefact is produced**. The symptom
Nat described is real; the fix is to flip a default and delete the dead twin, not to implement a
missing function.

**⚠️ Related hazard, found while verifying the above.** `src/indexer/frontmatter.ts:7-9` hardcodes:

```ts
const ORACLE_DOC_TYPES = new Set([
  'principle', 'pattern', 'learning', 'retro', 'distillation', 'security-corpus',
]);
```

`parseFrontmatterDocType` **silently falls back to `'learning'`** for any type outside this set, and
`src/indexer/storage.ts:67` then writes that fallback over the row. So a new document type that is
not added to this set is **silently demoted on the next reindex** — the promotion would appear to
work and then quietly undo itself. Any new category must land in this file in the same commit as its
writer, with a round-trip test.

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

**⚠️ A beat is not a turn.** Measured `who` distribution: `tool` 520,829 (**50.5%**) · `assistant` 354,252 · `human` 135,574 · `thinking` 18,746 · `system` 2,166. Half the corpus is tool-call JSON, not conversation. Any summary or search that treats 1,031,567 as "turns" is wrong by 2x, and any embedding pass should follow `jsonl-lens`'s lead and take human/assistant/thinking only (~508K).

### Decision: tool beats are excluded from the conversation index

Nat, 2026-08-16: *"we do not need tool call be coz not nonesense of searching?"* — correct, and the
volume makes it decisive.

| who | rows | text | avg |
|---|---:|---:|---:|
| `tool` | 520,829 | **374.5 MB (69%)** | 754 ch |
| `assistant` | 354,252 | 98.6 MB | 292 ch |
| `human` | 135,574 | 58.7 MB | 454 ch |
| `thinking` | 18,746 | 10.5 MB | 588 ch |
| `system` | 2,166 | ~0 MB | 18 ch |

A `tool` beat is the **call**, not the result — e.g. `Bash: {"command":"pwd","description":"Check
current working directory"}`. The results live separately in `tool_results` (521,070 rows).

**Default conversation index = `human` + `assistant` + `thinking`** → 508,572 beats / **167.8 MB**,
a **3.2x smaller index** than indexing everything, with better precision (JSON blobs no longer
dilute keyword matches). This matches what `jsonl-lens` already concluded — its `embed` recipe takes
human/assistant/thinking only.

**Not discarded, just not default.** Tool beats carry a human-written `description` and real file
paths, so *"which session installed X"* and *"when did we touch storage.ts"* remain answerable —
behind an explicit `includeTools` filter rather than in the conversation index.

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
