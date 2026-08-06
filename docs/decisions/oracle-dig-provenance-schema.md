# ADR: Lock `oracle_dig` provenance schema

Status: Accepted
Date: 2026-07-12
Issue: [#2770](https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2770)

## Context

`oracle_trace` is an existing search/result primitive. It records a query and flat
result lists such as files, commits, issues, and project strings, but it does not
record which oracle/session found a relationship or typed source evidence for a
finding.

The digger-oracle design in
`digger-oracle/ψ/ralph/126-oracle-dig-mcp-tool-schema.md` proposes a separate
`oracle_dig` capability based on 125+ ralph-dig records. Its load-bearing lesson
is that every recalled relationship must carry clear where-found provenance.

maw-rs #121 is the contract scar for this decision: do not silently change a live
interface. Retrofitting mandatory typed provenance into `oracle_trace` would turn
a stable flat search logger into a different contract and risk breaking current
callers.

## Decision

Create `oracle_dig` as a new provenance-first capability. Do not retrofit
`oracle_trace`; it remains unchanged and may be called by `oracle_dig` as a
primitive source.

Every `oracle_dig` finding must have these mandatory fields:

1. `subject` with `relation` and `object` columns for the asserted relationship.
   A finding is a relationship triple, not an opaque blob.
2. `evidence[]` with one or more typed evidence records per finding.
   - GitHub evidence stores `owner`, `repo`, `path`, and `ref` separately.
   - Session evidence stores `session_id` and `oracle` separately.
   - More evidence kinds may be added later, but they must remain typed records,
     not folded into a flat string.
3. `dug_by`, the federation tag for the oracle that produced/asserted the dig.
4. `as_of`, the timestamp/ref point at which the finding was known true.
5. `confidence`, using the ranked values `high`, `medium`, or `low`.

Persist findings with a 1:N relational shape:

- `oracle_findings`: one row per relationship finding, including subject,
  relation, object, dug_by, as_of, and confidence.
- `oracle_finding_evidence`: one row per evidence item, linked to its finding and
  with typed columns for GitHub/session provenance.

Do not store evidence as one JSON blob. Queries such as “find findings evidenced
by repo X” must be indexable and answerable without parsing opaque JSON.

## Consequences

- Existing `oracle_trace` callers keep their current contract.
- `oracle_dig` can compose `oracle_trace` output as GitHub-only evidence while
  adding session/oracle provenance from digger-style session mining.
- Phase 1+ implementations have an unambiguous schema boundary: relationship
  findings and evidence are first-class rows, and typed provenance is mandatory.
- Relationship extraction may start caller-supplied; automatic extraction is a
  later concern and must still emit the same typed provenance shape.

## References

- Arra Oracle issue [#2770](https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/2770)
- digger-oracle `ψ/ralph/126-oracle-dig-mcp-tool-schema.md` (dig_seq 126,
  `oracle_dig` MCP tool schema)
- maw-rs #121, the “no silent contract change” scar cited by the digger design
