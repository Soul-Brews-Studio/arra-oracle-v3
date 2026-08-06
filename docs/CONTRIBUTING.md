# Contributor quickstart

This repo ships the Arra Oracle source package. Keep contribution loops small,
verifiable, and easy for the lead to review.

## 1. Start from alpha

```bash
git fetch origin
git switch -c feat/my-slice origin/alpha
```

Use your own branch/worktree. Do not push to `main`; all PRs target `alpha`.

## 2. Keep the slice narrow

- Change the smallest set of files needed for the issue.
- Prefer existing helpers and patterns before adding new abstractions.
- Keep every changed source, test, and doc file at or below 250 lines.
- Docs belong under `docs/`; do not write project docs into `ψ/`.

## 3. Add tests first when behavior changes

Pick the scoped test path that matches the changed area:

```bash
bun test tests/http/<cluster>/
bun test src/tools/__tests__/
bun test tests/tools/maw-plugin-arra/
```

For docs-only work, run the nearest relevant smoke test plus typecheck.

## 4. Run required gates

```bash
bunx tsc --noEmit
bun test <scoped-test-path>
wc -l <changed-files>
git diff --check
```

If a gate cannot run, explain the exact reason in the PR and issue update.

## 5. Write a reviewable PR

```bash
gh pr create \
  --repo Soul-Brews-Studio/arra-oracle-v3 \
  --base alpha \
  --head feat/my-slice
```

PR body checklist:

- `## Summary` with bullets.
- `## Validation` with exact commands in code blocks.
- `## Notes` for screenshots, docs-only status, or remaining risk.
- Link the issue with a normal reference or fully qualified closer when needed.

## 6. Update the GitHub issue

Use [GITHUB-ISSUE-UPDATES.md](./GITHUB-ISSUE-UPDATES.md) for formatted issue
comments. Every meaningful update should include:

- One status badge.
- `##` section headers.
- Bullets for summary/risk/next step.
- Code blocks for commands, logs, or screenshots links.
- PR link and validation evidence when ready for review.

## 7. UI screenshot rule

If a user-visible UI changed, capture a screenshot and post it to the issue before
reporting done. In the PR, link the issue comment that contains the screenshot.

## Done definition

A slice is done when the PR targets `alpha`, tests/typecheck are green, files are
≤250 lines, issue update is readable, and any UI screenshot is posted.
