# PRP Workflow — AI Coding Agent Instructions

This file provides PRP (Plan-Review-PR) workflow instructions for any AI coding tool.
Copy this file as `AGENTS.md` in your project root for tools that read it (Kimi, Codex, OpenCode, etc.).

---

## Available Workflows

| Workflow | What It Does | When to Use |
|----------|-------------|-------------|
| **PRD** | Interactive PRD generator → product spec | Need product spec before planning |
| **Design** | Generate technical design doc from PRD (optional) | Complex features needing architecture blueprint |
| **Plan** | Analyze codebase → create implementation plan | Starting a new feature |
| **Implement** | Execute plan with validation loops | Have a plan, ready to code |
| **Review** | Multi-pass PR code review | PR created, need review |
| **Commit** | Smart staging + conventional commit | Code ready to commit |
| **PR** | Create pull request from branch | Ready to push |
| **Run All** | Full workflow: plan → implement → commit → PR → review | End-to-end automation |

---

## Workflow: PRD

**Trigger**: User says "create a PRD for..." or "I want to build..."

### Process

Interactive question-driven PRD generation. Problem-first, hypothesis-driven, evidence-based.

```
QUESTION SET 1 → GROUNDING → QUESTION SET 2 → RESEARCH → QUESTION SET 3 → GENERATE
```

### Phases

1. **INITIATE**: If no input → ask "What do you want to build?". If input → restate and confirm. Wait for response.
2. **FOUNDATION**: Ask: Who has this problem? What pain? Why can't they solve it? Why now? How to measure? Wait for responses.
3. **GROUNDING (Market)**: Research similar products, competitors, patterns. Explore codebase for related functionality. Summarize findings. Brief pause.
4. **DEEP DIVE**: Ask: Vision, Primary User, Job to Be Done, Non-Users, Constraints. Wait for responses.
5. **GROUNDING (Technical)**: Explore codebase for feasibility — infrastructure, constraints, patterns, dependencies. Summarize: feasibility (HIGH/MEDIUM/LOW), leverageable patterns, key risk. Brief pause.
6. **DECISIONS**: Ask: MVP definition, Must Have vs Nice to Have, Key Hypothesis, Out of Scope, Open Questions. Wait for responses.
7. **GENERATE**: Save PRD to `.prp-output/prds/drafts/{name}-prd-other.md` (create directory: `mkdir -p .prp-output/prds/drafts`) with ALL sections: Problem Statement, Evidence, Proposed Solution, Key Hypothesis, What We're NOT Building, Success Metrics, Open Questions, Users & Context, Solution Detail (MoSCoW), Technical Approach, Implementation Phases (table with status/parallel/depends), Decisions Log, Research Summary.

   > **Note**: Uses `-other` suffix to identify generic/Kimi PRD drafts. Multiple tools can create draft PRDs in `drafts/` subdirectory for comparison. User manually merges best sections to final version at `.prp-output/prds/{name}-prd.md` (no suffix, root level) which Plan command will reference.

**Output**: File path (draft), problem/solution summary, key metric, validation status, open questions, recommended next step, phases table.

**To start implementation**: (1) Manually compare draft PRDs from different tools in `drafts/` subdirectory, (2) Merge best sections to final PRD at `.prp-output/prds/{name}-prd.md` (no suffix), (3) Run Plan workflow with final PRD path. Plan command references final merged PRD only (not drafts).

**Anti-pattern**: Don't fill sections with fluff. Write "TBD - needs research" if info is missing.

**To start implementation**: Run Plan workflow with the PRD path.

### Usage

- "Create a PRD for JWT authentication" → full interactive process
- "I want to build a usage metrics dashboard" → starts with INITIATE confirmation

---

## Workflow: Design

**Trigger**: User says "create a design doc for..." or "design the architecture for..."

### Context

Design Doc is **OPTIONAL REFERENCE MATERIAL** — NOT in critical workflow path. Workflow remains: PRD → Plan → Implement. Simple features can skip directly to Plan. Complex features can use Design Doc as architecture reference.

