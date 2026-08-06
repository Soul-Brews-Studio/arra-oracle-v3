# GitHub issue update format

Use this format for tracker issues so leads can skim status, evidence, and next
steps without reading raw logs. Keep comments short, structured, and copy/paste
friendly.

## Status badges

Use one badge at the top of every substantial issue update:

```md
![status: starting](https://img.shields.io/badge/status-starting-blue)
![status: working](https://img.shields.io/badge/status-working-yellow)
![status: blocked](https://img.shields.io/badge/status-blocked-red)
![status: ready for review](https://img.shields.io/badge/status-ready_for_review-purple)
![status: done](https://img.shields.io/badge/status-done-brightgreen)
```

Pick one status per comment. If the task changes scope, post a new update rather
than editing old evidence.

## Starting template

````md
![status: starting](https://img.shields.io/badge/status-starting-blue)

## Starting

- **Task:** #ISSUE short task name
- **Branch:** `feat/example-c12`
- **Scope:** `src/routes/example`, `tests/http/example`
- **Plan:**
  - Sync `origin/alpha`
  - Add focused tests before behavior changes
  - Implement the smallest safe slice
  - Run scoped tests + `bunx tsc --noEmit`

## Acceptance checks

```bash
bun test tests/http/example/
bunx tsc --noEmit
wc -l <changed-files>
```
````

## Progress template

````md
![status: working](https://img.shields.io/badge/status-working-yellow)

## Progress

- **Done:** concise bullets for completed work
- **Now:** one current action
- **Risk:** explicit risk or `None known`

## Evidence so far

```bash
bun test tests/http/example/
# current result or short failure summary
```
````

## Blocked template

````md
![status: blocked](https://img.shields.io/badge/status-blocked-red)

## Blocked

- **Blocker:** exact missing permission, dependency, or conflict
- **Tried:** alternatives already attempted
- **Impact:** what cannot proceed until resolved
- **Needed:** one concrete ask

## Evidence

```text
paste the shortest useful error or command output
```
````

## Done / PR template

````md
![status: ready for review](https://img.shields.io/badge/status-ready_for_review-purple)

## Summary

- Bullet 1: user-visible change
- Bullet 2: tests/edge cases added
- Bullet 3: files intentionally not touched

## Validation

```bash
bun test tests/http/example/
bunx tsc --noEmit
wc -l <changed-files>
```

## PR

- PR: https://github.com/Soul-Brews-Studio/arra-oracle-v3/pull/NNNN
- Base: `alpha`
- Commit: `abcdef12`
- UI screenshot: not applicable / link to issue comment
````

## Posting with `gh`

Prefer body files for multi-line comments:

````bash
cat > /tmp/issue-update.md <<'MD'
![status: ready for review](https://img.shields.io/badge/status-ready_for_review-purple)

## Summary

- Added focused docs update.

## Validation

```bash
bunx tsc --noEmit
```
MD

gh issue comment 123 --repo Soul-Brews-Studio/arra-oracle-v3 --body-file /tmp/issue-update.md
````

For UI changes, attach a screenshot to the issue and link it from the `## PR` or
`## Validation` section.
