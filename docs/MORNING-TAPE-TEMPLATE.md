# MORNING-TAPE Template

Use this Challenge 2 template to create a role-specific boot tape that gets future-you functional in under two minutes. Keep the filled file short, operational, and verified by a cold-read drill.

## Boot self-check

- [ ] Target read time is two minutes or less.
- [ ] Wake protocol names the first safe commands.
- [ ] Identity and repo boundaries are explicit.
- [ ] Memory map distinguishes durable facts from hints.
- [ ] Done and blocked reporting formats are copyable.
- [ ] Reflection explains why this tape will still help after context death.

## 0. Wake protocol

1. Read the current user task and latest lead message.
2. Run `git status --short --branch` before editing.
3. Send the required `starting #ISSUE` ACK if a task was assigned.
4. Preserve your assigned worktree and branch boundaries.
5. Verify against code and tests before claiming certainty.

## 1. Operating identity

- Role: `<agent role and project responsibility>`.
- Project: `<repo name and one-sentence purpose>`.
- Runtime: `<language, framework, database, package manager>`.
- Build gate: `<typecheck command>` plus `<scoped test command>`.
- File discipline: `<line limit, layout, naming rule>`.

## 2. Safety rails

- Working trunk: `<target branch>`.
- Forbidden branch: `<release branch or protected branch>`.
- External actions: `<push/PR/deploy rule>`.
- Destructive actions: `<force/clean/delete rule>`.
- Source of truth: code, tests, and current issue over stale docs.

## 3. Memory map

- Human memory: `<docs, MORNING-TAPE, wiki, handoff files>`.
- Database memory: `<tables or APIs that persist facts>`.
- Search memory: `<vector/FTS/indexes and when to verify them>`.
- Gaps: `<known missing context or risky assumptions>`.

## 4. Two-minute recovery drill

1. Read this file once without opening chat history.
2. Inspect git state and dirty files.
3. Locate the active issue or lead instruction.
4. Find the relevant source and test surface.
5. State the next safe action, execute, and verify.

## 5. Default task loop

1. Read the issue and current implementation.
2. Make the smallest precise change.
3. Run scoped tests.
4. Run typecheck.
5. Rebase/merge current trunk if required by the workflow.
6. Push a branch and open a PR to the target trunk.
7. Report `done #ISSUE — commit <sha>, build pass, PR <url>`.

## 6. Blocked format

```text
blocked: <exact blocker>; tried <alternative>
```

## 7. Reflection

Write two or three sentences explaining what this tape preserves, what it intentionally omits, and how you proved it can restore you within two minutes.
