# AI Product Memory Patterns — 2026 Filing

Source: issue #1648 comments. Purpose: preserve product-level patterns separately from ARRA architecture recommendations.

## Pattern A — static rule files

Most coding tools converge on explicit files that are loaded into context or used as routing hints.

| Tool | File/scope pattern | Retrieval behavior | ARRA lesson |
| --- | --- | --- | --- |
| Cursor | `.cursor/rules/*.mdc`, legacy `.cursorrules`, user rules | Always, glob, agent-requested, or manual attachment | Use frontmatter + globs for portable memory rules |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/instructions/*.instructions.md`, user/org scopes | Applicable instructions combined client-side; memory validates citations | Add citation validation for repo facts |
| Zed | `.rules`, `.cursorrules`, `.windsurfrules`, AGENTS/CLAUDE/GEMINI docs | Reads known rule files at session start | Support common rule-file imports |
| Aider | `CONVENTIONS.md` or config-loaded files | Manual `/read` style memory | Keep operator-controlled import/export |
| Continue.dev | `.continue/rules/*.md` | Rule files loaded by trigger mode | Rules need predictable precedence |

## Pattern B — auto-extracted or managed memories

Auto memory is useful but riskier than rules files because it can be opaque, stale, or poisoned.

| Tool | Memory behavior | Risk | ARRA stance |
| --- | --- | --- | --- |
| ChatGPT | Bio-style stored memories injected into prompts | Unsupported inferences, stale entries, poisoning | Never silently promote permanent memory |
| Windsurf | Workspace-local auto memories plus rules | Local, non-git, intended as temporary | Treat auto notes as candidates for review |
| GitHub Copilot Memory | Repo/user memory with citations and expiry | Scope differences and hidden exclusion rules | Copy the validation/expiry idea, not opaque storage |
| Claude Projects | Project files direct-injected, then automatic RAG when too large | Retrieval switch is hidden from users | Be explicit when ARRA changes retrieval mode |
| Gemini Gems/Memory | Gems are stateless instructions/files; Memory is separate | Easy to conflate surfaces | Keep rules, memory, and indexed corpus separate |

## Cross-tool principles

1. **Files are the portability layer.** They survive tool churn and can be reviewed in PRs.
2. **Retrieval is the scale layer.** It should return citations, not just text.
3. **Validation is the trust layer.** Repo facts should be rechecked against current files.
4. **Expiry is a safety layer.** Unused or unvalidated memories should decay.
5. **Surface separation matters.** CLI, HTTP, MCP, and UI should share storage contracts but expose different permissions.

## ARRA filing requirements

- Keep `ψ/memory/ai-memory-systems-research.md` as the architecture synthesis.
- Keep this product-pattern file as the market/reference filing.
- Keep `ψ/memory/ai-memory-systems-claims-ledger.md` as the adversarial claim ledger.
- Future implementation issues should cite the specific filing they depend on instead of re-reading the whole issue thread.
