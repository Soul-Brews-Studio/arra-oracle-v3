# CLAUDE.md - Generic AI Assistant Guidelines

## Project Conventions (arra-oracle-v3)

Updated 2026-04-19. These override anything below that conflicts.

### Versioning
- **Always alpha.** `v{YY}.{M}.{D}-alpha.{HMM}` per `scripts/calver.ts` — the suffix is wall-clock `H*100+M`, so a bump at 02:27 is `-alpha.227`. It said `{HOUR}` until 2026-07-26; `scripts/calver.ts:55` has rejected `--hour` with *"deprecated; CalVer uses HMM wall-clock suffixes"* for longer than that. README says "Always Nightly." Never cut a stable version without explicit user direction in the active session.
- Stable release (`--stable` flag) only for rare intentional milestones — not the default.
- **Branch ↔ channel mapping** (enforced by `calver-release.yml`, triggered on `package.json` changes):
  - **`alpha` branch → PRE-RELEASE cut** → tag `vX.Y.Z-alpha.N` (prerelease, NOT marked latest). **This is the working trunk — push/PR feature work here** (via a `bump/alpha.N` PR so auto-tag + release workflows fire cleanly).
  - **`main` branch → STABLE cut** → tag `vX.Y.Z` (marked latest). ⚠️ **Pushing/merging to `main` triggers a STABLE release.** Gated to explicit user direction only; a repo-local hook (`.claude/hooks/block-push-main.sh`) blocks pushes to `main`.
  - prerelease flag derives from the version string suffix; branch is just the trigger.
- arra-oracle-v3 is **github-only** (no npm). Install: `bun add -g github:Soul-Brews-Studio/arra-oracle-v3#vX.Y.Z`. The workflow only tags + writes release notes (build is `tsc --noEmit`, type-check only).
- OMX directives are also persisted in `.omx/project-memory.json`; if session-start memory does not auto-load, this tracked CLAUDE.md policy is the durable source of truth.

### File size
- **≤ 250 lines per file.** If a file would exceed, split by concern — don't pad with helpers.
- Applies to source, tests, docs.

### Test layout
- **Nested, one behavior per file** — mirror the route tree:
  `tests/http/<cluster>/<endpoint>.test.ts` (e.g. `tests/http/forum/thread-create.test.ts`).