### Process

Generate comprehensive technical design document from PRD. Focus: system architecture, API contracts, database schema, security, performance, scalability.

### Steps

1. **Load Context**: Read PRD (must be final merged version at `.prp-output/prds/{name}-prd.md`, not draft). Validate PRD exists. Extract feature name for design doc naming.
2. **Explore Codebase**: Find existing patterns with file:line references — architecture patterns, API conventions, database patterns, component patterns (if frontend), integration points. Use ACTUAL code examples.
3. **Research**: Official documentation (match project versions from package.json/config), architecture patterns, trade-offs, security best practices (OWASP), scalability strategies.
4. **Design Architecture**:
   - **System Architecture**: ASCII diagram showing components, data flow, external dependencies, integration points
   - **API Contracts**: Request/response schemas with validation rules and error cases
   - **Database Schema**: SQL CREATE/ALTER/INDEX statements + migration strategy + rollback plan
   - **Sequence Diagrams**: Mermaid diagrams for critical user flows
   - **Component Hierarchy**: Component tree if frontend changes
   - **Data Flow**: ASCII diagram showing data transformations, validation layers, error handling
5. **Technical Decisions**: Document key decisions in table format: Decision | Choice | Alternatives | Rationale | Trade-offs
6. **Non-Functional Requirements**:
   - Performance: targets (p50, p95, p99), caching strategy, database optimization
   - Security: auth/authz, input validation, XSS/CSRF/SQL injection prevention, rate limiting
   - Scalability: horizontal scaling, stateless design, async processing, database scaling (replicas, sharding)
   - Monitoring: key metrics, logging strategy, alerts, distributed tracing
7. **Migration Strategy**: Backward compatibility plan, data migration scripts, feature flags for gradual rollout, rollback plan
8. **Generate Design Doc**: Save to `.prp-output/designs/{feature}-design-other.md` (create directory: `mkdir -p .prp-output/designs`) with metadata:
   ```yaml
   source-prd: .prp-output/prds/{feature}-prd.md
   created: {timestamp}
   status: reference
   tool: other
   ```

   > **Note**: Uses `-other` suffix to identify generic/Kimi design docs. Multiple tools can create design docs with different tool suffixes for comparison.

### Output

Report:
- **File**: `.prp-output/designs/{name}-design-other.md` (REFERENCE ONLY)
- **Summary**: Feature name, Complexity (LOW/MEDIUM/HIGH), Components count, API endpoints count, Database changes
- **Key Design Decisions**: Top 3 with choice and rationale
- **Security Considerations**: List
- **Performance Targets**: p95 latency, throughput
- **Next Steps**: "This is a REFERENCE DOCUMENT. Workflow continues: (1) Use design doc as reference (optional), (2) Create Plan from PRD, (3) Implement from Plan. Design Doc does NOT block workflow."

### Usage

- "Create a design doc for the PRD at .prp-output/prds/auth-prd.md" → generates architecture blueprint
- "Design the architecture for JWT authentication" → starts with PRD path validation

### Important Notes

- **NOT a workflow gate**: Plan command still reads from PRD, not Design Doc
- **Reference material only**: Implementer can consult for architecture guidance
- **Simple features skip this**: Use Design Doc only for complex features with significant architecture decisions
- **Workflow unchanged**: PRD → Plan → Implement remains the critical path

---

## Workflow: Plan

**Trigger**: User says "create a plan for..." or "plan the implementation of..."

### Context

Read project conventions file (CLAUDE.md, AGENTS.md, .cursorrules, etc.). Run directory discovery: `ls -la` — do NOT assume `src/` exists (alternatives: `app/`, `lib/`, `packages/`, `cmd/`, `internal/`, `pkg/`).

### Steps

