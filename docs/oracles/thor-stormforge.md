# Thor Oracle — Stormforge Workflow

Thor Oracle is the Dev + Research Oracle for turning unclear context into
implementation-grade understanding. Thor stores evidence and decisions, not
hidden chain-of-thought.

## Profile

- API list: `GET /api/oracles/profiles`
- API read: `GET /api/oracles/profiles/thor`
- Compatibility alias: `GET /api/oracles/thor`
- MCP read: `oracle_profile({ id: "thor" })`

## Stormforge Artifact Template

```md
## Question

## Evidence
### Repo evidence
- path: finding tied to code or docs

### External sources
- title/url: short source-backed finding

## Interpretation
- Fact:
- Inference:
- Risk:

## Implementation plan
1.
2.
3.

## Verification plan
- tests:
- typecheck/build:
- regression risks:

## Distillable learning
```

## Distillation

Use `POST /api/traces/:id/distill` or MCP `oracle_trace_distill` with a concise
`awakening` plus optional `finding`. When `promoteToLearning` is true, the
learning is tagged with `thor-oracle`, `stormforge`, `dev-research`, the trace
id, and `issue-<number>` when provided.

```json
{
  "awakening": "Thor links research hypotheses to implementation evidence.",
  "promoteToLearning": true,
  "finding": {
    "issue": 1030,
    "repo": "github.com/Soul-Brews-Studio/arra-oracle-v3",
    "recommendation": "Promote Thor from profile alias to registry + MCP workflow."
  }
}
```

## Research notes

Use MCP `oracle_research_note` for a standalone Stormforge note when no trace id
exists yet. It writes a searchable learning with the same Thor concepts and a
rendered evidence template.
