# CLAUDE.md - Generic AI Assistant Guidelines

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

### Project Overview
Arra Oracle v3 is a TypeScript MCP server providing semantic memory search over Oracle philosophy files. It exposes 20 `arra_*` tools via both stdio (local Claude Code) and Streamable HTTP (remote clients). The HTTP transport supports OAuth 2.1 + PKCE and static Bearer auth.

### Architecture
-   **Runtime**: Bun (>=1.2.0)
-   **HTTP Framework**: Hono
-   **Database**: SQLite + FTS5 (Drizzle ORM), pluggable vector backend
-   **Vector Backends**: Qdrant Cloud (production), LanceDB (local dev), ChromaDB (legacy)
-   **MCP Transports**: stdio (`src/index.ts`), Streamable HTTP (`src/mcp-transport.ts`)
-   **Auth**: OAuth 2.1 + PKCE (`src/oauth/`), static Bearer token fallback
-   **Port**: 47778

### Current Features
-   20 `arra_*` MCP tools (search, read, learn, threads, traces, handoff)
-   Hybrid FTS5 + vector search with graceful degradation
-   Streamable HTTP MCP transport at `/mcp` (feature-gated on `MCP_AUTH_TOKEN`)
-   OAuth 2.1 + PKCE for Claude Desktop (feature-gated on `MCP_OAUTH_PIN`)
-   Atomic token persistence, HMAC timing-safe comparison
-   Vault CLI for managing the knowledge vault

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

In production, the backend serves both API endpoints and the built React app from `frontend/dist/`.

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

### Useful Tricks Discovered
-   **Parallel agents for analysis** - Using multiple agents to analyze different aspects speeds up planning significantly
-   **ccc → nnn workflow** - Context capture followed by focused planning creates better structured issues
-   **Phase markers in issues** - Using "Phase 1:", "Phase 2:" helps track incremental progress

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

<!-- PRP-FRAMEWORK:BEGIN v2.3.0 (managed by prp-framework — do not edit manually) -->
## PRP Workflow

| Action | Command | Description |
|--------|---------|-------------|
| Plan | `/prp-core:prp-plan` | Create implementation plan |
| Implement | `/prp-core:prp-implement` | Execute plan with validation |
| Review | `/prp-core:prp-review-agents` | Multi-agent PR review |
| Commit | `/prp-core:prp-commit` | Smart commit with context |
| PR | `/prp-core:prp-pr` | Create PR from branch |
| Cleanup | `/prp-core:prp-cleanup` | Post-merge branch cleanup |
| Full workflow | `/prp-core:prp-run-all` | Plan → Implement → PR → Review |

Artifacts: `.prp-output/` | All commands: `/prp-core:prp-*`, `/prp-mkt:prp-*`, `/prp-bot:prp-*`
<!-- PRP-FRAMEWORK:END -->
