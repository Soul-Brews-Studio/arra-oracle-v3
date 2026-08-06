# Tasks: #2675 sync arra-oracle-skills-cli with new APIs

Feature source: Soul-Brews-Studio/arra-oracle-v3#2675.
Goal: update arra-oracle-skills-cli so installed skills know current Arra APIs.

## Phase 1: Contract audit

- [ ] T001 [P] [US1] Audit ask endpoint contract in `arra-oracle-skills-cli/src/skills/ask.ts`
- [ ] T002 [P] [US1] Audit `arra mine` CLI contract in `arra-oracle-skills-cli/src/skills/mine.ts`
- [ ] T003 [P] [US1] Audit consolidation governance API in `arra-oracle-skills-cli/src/skills/consolidation.ts`
- [ ] T004 [P] [US1] Audit `asOf` temporal filtering in `arra-oracle-skills-cli/src/skills/search.ts`
- [ ] T005 [P] [US1] Audit installer and version surface in `arra-oracle-skills-cli/package.json`

## Phase 2: Skill updates

- [ ] T006 [P] [US2] Update ask skill request examples in `arra-oracle-skills-cli/src/skills/ask.ts`
- [ ] T007 [P] [US2] Update mine onboarding copy in `arra-oracle-skills-cli/src/skills/mine.ts`
- [ ] T008 [P] [US2] Add consolidation review skill in `arra-oracle-skills-cli/src/skills/consolidation.ts`
- [ ] T009 [P] [US2] Add temporal `asOf` guidance in `arra-oracle-skills-cli/src/skills/search.ts`
- [ ] T010 [US2] Regenerate shared skill VFS in `arra-oracle-skills-cli/src/generated/skills-vfs.ts`

## Phase 3: Release verification

- [ ] T011 [P] [US3] Add ask skill regression tests in `arra-oracle-skills-cli/tests/ask.test.ts`
- [ ] T012 [P] [US3] Add consolidation skill tests in `arra-oracle-skills-cli/tests/consolidation.test.ts`
- [ ] T013 [P] [US3] Add temporal search tests in `arra-oracle-skills-cli/tests/search-asof.test.ts`
- [ ] T014 [US3] Bump installer changelog in `arra-oracle-skills-cli/CHANGELOG.md`
