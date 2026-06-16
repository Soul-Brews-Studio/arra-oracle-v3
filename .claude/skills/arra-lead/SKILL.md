# /arra-lead

Lead-review cycle for the arra-oracle-v3 codex team (lead = this claude session,
"Boss God Code" + codex-1..12 omx coders in session `140-arra-oracle-v3`).
Run on a cadence: `/loop 5m /arra-lead` — so you don't hand-peek every screen.

## Step 0: Init
```bash
date
```

## Step 1: Peek all coders
```bash
for N in 1 2 3 4 5 6 7 8 9 10 11 12; do
  echo "=== codex-$N ==="
  maw peek 140-arra-oracle-v3:codex-$N 2>&1 | tail -10
done
```
Read each tail: `Working (Nm…)` = busy · `starting`/`standby` = idle/waiting ·
`done <task>` / `blocked:` = needs lead action · bare shell `❯` = engine died →
`maw done arra-oracle-v3-codex-N` then `maw team up arra-oracle-v3-team --only codex-N`.

## Step 2: Review open PRs — merge greens (standing approval)
```bash
gh pr list --repo Soul-Brews-Studio/arra-oracle-v3 --base alpha --state open
```
For each PR: base is `alpha` (NEVER `main`) · mergeable · CI green ·
every file ≤ 250 lines · scope matches the task · no endpoint removed.
**Standing merge approval**: merge all green PRs to alpha immediately via
`gh pr merge N --squash`. Report each merge to chat.

## Step 3: Dispatch idle workers
```bash
gh issue list --repo Soul-Brews-Studio/arra-oracle-v3 --state open
```
For each idle coder (standby) and an unassigned issue/task, dispatch with a
concrete done-criteria via foreground maw hey:
```bash
maw hey 140-arra-oracle-v3:codex-N "TASK: <what> — done: scoped bun test tests/http/<cluster>/ + tsc --noEmit green, files ≤250, commit agents/arra-codex-N, PR --base alpha, never main"
```
NO-GAP: when confirming a coder's done, include its next task in the same message.

## Step 4: Detect stuck
If a coder's peek output is unchanged from last cycle for >10 min (and not `done`/
`standby`) → nudge:
```bash
maw hey 140-arra-oracle-v3:codex-N "stuck? รายงานสถานะ/บล็อกเกอร์ที่ชัดเจนครับ"
```
If still silent next cycle, `maw peek` deeper / consider a clean relaunch.

## Step 5: Report summary
Print a status table to chat: each codex-N (working/standby/done/blocked), open
PRs + review verdict, anything dispatched, anything stuck-nudged.

## Principles
1. Lead orchestrates, codex codes — lead writes only reference modules.
2. Issue → PR → merge greens immediately (standing approval active).
3. Build gate: `tsc --noEmit` + a SCOPED `bun test tests/http/<cluster>/` must pass.
   (Bare `bun test` pulls in agents/ worktree copies — never use it for a verdict.)
4. No file > 250 lines.
5. No force operations; never push/merge to `main` (a hook blocks it).
6. Coders report starting (ACK) + blocked + done — suppress intermediate failures.
7. PR needs a screenshot only if it changes UI.
8. Never contact coders about context usage — they auto-compact fine.