1. **Detect Input**: If PRD file path → parse phases (find pending with all dependencies complete, note parallelism opportunity). If text → use as feature description. If empty → use conversation context.
2. **Parse Feature**: Extract problem, user value, type (NEW_CAPABILITY/ENHANCEMENT/REFACTOR/BUG_FIX), complexity, affected systems. Write user story: `As a <user> I want to <action> So that <benefit>`.
3. **Explore Codebase**: Find similar implementations with file:line references, naming conventions, error/logging/test patterns, integration points, dependencies with versions. Use ACTUAL code snippets from the codebase. Document in table format.
4. **Research**: ONLY after exploration. Official docs matching project versions, gotchas, security. Format with URL + KEY_INSIGHT + APPLIES_TO + GOTCHA.
5. **Design**: Before/After ASCII diagrams showing UX and data flow changes. Interaction changes table.
6. **Architect**: Analyze architecture fit, execution order, failure modes, performance, security, maintainability. Document chosen approach, rationale, rejected alternatives, and explicit scope limits. **Technical Design (conditional)**: If complexity=HIGH or API/DB changes → include API Contracts, Database Schema (with migration + rollback), Sequence Diagrams (Mermaid), NFRs (p95/p99, caching, security), Migration & Rollback plan. Reference existing Design Doc if available.
7. **Generate Plan**: Save to `.prp-output/plans/{feature}.plan.md` containing ALL sections:
   - Summary, User Story, Problem/Solution Statements, Metadata
   - UX Design (before/after ASCII diagrams + interaction changes table)
   - Mandatory Reading (P0/P1/P2 priority files implementer MUST read)
   - Patterns to Mirror (ACTUAL code snippets: naming, errors, logging, repository, service, tests)
   - Files to Change (CREATE/UPDATE list with justifications)
   - NOT Building (explicit scope limits)
   - Step-by-Step Tasks (each with ACTION/IMPLEMENT/MIRROR/IMPORTS/GOTCHA/VALIDATE)
   - Testing Strategy (unit tests + **integration tests** (conditional) + **test data requirements** + **performance benchmarks** (conditional) + edge cases)
   - **Technical Design** (conditional, HIGH or API/DB changes) — API contracts, DB schema, sequence diagrams, NFRs, migration & rollback
   - Validation Commands (6 levels: Static Analysis, Unit Tests, Full Suite, Database, Browser, Manual)
   - Acceptance Criteria, Completion Checklist, Risks and Mitigations

**Output**: If from PRD, update status to `in-progress`. Report: file path, summary, complexity, scope, key patterns, confidence score (1-10)/10.

**Gate**: If ambiguous → ask for clarification before proceeding.
**Quality Test**: Could an unfamiliar agent implement using ONLY this plan?

---

## Workflow: Implement

**Trigger**: User says "implement this plan" or provides a plan file path.

### Steps

1. **Detect Environment**: Identify package manager from lock files (bun/pnpm/yarn/npm/uv/cargo/go). Find validation scripts. Use plan's "Validation Commands" section.
2. **Load Plan**: Read plan file, extract tasks, validation commands, acceptance criteria. If not found: STOP.
3. **Prepare Git**: Check branch + worktree state. In worktree → use it. On main clean → create branch. On main dirty → STOP. On feature branch → use it. Sync with remote.
4. **Execute Tasks (TDD Approach)**: For each task — read MIRROR reference and Testing Strategy. **Write test first (RED)** for new functions/modules (skip test-first for config/wiring/schema tasks). **Implement (GREEN)** — follow MIRROR pattern, run tests until passing. **Validate immediately** (type-check after EVERY change). Track progress with TDD status: `Task 1: Test ✅ (3 cases) — Impl ✅`. Document deviations (WHAT and WHY).
5. **Full Validation**:
   - Static: type-check + lint (zero errors). If lint errors → auto-fix then manual.
   - Tests: MUST write/update tests. If fail → determine root cause → fix → re-run.
   - Coverage: 90% on new/changed code. Auto-detect tool (jest/vitest `--coverage`, pytest `--cov`, go test `-cover`). If no tool → skip with warning.
   - Build: must succeed.
   - Integration (if applicable): start server → test endpoints → stop server.
   - Integration Tests (conditional): if plan specifies or project has `test:integration` → run them.
   - Edge cases from plan.
   - Security Checks (conditional — basic SAST): scan changed files for hardcoded secrets, SQL injection, unsafe eval/exec. Fix if found.
   - Performance Regression (conditional): if plan has benchmarks + project has tooling → run and flag regressions > 20%.
   - API Contract Validation (conditional): if OpenAPI/GraphQL schema exists + API surface changed → validate schema.