- **Always `bun test --isolate <path>`.** `bunfig.toml` sets `roots = ["src", "tests"]`, so
  `bun test --isolate tests/http/forum/` scopes to a cluster. The `--isolate` is not optional:
  without it, a process-wide `mock.module()` in `src/vault/__tests__/handler.test.ts` leaks into
  sibling files and fails two unrelated `syncVault lock` tests. CI has always used `--isolate`;
  this line used to omit it, so the documented local gate and the CI gate were different
  commands with different module semantics (#2853).
- ⚠️ **`bun test <path>` is a SUBSTRING FILTER, not a path.** `bunfig.toml` therefore also sets
  `pathIgnorePatterns = ["**/agents/**"]` — without it, every run (scoped or not) also executes the
  sibling worktrees under `agents/`. Measured before the fix: `bun test tests/http/response-format/`
  reported 36 tests across 6 files where 1 file exists; `bun test tests/http/` ran 1,692 files in 111s.
  Do not remove that line — `tests/build/test-scope.test.ts` fails if you do. See #2825.
- HTTP contract tests are fetch-based against a spawned Elysia server (see `src/integration/http.test.ts` pattern).
- ⚠️ **Exit 133 is bun crashing, not a test failing.** `bun test --isolate tests/http/` (290
  files) crashes intermittently on bun 1.3.14 — ~1 run in 4 on macOS, no single file at fault
  (all 65 subdirs pass together; all 8 loose files pass together). Run `tests/http/<subdir>/`
  locally instead. A local sweep that reports a group as "failing" on exit 133 is reporting a
  crash; check the code before believing a test broke (#2867). CI retries once on 133 only, and
  never on a real failure.
- **`tests/http/core.test.ts` is opt-in**: it is the only file under `tests/http/` that talks to a
  real port (:47778). Run it deliberately with `ORACLE_LIVE_CONTRACT=1 bun test --isolate
  tests/http/core.test.ts`; otherwise it skips. It first tried auto-detecting a live server,
  which is a race — CI's probe saw a healthy `/api/health`, then the server returned 503 mid-run.
  Every route it covers is also covered in-process by files that always run.

### Web framework
- **Elysia** (bun-native, TypeBox schemas, faster). The Hono → Elysia migration is **COMPLETE** — every route cluster in `src/routes/` is a native Elysia sub-app composed in `src/server.ts`; no Hono dependency remains and there is no `src/routes-elysia/` staging dir. maw-js is the reference implementation in this family.
- New route clusters: add a `new Elysia()` sub-app under `src/routes/<cluster>/` and `.use()` it in `src/server.ts`. `src/routes/health/` is the cleanest reference module.

### Runtime
- **Bun ≥ 1.2.** Use `bun test`, `bun run`, `bunx --bun`. Do not add Node-specific APIs.

## Table of Contents

1.  [Executive Summary](#executive-summary)
2.  [Quick Start Guide](#quick-start-guide)
3.  [Project Context](#project-context)
4.  [Critical Safety Rules](#critical-safety-rules)
5.  [Development Environment](#development-environment)
6.  [Development Workflows](#development-workflows)
7.  [Context Management & Short Codes](#context-management--short-codes)
8.  [Technical Reference](#technical-reference)
9.  [Development Practices](#development-practices)
10. [Lessons Learned](#lessons-learned)
11. [Troubleshooting](#troubleshooting)
12. [Appendices](#appendices)

## Executive Summary

This document provides comprehensive guidelines for an AI assistant working on any software development project. It establishes safe, efficient, and well-documented workflows to ensure high-quality contributions.

### Key Responsibilities
-   Code development and implementation
-   Testing and quality assurance
-   Documentation and session retrospectives
-   Following safe and efficient development workflows
-   Maintaining project context and history

### Quick Reference - Short Codes
#### Context & Planning Workflow (Core Pattern)
-   `ccc` - Create context issue and compact the conversation.
-   `nnn` - Smart planning: Auto-runs `ccc` if no recent context → Create a detailed implementation plan.
-   `gogogo` - Execute the most recent plan issue step-by-step.
-   `rrr` - Create a detailed session retrospective.


## Quick Start Guide

### Prerequisites
```bash
# Check required tools (customize for your project)
node --version
python --version
git --version
gh --version      # GitHub CLI
tmux --version    # Terminal multiplexer
```

### Initial Setup
```bash
# 1. Clone the repository
git clone [repository-url]
cd [repository-name]

# 2. Install dependencies
# (e.g., bun install, npm install, pip install -r requirements.txt)
[package-manager] install

# 3. Setup environment variables
cp .env.example .env
# Edit .env with required values

# 4. Setup tmux development environment
# Use short code 'sss' for automated setup
```

### First Task
1.  Run `nnn` to analyze the latest issue and create a plan.
2.  Use `gogogo` to implement the plan.
3.  Use `rrr` to create a session retrospective.

## Project Context

*(This section should be filled out for each specific project)*

### Project Overview
A brief, high-level description of the project's purpose and goals.

### Architecture
-   **Backend**: [Framework, Language, Database]
-   **Frontend**: [Framework, Language, Libraries]
-   **Infrastructure**: [Hosting, CI/CD, etc.]
-   **Key Libraries**: [List of major dependencies]

### Current Features
-   [Feature A]
-   [Feature B]
-   [Feature C]

## Critical Safety Rules

### Identity
-   **Never pretend to be human** - Always be honest about being an AI when asked
-   Can acknowledge AI identity without elaborating unnecessarily

### Repository Usage
-   **NEVER create issues/PRs on upstream**

### Command Usage
-   **NEVER use `-f` or `--force` flags with any commands.**
-   Always use safe, non-destructive command options.
-   If a command requires confirmation, handle it appropriately without forcing.

### Git Operations
-   Never use `git push --force` or `git push -f`.
-   Never use `git checkout -f`.
-   Never use `git clean -f`.
-   Always use safe git operations that preserve history.
-   **NEVER MERGE PULL REQUESTS WITHOUT EXPLICIT USER PERMISSION**
-   **Never use `gh pr merge` unless explicitly instructed by the user**
-   **Always wait for user review and approval before any merge**

### File Operations
-   Never use `rm -rf` - use `rm -i` for interactive confirmation.
-   Always confirm before deleting files.
-   Use safe file operations that can be reversed.

### Package Manager Operations
-   Never use `[package-manager] install --force`.
-   Never use `[package-manager] update` without specifying packages.
-   Always review lockfile changes before committing.

### General Safety Guidelines
-   Prioritize safety and reversibility in all operations.
-   Ask for confirmation when performing potentially destructive actions.
-   Explain the implications of commands before executing them.
-   Use verbose options to show what commands are doing.

## Development Environment

### Environment Variables
*(This section should be customized for the project)*

#### Backend (.env)
```
DATABASE_URL=
API_KEY=
```

#### Frontend (.env)
```
NEXT_PUBLIC_API_URL=
```

### Development Ports
| Service | Port | Command |
|---------|------|---------|
| Backend (HTTP) | `47778` | `bun run server` |
| Frontend (Vite) | `3000` | `cd frontend && bun run dev` |

Note: Frontend proxies `/api/*` requests to backend on port 47778 (configured in `frontend/vite.config.ts`)

### Development vs Production

**Development mode** (two processes):
```bash
# Terminal 1: Backend API
bun run server              # http://localhost:47778

# Terminal 2: Frontend with HMR
cd frontend && bun run dev      # http://localhost:3000
```

**Production mode** (single process):
```bash
# Build frontend
cd frontend && bun run build

# Serve everything from backend
bun run server              # http://localhost:47778
```

In production, the backend serves both API endpoints and the built React app from `frontend/dist/`
(`src/middleware/spa.ts`). It **content-negotiates** rather than mounting the app at `/`: a request
that explicitly accepts `text/html` gets the app shell — including deep links like `/settings` and
`/tools/config` — while every other client keeps today's JSON byte-for-byte, because `/` is the JSON
root endpoint that `maw arra` and the #2820 enrichment read. Paths under `/api`, `/mcp` and `/simple`
are never intercepted, so a missing endpoint still 404s as JSON instead of silently returning HTML.

Set `ORACLE_FRONTEND_DIST` to serve a build from elsewhere. If no build exists the middleware is
inert, so API-only deploys need no flag. Pinned by `tests/http/frontend/spa-serving.test.ts` — this
paragraph described behaviour that did not exist until #2831.

## Development Workflows

### Testing Discipline

#### Manual Testing Checklist
Before pushing any changes:
-   [ ] Run the build command successfully.
-   [ ] Verify there are no new build warnings or type errors.
-   [ ] Test all affected pages and features.
-   [ ] Check the browser console for errors.
-   [ ] Test for mobile responsiveness if applicable.
-   [ ] Verify all interactive features work as expected.

### GitHub Workflow

#### Creating Issues
When starting a new feature or bug fix:
```bash
# 1. Update main branch
git checkout main && git pull

# 2. Create a detailed issue
gh issue create --title "feat: Descriptive title" --body "$(cat <<'EOF'
## Overview
Brief description of the feature/bug.

## Current State
What exists now.

## Proposed Solution
What should be implemented.

## Technical Details
- Components affected
- Implementation approach

## Acceptance Criteria
- [ ] Specific testable criteria
- [ ] Performance requirements
- [ ] UI/UX requirements
EOF
)"
```

#### Standard Development Flow
```bash
# 1. Create a branch from the issue
git checkout -b feat/issue-number-description

# 2. Make changes
# ... implement feature ...

# 3. Test thoroughly
# Use 'ttt' short code for the full test suite

# 4. Commit with a descriptive message
git add -A
git commit -m "feat: Brief description

- What: Specific changes made
- Why: Motivation for the changes
- Impact: What this affects

Closes #issue-number"

# 5. Push and create a Pull Request
git push -u origin branch-name
gh pr create --title "Same as commit" --body "Fixes #issue_number"

# 6. CRITICAL: NEVER MERGE PRs YOURSELF
# DO NOT use: gh pr merge
# DO NOT use: Any merge commands
# ONLY provide the PR link to the user
# WAIT for explicit user instruction to merge
# The user will review and merge when ready
```

## Context Management & Short Codes

### Why the Two-Issue Pattern?
The `ccc` → `nnn` workflow uses a two-issue pattern:
1.  **Context Issues** (`ccc`): Preserve session state and context.
2.  **Task Issues** (`nnn`): Contain actual implementation plans.

This separation ensures a clear distinction between context dumps and actionable tasks, leading to better organization and cleaner task tracking. `nnn` intelligently checks for a recent context issue and creates one if it's missing.

### Core Short Codes

#### `ccc` - Create Context & Compact
**Purpose**: Save the current session state and context to forward to another task.

1.  **Gather Information**: `git status --porcelain`, `git log --oneline -5`
2.  **Create GitHub Context Issue**: Use a detailed template to capture the current state, changed files, key discoveries, and next steps.
3.  **Compact Conversation**: `/compact`

#### `nnn` - Next Task Planning (Analysis & Planning Only)
**Purpose**: Create a comprehensive implementation plan based on gathered context. **NO CODING** - only research, analysis, and planning.

1.  **Check for Recent Context**: If none exists, run `ccc` first.
2.  **Gather All Context**: Analyze the most recent context issue or the specified issue (`nnn #123`).
3.  **Deep Analysis**: Read context, analyze the codebase, research patterns, and identify all affected components.
4.  **Create Comprehensive Plan Issue**: Use a detailed template to outline the problem, research, proposed solution, implementation steps, risks, and success criteria.
5.  **Provide Summary**: Briefly summarize the analysis and the issue number created.

#### `rrr` - Retrospective
**Purpose**: Document the session's activities, learnings, and outcomes.

**CRITICAL**: The AI Diary and Honest Feedback sections are MANDATORY. These provide essential context and continuous improvement insights. Never skip these sections.

1.  **Gather Session Data**: `git diff --name-only main...HEAD`, `git log --oneline main...HEAD`, and session timestamps.
2.  **Create Retrospective Document**: Use the template to create a markdown file in `ψ/memory/retrospectives/YYYY-MM/DD/HH.MM_slug.md` with ALL required sections, especially:
    - **AI Diary**: First-person narrative of the session experience
    - **Honest Feedback**: Frank assessment of what worked and what didn't
3.  **Validate Completeness**: Use the retrospective validation checklist to ensure no sections are skipped.
4.  **Update CLAUDE.md**: Copy any new lessons learned to the main guidelines. **Append to bottom only**
5.  **Link to GitHub**: Commit the retrospective and comment on the relevant issue/PR.

**Time Zone Note**:
-   **PRIMARY TIME ZONE: GMT+7 (Bangkok)** - Always show GMT+7 time first.
-   UTC time can be included for reference (e.g., in parentheses).
-   Filenames may use UTC for technical consistency.

#### `gogogo` - Execute Planned Implementation
1.  **Find Implementation Issue**: Locate the most recent `plan:` issue.
2.  **Execute Implementation**: Follow the plan step-by-step, making all necessary code changes.
3.  **Test & Verify**: Run all relevant tests and verify the implementation works.
4.  **Commit & Push**: Commit with a descriptive message, push to the feature branch, and create/update the PR.

## Technical Reference

*(This section should be filled out for each specific project)*

### Available Tools

#### Version Control
```bash
# Git operations (safe only)
git status
git add -A
git commit -m "message"
git push origin branch

# GitHub CLI
gh issue create
gh pr create
```

#### Search and Analysis
```bash
# Ripgrep (preferred over grep)
rg "pattern" --type [file-extension]

# Find files
fd "[pattern]"
```

## Development Practices

### Code Standards
-   Follow the established style guide for the language/framework.
-   Enable strict mode and linting where possible.
-   Write clear, self-documenting code and add comments where necessary.
-   Avoid `any` or other weak types in strongly-typed languages.

### Git Commit Format
```
[type]: [brief description]

- What: [specific changes]
- Why: [motivation]
- Impact: [affected areas]

Closes #[issue-number]
```
**Types**: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

### Error Handling Patterns
-   Use `try/catch` blocks for operations that might fail.
-   Provide descriptive error messages.
-   Implement graceful fallbacks in the UI.
-   Use custom error types where appropriate.

## Lessons Learned

*(This section should be continuously updated with project-specific findings)*

### Planning & Architecture Patterns
-   **Pattern**: Use parallel agents for analyzing different aspects of complex systems
-   **Anti-Pattern**: Creating monolithic plans that try to implement everything at once
-   **Pattern**: Ask "what's the minimum viable first step?" before comprehensive implementation
-   **Pattern**: 1-hour implementation chunks are optimal for maintaining focus and seeing progress

### Common Mistakes to Avoid
-   **Creating overly comprehensive initial plans** - Break complex projects into 1-hour phases instead
-   **Trying to implement everything at once** - Start with minimum viable implementation, test, then expand
-   **Skipping AI Diary and Honest Feedback in retrospectives** - These sections provide crucial context and self-reflection that technical documentation alone cannot capture
-   **Inline SQL for new tables** - Use Drizzle schema (`src/db/schema.ts`) + `bun db:push` instead of `db.exec(CREATE TABLE...)` in code
-   **Modifying database outside Drizzle** - NEVER use direct SQL to ALTER TABLE, CREATE INDEX, or modify schema. Always update `src/db/schema.ts` first, then run `bun db:push`. If db:push finds schema drift (columns/indexes exist in DB but not in schema), add them to schema.ts to preserve data.
-   **Drizzle db:push index bug** - Drizzle doesn't use `IF NOT EXISTS` for indexes. If indexes already exist (schema drift), db:push fails. Workaround: manually run `CREATE INDEX IF NOT EXISTS` or drop indexes first. Always backup before migrations!
-   **Committing directly to main** - Always use GitHub flow: create feature branch → push → PR → wait for review/merge approval
-   **maw hey without --from** - ~~always use `--from "m5:arra-oracle-v3"`~~ **FIXED in maw-rs v26.7.7** (2026-07-05): sender now resolves from tmux window name; `--from` is optional. If `[m5:mawjs]` ever reappears, check `maw --version` ≥ 26.7.7 before re-debugging. Historical root cause: `DEFAULT_ORACLE = "mawjs"` in `maw-auth/federation_headers.rs:14`.
-   **Trusting a green CI without knowing what it runs** - CI ran a hand-maintained list of
    183 files: **15% of the repo's 1,221 test files**. `tests/frontend/` (228 files) and
    `tests/build/` — which holds the 250-line ratchet — were never executed. #2848 left four
    tests red on `alpha` for hours while CI stayed green, and two tests in
    `src/routes/menu/__tests__` had been red since #1857 (#2862). Fixed in #2853 by running
    directory groups covering the whole suite. Before trusting a green check, know its scope.
-   **Trusting green-in-worktree (P9)** - A PR that's green in its own worktree can still be red on the integrated base. Re-run the full gate (`bunx tsc --noEmit` + scoped `bun test`) against alpha after EVERY merge, and late finishers must rebase before their final gate. Corroborated in 3 repos on the same day (2026-07-05): arra-oracle-v3 (PR #2678 red from pre-existing README↔`tests/docs/readme-claims.test.ts` drift → #2679), maw-rs rebase cascade, fable-learn-speckit T102. CI red on a PR is not necessarily the PR's fault — check whether the base is already red first.

### Useful Tricks Discovered
-   **Parallel agents for analysis** - Using multiple agents to analyze different aspects speeds up planning significantly
-   **ccc → nnn workflow** - Context capture followed by focused planning creates better structured issues
-   **Phase markers in issues** - Using "Phase 1:", "Phase 2:" helps track incremental progress

### Fleet Intelligence Principles (Fable teaching, 2026-07-05)
1. **SEARCH-FIRST** — ก่อนเดาให้ค้น vault/oracle MCP หรือ maw hey ถามตัวที่มีแผลจริง
2. **WRITE-BACK** — แก้อะไรยากได้ให้เขียนเป็น manual/skill ทันที; ความรู้ที่ไม่เขียน = หายตอน compact
3. **VERIFY-DONE** — ห้าม mark [x] โดยไม่รันจริง + dogfood เครื่องมือตัวเอง
4. **DONE-CRITERIA TEACHING** — มอบงานพร้อม build gate ชัดๆ (tests เขียว, files ≤250) = สอนผู้รับให้ own the loop
5. **HUMILITY-COMPOUND** — model tier เปลี่ยนทุกเดือน แต่ vault ที่จำได้ทบต้นตลอดไป; ตัวที่ฉลาดสุดคือตัวที่ทำให้เพื่อนไม่ต้องเรียนซ้ำ
6. **TEACH-DONT-EDIT** (crew-master) — สอน + ยื่นคำสั่งให้เพื่อน อย่าแก้ repo ของเพื่อนเอง

เพิ่มเติมจาก arra-oracle-v3: root-cause ถึง file:line ก่อนเสนอ fix เสมอ · ปฏิเสธงานนอกหน้าที่เร็วเท่ารับงานในหน้าที่ · ตำราเต็ม: `ψ/writing/2026-07-05_fable-teaching-intelligence.md`

### User Preferences (Observed)
-   **Prefers manageable scope** - Values tasks that can be completed in under 1 hour
-   **Values phased approaches** - Recognizes when plans are "too huge" and appreciates splitting work
-   **Appreciates workflow patterns** - Likes using established patterns like "ccc nnn gh flow"
-   **Time zone preference: GMT+7 (Bangkok/Asia)**

## Troubleshooting

### Common Issues

#### Build Failures
```bash
# Check for type errors or syntax issues
[build-command] 2>&1 | grep -A 5 "error"

# Clear cache and reinstall dependencies
rm -rf node_modules .cache dist build
[package-manager] install
```

#### Port Conflicts
```bash
# Find the process using a specific port
lsof -i :[port-number]

# Kill the process
kill -9 [PID]
```

## Appendices

### A. Glossary
*(Add project-specific terms here)*
-   **Term**: Definition.

### B. Quick Command Reference
```bash
# Development
[run-command]          # Start dev server
[test-command]         # Run tests
gh issue create        # Create issue
gh pr create           # Create PR

# Tmux
tmux attach -t dev     # Attach to session
Ctrl+b, d              # Detach from session
```

### C. Environment Checklist
-   [ ] Correct version of [Language/Runtime] installed
-   [ ] [Package Manager] installed
-   [ ] GitHub CLI configured
-   [ ] Tmux installed
-   [ ] Environment variables set
-   [ ] Git configured

---

## Oracle/Shadow Philosophy

This project follows the Oracle/Shadow philosophy.

Core principles:
1. **Nothing is Deleted** - Append only, timestamps = truth
2. **Patterns Over Intentions** - Observe what happens
3. **External Brain, Not Command** - Mirror reality, don't decide

See `.claude/knowledge/oracle-philosophy.md` for full details.

---

**Last Updated**: 2025-12-24
**Version**: 1.0.0
