# Proof — this works, measured

A working 1-page app was built and driven through a browser on 2026-08-16 against the **real**
2.68 GB corpus. Nothing below is projected.

Source: `lens-curator` (a ~150-line Bun server + one HTML file). Every requirement in
[spec.md](spec.md) §3 is demonstrated.

---

## What ran

```
lens-curator → http://localhost:47950
  read-only : /opt/data/.lens/all.db          2,678.8 MB   never written
  read-write: curator.db                          0.031 MB  backs up trivially
```

`GET /api/stats` against the live corpus:

```json
{ "sessions": 6024, "beats": 1031567, "summarized": 0 }
```

The page listed real sessions from real oracles — `jsonl-lens` (897 beats), `black-oracle` (3,700),
`messenger-oracle` (1,893), `librarian-oracle` (1,028), `homelab` (2,185), `memory-oracle` (2,151),
each showing project, beat count, date, and a **summarised / not summarised** pill.

## The write → supersede → log cycle

Two agents summarised the same session, one after the other, through the UI:

```
summaries
  id                      who              state       reason
  sum_06040d20_…625       claude-opus-5    superseded  re-summarized
  sum_06040d20_…626       claude-sonnet-5  LIVE

summary_log
  action      actor            at
  created     claude-opus-5    2026-08-16 16:04:15
  superseded  claude-sonnet-5  2026-08-16 16:04:26
  created     claude-sonnet-5  2026-08-16 16:04:26
```

Mapped to requirements:

| Req | Demonstrated by |
|---|---|
| R1 session id + timestamp | `/api/session/:id` returned turns ordered by `seq` with `ts` |
| R3 separate files | 2,678.8 MB read-only + 0.031 MB read-write, both live in one process |
| R4 AI writes back | `POST /api/summarize` — the endpoint an MCP tool would call |
| R5 who | `created_by` = `claude-opus-5`, then `claude-sonnet-5` |
| R6 flag | list rendered "summarized" / "not summarized", count went 0 → 1 |
| R7 log | three rows: create, supersede, create |
| R8 supersede not overwrite | the opus-5 summary is still present and readable, marked superseded |
| R9 web UI | a human opened it in a browser and read author + history |

## Why this settles the two-database question

The mutable half is **0.031 MB against 2,678.8 MB** — a factor of ~86,000. Every argument follows
from that ratio:

- The indexer backs up the whole database before each run (`oracle.db.backup-*`, ~92 MB observed).
  Backing up 31 KB is free; backing up 2.7 GB per reindex is not.
- Issue #2996's unscoped smart-delete reaches `oracle_documents`. It cannot reach a file it never
  opens.
- `all.db` is a **rebuildable export** owned by `jsonl-lens` — treating it as read-only means a
  corrupted import is fixed by re-running `just export-turso`, not by restoring a backup.

## What the proof does *not* establish

Stated plainly so the spec is not over-claimed:

- No FTS5 index was built over 1M beats — search performance at scale is **unproven**.
- The sidecar is standalone; it does **not** yet reuse `oracle_documents` supersession
  (spec.md Q2), it only mirrors its column shape.
- No MCP tool exists yet; `POST /api/summarize` stands in for one.
- Caller identity was supplied by the UI, which is exactly the concern raised in spec.md Q5 —
  it does not prove an MCP caller can be identified.

## Reproduce

```bash
cd lens-curator && bun server.ts        # LENS_DB / CURATOR_DB / PORT override the defaults
open http://localhost:47950
```