6. **Report**: Save to `.prp-output/reports/{name}-report-other.md` with: assessment vs reality, tasks completed, validation results, files changed, deviations, issues, tests written.
   > **Note**: Uses `-other` suffix to identify generic/Kimi implementation reports and prevent overwriting reports from other tools (each tool uses its own suffix for parallel implementation capability).
7. **PRD Update** (if applicable): Change phase status from `in-progress` to `complete`.
8. **Archive**: Move plan to `.prp-output/plans/completed/`.

**Output**: Status, validation summary, files changed, deviations, artifacts, PRD progress, next steps.

**Failure Handling**:
- Type-check fails → read error, fix, re-run, don't proceed until passing
- Tests fail → determine if implementation or test bug, fix root cause, re-run
- Lint fails → auto-fix then manual fix remaining
- Build fails → check error output, fix, re-run
- Integration fails → check server, verify endpoint, fix, retry

---

## Workflow: Review

**Trigger**: User says "review PR #X" or "review the current PR".

### Setup

1. Get PR details (`gh pr view`), changed files (`gh pr diff --name-only`), classify files.

### Aspect Selection

| Aspect | When to Run |
|--------|-------------|
| Code Quality | **Always** — guidelines, bugs, naming, dead code (80%+ confidence only) |
| Documentation | **Almost always** — skip for typo/test/config-only. Auto-commit updates. |
| Test Coverage | When test files or tested code changed — behavioral coverage, gaps, criticality 1-10 |
| Comment Analysis | When comments/docstrings added — accuracy, completeness, rot risk |
| Error Handling | When error handling changed — silent failures (zero tolerance), logging, specific catches |
| Type Design | When types changed — encapsulation, invariants, usefulness, enforcement (each 1-10) |
| Simplification | **Last** — nested ternaries → if/else, clever → explicit. Auto-commit improvements. |

### Output

Categorize as Critical (block merge) / Important (address) / Suggestions / Strengths.
Include Documentation Updates and Verdict: READY TO MERGE / NEEDS FIXES / CRITICAL ISSUES.

**Save Local Review**: Save aggregated review to `.prp-output/reviews/pr-{NUMBER}-review-other.md` before posting.

> **Note**: Uses `-other` suffix to identify generic/Kimi reviews and prevent overwriting reviews from other tools (each tool uses its own suffix for parallel review capability).

**Post to GitHub**: `gh pr comment <number> --body-file .prp-output/reviews/pr-{NUMBER}-review-other.md`
**Update Implementation Report**: After posting, find implementation report (`.prp-output/reports/*-report.md`). If exists, append "Review Outcome" section with review date, verdict, and issue counts. If not found, skip silently.

### Usage

- "Review PR #163" → full review (all applicable aspects)
- "Review PR #163, focus on tests and errors" → specific aspects
- "Review current branch" → uses current branch's PR
- "Just simplify PR #42" → simplification pass only

---

## Workflow: Review Fix

**Trigger**: User says "fix review issues for PR #X" or "apply review fixes" or "fix all critical and high issues in PR #X".

### Input

`<pr-number|review-artifact-path> [--severity critical,high,medium,suggestion]`

### Steps

