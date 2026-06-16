# Thor Oracle — Stormforge Workflow

Thor Oracle is the Dev + Research Oracle for turning unclear context into
implementation-grade understanding. Thor stores evidence and decisions, not
hidden chain-of-thought.

Issue: [#1030](https://github.com/Soul-Brews-Studio/arra-oracle-v3/issues/1030)

## Profile surfaces

- API list: `GET /api/oracles/profiles`
- API read: `GET /api/oracles/profiles/thor`
- Compatibility alias: `GET /api/oracles/thor`
- MCP read: `oracle_profile({ id: "thor" })`
- Trace distill: `POST /api/traces/:id/distill`
- MCP distill: `oracle_trace_distill(...)`
- MCP standalone note: `oracle_research_note(...)`

## Research grounding

Thor's product shape is based on four agent patterns:

| Pattern | Source | Stormforge implication |
| --- | --- | --- |
| Interleaved research/action | [ReAct](https://arxiv.org/abs/2210.03629) | Keep evidence and plan updates visible as tools/code/tests change the answer. |
| Verbal reflection memory | [Reflexion](https://arxiv.org/abs/2303.11366) | Distill feedback into durable learnings instead of relying on ephemeral session recall. |
| Agent-computer interface | [SWE-agent](https://arxiv.org/abs/2405.15793) | Optimize Thor around repo navigation, edit plans, and verification logs, not a persona string. |
| Skill library + self-verification | [Voyager](https://arxiv.org/abs/2305.16291) | Reusable findings should carry verification steps and tags for later retrieval. |

## Stormforge protocol

Thor runs a four-stage loop:

1. **Scout** — read the issue, current code, docs, tests, and primary sources.
2. **Forge** — convert the evidence into a bounded implementation or research
   artifact with explicit assumptions.
3. **Prove** — run the smallest validation that proves the claim.
4. **Distill** — store the reusable finding through trace distillation or a
   research note, tagged with Thor concepts and issue context.

Use this protocol when the task mixes architecture, external research, and code
execution. For simple mechanical fixes, use the normal implementation workflow.

## Stormforge artifact template

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

## API example

```http
POST /api/traces/trace-1030/distill
Content-Type: application/json

{
  "awakening": "Thor links research hypotheses to implementation evidence.",
  "promoteToLearning": true,
  "oracle": "Thor Oracle",
  "theme": "Stormforge",
  "concepts": ["dev-research", "verification"],
  "source": "issue #1030",
  "finding": {
    "issue": 1030,
    "repo": "github.com/Soul-Brews-Studio/arra-oracle-v3",
    "recommendation": "Use profile registry + trace distillation as Thor's durable workflow."
  }
}
```

Expected result:

- trace status becomes `distilled`,
- promoted learning carries `thor-oracle`, `stormforge`, `dev-research`,
  `trace-<id>`, and `issue-1030` concepts,
- `GET /api/learn/:id` can retrieve the distilled note,
- search surfaces can find the note by issue, concepts, and content.

## MCP examples

Read Thor profile:

```json
{
  "tool": "oracle_profile",
  "arguments": { "id": "thor" }
}
```

Distill an existing trace:

```json
{
  "tool": "oracle_trace_distill",
  "arguments": {
    "traceId": "trace-1030",
    "awakening": "Stormforge captured the implementation decision and test proof.",
    "promoteToLearning": true,
    "finding": {
      "issue": 1030,
      "implementationPlan": ["reuse registry", "reuse trace distill", "document workflow"],
      "verificationPlan": ["HTTP profile tests", "trace distill tests", "tsc --noEmit"]
    }
  }
}
```

Create a standalone research/dev note:

```json
{
  "tool": "oracle_research_note",
  "arguments": {
    "title": "Thor Stormforge runbook",
    "issue": 1030,
    "recommendation": "Use the Scout/Forge/Prove/Distill loop for dev+research tasks.",
    "concepts": ["runbook", "verification"]
  }
}
```

## Acceptance checklist for #1030 slices

- `GET /api/oracles/thor` remains a compatibility alias.
- `GET /api/oracles/profiles` lists Thor from the generic registry.
- `oracle_profile` can list/read Thor without HTTP-specific knowledge.
- `POST /api/traces/:id/distill` keeps simple-body compatibility.
- Structured `finding` content renders into the distilled awakening.
- Promoted findings include Thor default concepts and `issue-<number>` when
  provided.
- Any new doc, test, or source file remains <=250 lines.
- Validation output is captured before the PR is opened.

## Boundaries

Thor is not an autonomous code runner inside ARRA Oracle. The repository should
provide identity, memory, research artifact, MCP, and HTTP surfaces. Actual code
execution stays with external agents such as Codex, Claude, maw, or human
operators.

Thor stores conclusions, evidence summaries, paths, source links, validation
plans, and results. It must not store hidden chain-of-thought as durable memory.
