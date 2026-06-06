# Huginn auto-capture hook

Huginn is the passive capture half of the Huginn/Muninn split: Muninn recalls with `oracle_search`; Huginn captures the current session before context is lost.

Phase 1 is deliberately opt-in and default-off. When enabled, the hook mines a session JSONL transcript for salient decisions, learnings, file changes, issue/PR events, and verification notes, then writes one deduped `oracle_learn` entry. The normal learn path writes the vault markdown and indexes FTS immediately, so the capture is visible to `oracle_search` without waiting for a later aggregation pass.

## Enable

Set one of these environment variables in the hook environment:

```sh
export ARRA_HUGINN_CAPTURE=1
# legacy alias also accepted:
export ORACLE_HUGINN_CAPTURE=1
```

If neither variable is truthy, the hook exits successfully with `skipped: disabled` and writes nothing.

## Hook command

Use the same script for Stop and PreCompact hooks:

```sh
bun /path/to/arra-oracle-v3/scripts/huginn-capture-hook.ts
```

The script accepts hook JSON on stdin with any of these transcript fields:

- `transcript_path`
- `transcriptPath`
- `session_path`
- `sessionPath`

Optional fields: `session_id` / `sessionId`, `cwd`.

For manual testing:

```sh
ARRA_HUGINN_CAPTURE=1 bun scripts/huginn-capture-hook.ts /path/to/session.jsonl optional-session-id
```

## Dedup

Dedup state is stored at:

```text
$ORACLE_DATA_DIR/huginn-captures.json
```

The key is `session id + content hash`, so rerunning the hook on the same transcript does not create duplicate learnings. If the same session transcript gains new salient content, the content hash changes and a new capture may be written.

## Output

The script prints JSON and exits zero for disabled, empty, duplicate, or successful captures. It exits non-zero only on unexpected errors.
