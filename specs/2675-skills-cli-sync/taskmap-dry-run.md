# taskmap.py dry-run: #2675 skills CLI sync

Command:

```bash
python3 scripts/taskmap.py specs/2675-skills-cli-sync/tasks.md \
  --workers arra-codex-backend,arra-codex-frontend,arra-codex-infra,arra-codex-research,arra-codex-test \
  --session 41-arra-oracle-v3 \
  --done-note "scoped tests green, files <=250, maw hey lead when done"
```

Output:

```text
taskmap: specs/2675-skills-cli-sync/tasks.md
tasks: 14 total, 0 done, 14 pending → 5 wave(s)

wave 1 — Phase 1: Contract audit
  T001 [P] [US1] Audit ask endpoint contract in `arra-oracle-skills-cli/src/skills/ask.ts`  (arra-oracle-skills-cli/src/skills/ask.ts)
  T002 [P] [US1] Audit `arra mine` CLI contract in `arra-oracle-skills-cli/src/skills/mine.ts`  (arra-oracle-skills-cli/src/skills/mine.ts)
  T003 [P] [US1] Audit consolidation governance API in `arra-oracle-skills-cli/src/skills/consolidation.ts`  (arra-oracle-skills-cli/src/skills/consolidation.ts)
  T004 [P] [US1] Audit `asOf` temporal filtering in `arra-oracle-skills-cli/src/skills/search.ts`  (arra-oracle-skills-cli/src/skills/search.ts)
  T005 [P] [US1] Audit installer and version surface in `arra-oracle-skills-cli/package.json`  (arra-oracle-skills-cli/package.json)

wave 2 — Phase 2: Skill updates
  T006 [P] [US2] Update ask skill request examples in `arra-oracle-skills-cli/src/skills/ask.ts`  (arra-oracle-skills-cli/src/skills/ask.ts)
  T007 [P] [US2] Update mine onboarding copy in `arra-oracle-skills-cli/src/skills/mine.ts`  (arra-oracle-skills-cli/src/skills/mine.ts)
  T008 [P] [US2] Add consolidation review skill in `arra-oracle-skills-cli/src/skills/consolidation.ts`  (arra-oracle-skills-cli/src/skills/consolidation.ts)
  T009 [P] [US2] Add temporal `asOf` guidance in `arra-oracle-skills-cli/src/skills/search.ts`  (arra-oracle-skills-cli/src/skills/search.ts)

wave 3 — Phase 2: Skill updates
  T010 [US2] Regenerate shared skill VFS in `arra-oracle-skills-cli/src/generated/skills-vfs.ts`  (arra-oracle-skills-cli/src/generated/skills-vfs.ts)

wave 4 — Phase 3: Release verification
  T011 [P] [US3] Add ask skill regression tests in `arra-oracle-skills-cli/tests/ask.test.ts`  (arra-oracle-skills-cli/tests/ask.test.ts)
  T012 [P] [US3] Add consolidation skill tests in `arra-oracle-skills-cli/tests/consolidation.test.ts`  (arra-oracle-skills-cli/tests/consolidation.test.ts)
  T013 [P] [US3] Add temporal search tests in `arra-oracle-skills-cli/tests/search-asof.test.ts`  (arra-oracle-skills-cli/tests/search-asof.test.ts)

wave 5 — Phase 3: Release verification
  T014 [US3] Bump installer changelog in `arra-oracle-skills-cli/CHANGELOG.md`  (arra-oracle-skills-cli/CHANGELOG.md)

## dispatch — wave 1
maw hey 41-arra-oracle-v3:arra-codex-backend 'T001 Audit ask endpoint contract in `arra-oracle-skills-cli/src/skills/ask.ts` | files: arra-oracle-skills-cli/src/skills/ask.ts | done: scoped tests green, files <=250, maw hey lead when done'
maw hey 41-arra-oracle-v3:arra-codex-frontend 'T002 Audit `arra mine` CLI contract in `arra-oracle-skills-cli/src/skills/mine.ts` | files: arra-oracle-skills-cli/src/skills/mine.ts | done: scoped tests green, files <=250, maw hey lead when done'
maw hey 41-arra-oracle-v3:arra-codex-infra 'T003 Audit consolidation governance API in `arra-oracle-skills-cli/src/skills/consolidation.ts` | files: arra-oracle-skills-cli/src/skills/consolidation.ts | done: scoped tests green, files <=250, maw hey lead when done'
maw hey 41-arra-oracle-v3:arra-codex-research 'T004 Audit `asOf` temporal filtering in `arra-oracle-skills-cli/src/skills/search.ts` | files: arra-oracle-skills-cli/src/skills/search.ts | done: scoped tests green, files <=250, maw hey lead when done'
maw hey 41-arra-oracle-v3:arra-codex-test 'T005 Audit installer and version surface in `arra-oracle-skills-cli/package.json` | files: arra-oracle-skills-cli/package.json | done: scoped tests green, files <=250, maw hey lead when done'
```