1. **Load Artifact**:
   - If input is a path → use directly.
   - If PR number (or no input → `gh pr view --json number`): `ls -t .prp-output/reviews/pr-{NUMBER}-review*.md`
   - 1 artifact → use it, show filename to user.
   - Multiple → list with tool suffix + modified date, ask user to select (default: most recent). User can skip prompt by passing path directly.
   - None → STOP: "Run Review workflow first."
   Parse severity filter (default: all). Map sections: Critical / Important / Suggestions.

2. **Checkout PR Branch**: `gh pr view {NUMBER} --json headRefName,state` → if MERGED/CLOSED: STOP. `gh pr checkout {NUMBER}` → pull latest.

3. **Triage**: Print fix plan with counts per severity before making any changes.

4. **Fix (Critical → High → Medium → Suggestion)**:
   - For each issue: read flagged file, apply recommended fix
   - Don't refactor unrelated code
   - If fix is ambiguous or risky → SKIP with logged reason
   - After each severity batch: run type-check + lint
   - If batch fails: revert failing fix, add to skip log, re-validate

5. **Full Validation**: Type check + lint + tests + build — all must pass. Revert fixes that cause failures.

6. **Commit & Push**:
   ```
   git add -A
   git commit -m "fix: apply review fixes for PR #{NUMBER} ({N} fixed, {N} skipped)"
   git push origin $(git branch --show-current)
   ```
   Skip commit if no changes.

7. **Post Comment**: `gh pr comment {NUMBER} --body "..."` with: fixed/skipped table per severity, validation results, skipped issue list with reasons, commit hash.

8. **Update Artifact**: Append "Fix Outcome" section to review file with timestamp, commit, counts.

### Severity Filter

| Flag | Fixes |
|------|-------|
| `--severity critical` | Critical only |
| `--severity critical,high` | Critical + High |
| `--severity critical,high,medium` | All except suggestions |
| No flag | All (default) |

### Output

Report: fixed/skipped per severity, validation status, next steps.
- All critical/high fixed → "Ready for re-review."
- Critical still open → "⚠️ {N} critical issues require manual attention."

### Edge Cases

- No artifact → STOP, instruct to run Review workflow first
- Drift detected → warn, attempt if context clear, else skip
- Already fixed → skip silently
- All skipped → no commit, report reasons

### Usage

- "Fix review issues for PR #163" → fix all severities
- "Fix only critical and high in PR #163" → `--severity critical,high`
- "Apply review fixes" → current branch's PR, all severities

---

## Workflow: Commit

**Trigger**: User says "commit" or "commit the typescript files".

### Steps

0. **Pre-commit quality check (advisory)**: scan staged files for debug artifacts (TODO/FIXME, console.log/debugger), `any` type usage in .ts files, quick validation (skip in run-all). Warns but does NOT block commit.
1. `git status --short` — if nothing, stop
2. Stage matching files based on target description:
   - blank = all, `staged` = current, patterns = matching files
   - `except X` = add all then reset matching, `only new files` = untracked only
3. Show staged: `git diff --cached --name-only`
4. Commit with conventional format: `{type}: {description}` (feat/fix/refactor/docs/test/chore)
5. Report: hash, message, file count

---

## Workflow: PR

**Trigger**: User says "create PR" or "push and create pull request".

### Steps

1. **Validate**: Not on main (STOP), clean working dir (WARN), has commits ahead (STOP if none). Check existing PR (report URL if exists).
2. **Gather**: Check PR templates (.github/PULL_REQUEST_TEMPLATE.md and variants). Analyze commits and files. Determine title ({type}: {description}). Extract issue references (Fixes/Closes/Relates to #N).
3. **Push**: `git push -u origin HEAD` (if fails, may need `--force-with-lease` — warn user)
4. **Create**: `gh pr create` with template or default format (Summary, Changes, Files Changed with `<details>` collapsible, Testing checklist, Related Issues)
5. **Verify**: `gh pr view --json number,url,title,state` and `gh pr checks`
6. **Report**: PR URL, title, changes count, CI status, next steps

### Edge Cases

- Branch diverged → rebase then force-with-lease
- Required template sections → parse and fill
- Multiple templates → use default or ask
- Draft PR → `gh pr create --draft`

---

## Workflow: Run All

**Trigger**: User says "run full PRP workflow for..." or "implement end-to-end...".

### Step 0: Parse Input

First, parse the user's input for options:

| If User Says | Action |
|-------------|--------|
| "use this plan: path/to/plan.md" or includes `--prp-path` | Set PLAN_PATH. Skip Step 2. |
| "skip review" or includes `--skip-review` | Skip Step 6. |
| "no PR" or "don't create PR" or includes `--no-pr` | Skip Steps 5 and 6. |
| "resume" or includes `--resume` | Resume from last failed step using saved state. |
| includes `--fix-severity <levels>` | Override review-fix severity (default: `critical,high`). |
| Everything else | Use as FEATURE description |

Set variables:
- FEATURE = the feature description text
- PLAN_PATH = path to plan (if provided, otherwise created in Step 2)
- BRANCH = determined in Step 1
- PR_NUMBER = determined in Step 5

**Examples:**
- "Run PRP workflow for JWT authentication" → full workflow
- "Implement from plan .prp-output/plans/jwt.plan.md" → skip plan creation
- "Run PRP for JWT auth, skip the review" → skip review step
- "Implement from plan jwt.plan.md, no PR needed" → implement + commit only

### Steps (sequential, stop on failure)

1. **Branch**: Create feature branch (skip if already on one, not main/master). Failure on dirty main → STOP.
2. **Plan**: Create implementation plan (skip if PLAN_PATH provided). Update PLAN_PATH. DO NOT re-explain plan logic. Failure → STOP.
3. **Implement**: Execute plan with validation loops using PLAN_PATH. DO NOT add extra validation. Failure → STOP, report which task failed.
4. **Commit**: Stage and commit with conventional message. DO NOT manually stage files.
5. **PR**: Push and create pull request (skip if --no-pr). Update PR_NUMBER. Failure → STOP.
6. **Review** (skip if --skip-review or --no-pr): Set REVIEW_CYCLE = 1, MAX_CYCLES = 2.
   - **6.1** Run Review workflow with PR_NUMBER.
   - **6.2 Evaluate**: No critical/high → Step 7. Found + cycle ≤ 2 → Step 6.3. Found + cycle > 2 → report remaining → Step 7 (NEEDS MANUAL FIXES).
   - **6.3 Fix**: Run Review Fix workflow with `PR_NUMBER --severity critical,high`. Fixes Critical and High only — Medium/Suggestion don't block merge.
   - **6.4 Re-verify**: REVIEW_CYCLE++. Re-run Review workflow to confirm fixes and check for regressions → return to Step 6.2.
7. **Summary**: Report all results: feature, branch, steps executed, artifacts, review verdict, remaining issues (if any), next steps.

### Rules

- **Delegate, don't duplicate** — each step handles its own logic
- **Stop on failure** — never continue with broken state
- **Pass context forward** — info flows from earlier to later steps
- **No extra validation** — each workflow validates its own output
- **One commit per implementation** — review fixes committed separately by Review Fix workflow
- **Max 2 review cycles** — if still critical after 2 fix-and-re-verify cycles, stop and report
- **Re-verify after fix** — always re-run Review after Review Fix to confirm resolution and catch regressions

---

## Feature Availability by Tool

Not all features are available in all AI coding tools. The 9 core commands work everywhere, but advanced features require Claude Code.

| Feature | Claude Code | Codex | OpenCode | Gemini | Antigravity | Kimi/Generic |
|---------|:-----------:|:-----:|:--------:|:------:|:-----------:|:------------:|
| **Core (9 commands)** | | | | | | |
| PRD, Design, Plan | Yes | Yes | Yes | Yes | Yes | Yes |
| Implement, Commit, PR | Yes | Yes | Yes | Yes | Yes | Yes |
| Review, Review-Fix | Yes | Yes | Yes | Yes | Yes | Yes |
| Run-All | Yes | Yes | Yes | Yes | Yes | Yes |
| **Advanced (Claude Code only)** | | | | | | |
| Review Agents (multi-agent) | Yes | - | - | - | - | - |
| Feature Review (single/multi) | Yes | - | - | - | - | - |
| Debug (root cause analysis) | Yes | - | - | - | - | - |
| Issue Investigate / Fix | Yes | - | - | - | - | - |
| Ralph (autonomous loop) | Yes | - | - | - | - | - |
| Marketing (4 commands) | Yes | - | - | - | - | - |
| AI Bot (5 commands) | Yes | - | - | - | - | - |
| 31 Specialized Agents | Yes | - | - | - | - | - |
| **Run-All Flags** | | | | | | |
| --prp-path | Yes | Yes | Yes | Yes | Yes | - |
| --ralph / --ralph-max-iter | Yes | - | - | - | - | - |
| --resume | Yes | Yes | Yes | Yes | Yes | - |
| --fix-severity | Yes | Yes | Yes | Yes | Yes | - |
| --skip-review / --no-pr | Yes | Yes | Yes | Yes | Yes | Yes |
| **Quality** | | | | | | |
| Coverage enforcement (90%) | Yes | Yes | Yes | Yes | Yes | Yes |
| Review context handoff | Yes | Yes | Yes | Yes | Yes | - |
| TDD approach (test-first) | Yes | Yes | Yes | Yes | Yes | Yes |
| Conditional Technical Design | Yes | Yes | Yes | Yes | Yes | Yes |
| PRD enhanced sections | Yes | Yes | Yes | Yes | Yes | Yes |
| Validation levels (security/perf/API) | Yes | Yes | Yes | Yes | Yes | Yes |
| Pre-commit quality check | Yes | Yes | Yes | Yes | Yes | Yes |
| Expanded testing strategy | Yes | Yes | Yes | Yes | Yes | Yes |

**Note**: `-` means the feature is not available in that tool. Kimi/Generic uses natural language triggers and cannot enforce flag-based workflows.

---

## Project Conventions

When using these workflows, always check for project-specific instruction files:
- `CLAUDE.md` — Claude Code conventions
- `AGENTS.md` — Codex/Kimi conventions
- `GEMINI.md` — Gemini CLI conventions
- `.cursorrules` — Cursor conventions

Follow whichever convention file exists in the project.

---

## Artifacts

All workflows produce artifacts in `.prp-output/`:

```
.prp-output/
├── prds/               # Product Requirements Documents
├── designs/            # Design Documents
├── plans/              # Implementation plans
│   └── completed/      # Archived plans
├── reports/            # Implementation reports
├── reviews/            # Review reports
├── debug/              # Debug/RCA reports
└── issues/             # Issue investigations
```

## PSak Soul Memory Protocol

Principle: Treat conversation as ephemeral, treat memory as permanent.

### Session Start (every session)
Call `session_resume(project="arra-oracle-v3")` before responding to the first message.

### Proactive Memory (during session)
| Trigger | Action | Category |
|---|---|---|
| Decision made | `write_memory` immediately | strategy |
| Technical pattern discovered | `proactive_save` immediately | code |
| Bug root cause found | `write_memory` immediately | code |
| User says remember/save | `write_memory` immediately | by content |

### Session End
When user says bye/done/end session:
1. `reflect(diary="...", lessons=[...], mood="...", project="arra-oracle-v3")`
2. `session_handoff(context="...", handoff_type="end", project="arra-oracle-v3")`

### Available Skills
- `soul-reflect` - self-reflection diary and lessons
- `soul-remember` - explicit memory save
- `soul-recall` - hybrid long-term search
- `soul-handoff` - session checkpoint/end context
- `soul-context` - load latest session context
- `soul-evolve` - propose soul identity change
- `soul-learn` - save codebase learning
- `soul-digest` - daily pattern synthesis
