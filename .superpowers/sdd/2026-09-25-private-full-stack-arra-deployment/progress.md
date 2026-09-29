# SDD ledger — plan: docs/superpowers/plans/2026-09-25-private-full-stack-arra-deployment.md

## Pre-flight

- Base: `aaedb8d66d2afd25e6a0326bc76dc8bd29da2e79` (`origin/alpha`).
- Workspace: isolated clone `/Users/poramateake/Documents/arra-oracle/arra-oracle-v3-impl`.
- Branch: `feat/private-full-stack-arra-deployment`.
- Plan approved by user in-session; Astra-light multi-agent QA completed before implementation.
- Interface: adapter → ask/consolidation clients — preserve `{instruction, question, sources}` input and `{answer, citations, noEvidence}` / `SUPERSEDE|NOOP` outputs; test against existing callers.
- Interface: bundle env/manifest → Mint rollout — names and route policy must match repository env loaders before remote changes.
- Interface: backup bundle → restore gate — include DB/vector/source/config manifest and boot the restored service, not file-only verification.
- Ruling: repository AGENTS contract overrides the plan's “push to alpha” wording — use feature branch + PR targeting `alpha`; no direct shared-branch push or self-merge. Cost if wrong: integration waits for review; safety benefit: preserves working trunk.
- Ruling: no OpenAI key is available to this session; implement/test provider plumbing and fail-closed behavior locally, then stop at the explicit key/admin gate rather than inventing credentials. Cost if wrong: production semantic/LLM gate remains pending.
- Ruling: Hermes/Grok is the primary inference provider; Codex is an optional fallback through a local, read-only `codex exec` bridge because the installed CLI exposes non-interactive JSON output but no stable OpenAI-compatible HTTP inference endpoint. Cost if wrong: Codex fallback remains unavailable until its bridge is explicitly enabled and its existing login is valid.

## Tasks

- Task 1: deployment bundle skeleton, manifest, runbook, protected env template.
- Task 2: local LLM adapter (tests first), provider/model allowlist, fail-closed behavior.
- Task 3: worker/plugin/auth safety gates with tests.
- Task 4: encrypted backup/restore and deterministic corpus/health gate scripts.
- Task 5: local build/test/review; then remote Mint staged deployment and evidence if gates permit.
- Task 6: cross-device acceptance evidence, temporary cron cleanup, commit/PR.

## Evidence — 2026-09-25

- Astra-light QA pass 1 and pass 2 completed. Findings were applied before
  claiming readiness: private image/runtime assets, quiesced encrypted backup,
  strict plugin/corpus boundaries, auth negatives, loopback Compose ports, and
  bounded fail-closed adapter behavior.
- Additional hardening: `/mcp` is exempted from the global API-key middleware
  because streamable MCP has its own bearer verifier; private startup now
  requires a loopback `ORACLE_BIND_HOST`; staging has a distinct loopback port
  and named data volume; strict plugin entry symlinks are rejected lexically.
- Restore proof now checks archive commit against the pinned checkout,
  reconstructs allowlisted corpus roots, runs with `env -i`, uses separate
  random HTTP/MCP tokens, verifies authenticated MCP initialize, loopback
  binding, and a restart. Default local proof is explicitly FTS-only; the
  `--require-vector` gate requires a mode-600 OpenAI env and semantic query.
- Final local evidence: full unit suite `672 pass, 0 fail` (186 files), full
  integration `38 pass, 13 skip, 0 fail` (51 tests/6 files), frontend build,
  typecheck, shell syntax, and `git diff --check` passed. Final deployment
  suite passed `52 pass, 0 fail`; corpus manifest/snapshot and Compose staging
  config passed with 90 curated files. Fresh encrypted-backup restore proof
  passed commit/corpus/FTS/source-hash/FTS-content-hash/MCP JSON-RPC/
  loopback/restart checks; semantic restore was not run without a provider key.
- Final Astra-light multi-agent source QA: PASS. It specifically rechecked
  strict JSON-RPC/SSE MCP restore validation, absolute-path corpus rejection,
  source coverage, private auth separation, and loopback-only publication.
- Remote blocker unchanged: Mint Docker/service mutation needs one interactive
  administrator authorization, and semantic/LLM gates need the user to enter
  the OpenAI key locally into the protected file. Final read-only SSH check:
  `poramateake-Macmini`, alpha `aaedb8d6`, DB connected, existing FTS service
  degraded only because vector section is disabled, and non-interactive Docker
  authorization is unavailable. Current unauthenticated API behavior was
  confirmed (`/api/stats` and `/api/search` return 200); `/mcp` remains bearer
  protected. Reviewed commit `5807969b` was copied into isolated Mint staging
  clone `/home/poramateake/Documents/arra-oracle/staging/arra-5807969b`; the
  production alpha checkout/container was not changed.

- Provider revision — 2026-09-25: OpenAI chat inference is not a deployment
  dependency. The private adapter now accepts an ordered provider chain:
  Hermes/Grok (`127.0.0.1:8642`) → local Codex CLI bridge
  (`127.0.0.1:47781`) → fail-closed extractive/NOOP behavior. Hermes and Codex
  credentials are separate mode-600 secrets; Codex uses the existing Mint
  ChatGPT OAuth login through read-only `codex exec`, never Arra/MCP tools.
  FTS-only remains the default for embeddings; semantic vectors still require
  a separately approved embedding provider.
- Fresh provider evidence: `bun test tests/deploy/private` — 18 pass, 0 fail;
  config/provider/manifest targeted suite — 33 pass, 0 fail; Codex bridge
  unittest — 3 pass, 0 fail; `bunx tsc --noEmit`, shell syntax, Python compile,
  and `git diff --check` passed. Full suite — 672 pass, 0 fail; integration —
  38 pass, 13 skip, 0 fail; frontend build passed with only the existing chunk
  size warning.

- Mint provider rollout — 2026-09-25: strict SSH preflight and root-admin path
  completed without changing the original Arra checkout. Hermes env backup was
  created before enabling/adjusting the loopback API; Hermes `/health`,
  `/v1/models`, and a real Grok completion passed. The adapter is configured
  `hermes,codex` with separate mode-600 secrets; no OpenAI chat key is used.
  The Codex bridge service is active on loopback `47781`; `/health` and
  `/v1/models` pass. A live bridge completion returns the sanitized 502
  `codex_bridge_failed` because Mint's existing Codex OAuth refresh is 401
  expired. No logout/re-auth was attempted; manual Codex login on Mint remains
  the only missing provider gate.
- Staging image rollout — 2026-09-25: first Docker build exposed missing
  frontend builder prerequisites, then missing root `src/`/`packages/` inputs;
  commits `cbdd9356` and `9bdcb955` fixed both. The final isolated build
  completed 41/41 steps. Stage ran on 48778/47779 with a separate volume,
  passed Arra health (DB/FTS/MCP/plugins) and adapter Hermes ask, then was
  stopped without removing its volume before production cutover.
- Production cutover — 2026-09-25: latest existing archive
  `arra-mint-20260924T203047Z.tar.gz` was reused because its `oracle.db` and
  `vectors.db` hashes exactly matched the live volume; no blind duplicate
  backup was made. Existing `arra-mint_arra-oracle-data` was preserved. The
  `arra-mint` service now runs the pinned feature image plus adapter; both
  containers are healthy. Arra health reports DB connected, FTS 6/6, plugins
  `arra` and `oracle-dig` healthy, MCP catalog 32, consolidation worker on,
  entity backfill on with `dryRunOnly=true`; vector is deliberately unavailable
  because `ORACLE_EMBEDDER=none` (documented FTS fallback).
- Live acceptance — 2026-09-25: production gate passed auth negatives and
  positives, adapter health, canonical plugin registry, docs, FTS stats, and
  a real `/api/v1/ask` with `mode: llm` plus validated citations/no-evidence.
  MCP initialize, `tools/list` (28 tools), and authenticated `oracle_search`
  call passed. Listeners verified loopback-only on 47778 (Arra), 47779
  (adapter), 47781 (Codex bridge), and 8642 (Hermes). The semantic-vector gate
  remains intentionally pending; FTS-only acceptance is the active safe mode.
- Adapter corrections — 2026-09-25: Hermes citation objects are normalized
  to source indexes, and ask instructions containing “superseded” no longer
  trigger consolidation detection. Targeted adapter suite now passes 12/12;
  Codex fallback unit suite passes 4/4. Acceptance now skips vector checks
  when `ARRA_RUN_SEMANTIC_GATE=0`, matching the documented FTS-only mode, and
  validates required plugins from the health registry.
- Full-suite rerun — 2026-09-25: private deployment suites, typecheck,
  shell syntax, and diff checks passed. The full `bun test --isolate` rerun
  reached an unrelated `maw-plugin` Docker-build failure and then hung in its
  Docker credential/build subprocess; it was interrupted. No deployment test
  failure or lingering test/container process was left behind.

- Fresh continuation — 2026-09-26: hardened the Codex-owned local OpenAI env
  `/Users/poramateake/.codex/secrets/arra-openai.env` from mode 644 to 600.
  Repository model preflight returned HTTP 401, so the credential is invalid or
  expired; no value was printed or transferred. Mint has no Ollama/local
  embedding service. Hermes exposes no embeddings route, and the existing xAI
  OAuth token returned 403 from xAI's embedding/model endpoints. Fresh local
  verification passed `bun run build`, private deploy tests (20/20), safety
  config/plugin/worker/MCP tests (36/36), and `git diff --check`. Semantic
  sqlite-vec mining and vector restore remain blocked on a valid approved
  embedding provider; do not claim full completion until that gate passes.

## Hourly continuation — 2026-09-26T23:27–23:33Z

- Read Notion cross-device checklist `3e26ea5c-9289-8191-ba44-c2f801a6e664` (last edited 22:52Z): five read paths and actual Mac/Acer agent search/read calls were previously evidenced; Acer operator access to Mac and Mint was explicitly authorized and tested at 22:51:27Z. Preserve the distinct restricted bridge key and strict host checking.
- Mac `pgrep` found the existing SSH tunnel only; strict `ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o IdentitiesOnly=yes -i ~/.ssh/id_ed25519 arra-mini` exited 0. Mint `pgrep` showed no active deployment/backup/restore writer. No mutation or deployment overlap occurred this run.
- Mint loopback listeners: Arra `47778`, adapter `47779`, Codex bridge `47781`, Hermes `8642`; `/api/v1/health` reported DB connected, vector down, embedder `none`. MCP `oracle_stats` returned 6 documents, 6 FTS rows, vector degraded; `oracle_search` with `mode=fts` returned expected backup record `mine_bb5cff6d7e24693a235c5be5__chunk_2` from `mine/onboarding-notes/arra-operations.md`. These are not semantic retrieval evidence.
- Direct authenticated loopback chat completion probes at 23:29:50Z: Hermes `grok-4.7` HTTP 200 with expected marker; Codex bridge HTTP 502 with no completion. Probe script exited 0 after reporting both statuses; the Codex inference gate failed. Existing Mint Codex OAuth refresh needs interactive reauthorization; no credential was copied or changed.
- Mint `arra-backup.service` last run 2026-09-27 03:30:16 +07 exited 0 and produced `arra-mint-20260926T203016Z.tar.gz` (62,580 bytes). This is the normal local tar backup, not encrypted off-host application-consistent full-service restore evidence. `sudo -n docker ps` returned “a password is required”; production Docker mutation/restore still needs interactive Mint administrator authorization. Sudo policy unchanged.
- Local `manifest-check.ts` exited 0: 90 curated Markdown files, 522,720 bytes (arra 75, repo 13, mac-setup 2). Generated JSON manifest SHA-256 `e42413c8cafbd93af9d83ddad61c662de774ad4f3bab4cce3714a3e9f6b7af87`; file `/tmp/arra-corpus-20260926T2332Z.json` mode 600. This proves local curation only; Mint corpus import/hashes are still pending.
- Local `bun test tests/deploy/private` passed 20/20; `bunx tsc --noEmit` and `git diff --check` exited 0. No code/config change this run. Remaining gates: valid approved embedding provider and real vector mine/search/restore; interactive Mint Codex login; administrator-assisted quiesced encrypted off-host backup and isolated full-service restore; production curated corpus and suggestion approve/reject audit evidence; final route/UI/client acceptance.
- Subsequent live MCP `oracle_ask({q:"What is the launch date of the imaginary Sapphire Hedgehog reactor ZX-9137?",llm:false,limit:5})` returned `noEvidence=false` with 3 irrelevant citations despite no supporting source. Repeated twice; the FTS OR search admitted common-term matches and ask confidence treated source metadata as relevance. Added a failing HTTP contract regression, then a minimal FTS-only lexical-support gate before synthesis. Targeted ask tests passed 14/14; typecheck and diff check passed. This fix is on the branch only; production no-evidence gate remains failed until reviewed rollout and live retest. Lexical gating is conservative for paraphrases while vectors are disabled.

## Hourly continuation — 2026-09-27T00:28–00:33Z

- Read the current Notion cross-device checklist and Mac/Mint handoffs. Mac process check and strict Mint process check found no active deployment writer; existing Mint Arra, adapter, Hermes, and Codex bridge listeners remained bound to loopback. No service/config mutation occurred.
- Draft PR #3065 remains open with branch head `4578f6ec`; `gh pr checks` exited 0 with GitGuardian passing. No other checks were reported.
- Production no-evidence failure is still unresolved: the patched image has not been reviewed or deployed. Added the exact unrelated-question assertion to `acceptance.sh`, requiring `noEvidence=true` and empty citations before any future cutover passes. `bash -n` and `git diff --check` exited 0; private deployment tests passed 20/20; ask HTTP contract tests passed 7/7. No production acceptance run was claimed.
- Provider/admin prerequisites remain unchanged: approved embedding credentials are absent, Mint Codex OAuth needs interactive reauthorization, and an administrator must authorize Docker for corpus import plus quiesced encrypted off-host backup and isolated full-service restore. No private keys, sudo policy, or service data changed.

## Hourly continuation — 2026-09-27T07:37–07:42Z

- Read automation memory and Notion checklist `3e26ea5c-9289-8191-ba44-c2f801a6e664` (last edit 00:34:32Z). Mac `ps`, Codex task inventory, and strict `ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=8 arra-mini` found no competing deployment writer. Mint SSH exited 0 at 07:38:22Z; Arra/adapter/bridge/Hermes ports 47778/47779/47781/8642 stayed loopback. Normal `arra-backup.service` had `Result=success`, `ExecMainStatus=0`; `sudo -n docker ps` exited 1. No Mint service/config/data mutation.
- `gh pr view 3065 --json ...` exited 0: draft OPEN, mergeable, no review/comments, head `6a3d4b12`; GitGuardian SUCCESS. Reviewed production rollout and live no-evidence retest still pending.
- Mint `/home/poramateake/.local/bin/codex login status` reported `Logged in using ChatGPT`, but actual CLI invocation at 07:39:32Z failed before inference: exit 2, no output file. Mint Codex CLI 0.153.4 help and parser confirmed `--ephemeral` must follow `exec`; current bridge placed it before. Corrected direct read-only CLI invocation at 07:40:22Z parsed, then exited 1 with no output. A second sanitized event-only probe at 07:41:39Z reported: `Your access token could not be refreshed. Please log out and sign in again.` No credential printed or changed. Login status alone was stale; interactive Mint Codex reauthorization remains required.
- Branch fix moves `--ephemeral` after `exec`; regression test failed before fix (`11 not less than 10`), then Python bridge tests passed 4/4. Private deployment tests passed 20/20; repository TypeScript 5.9.3 `./node_modules/.bin/tsc --noEmit` and `git diff --check` passed. Global TypeScript 6 `tsc --noEmit` exited 2 on existing deprecated `baseUrl` option; local pinned compiler passed. No production bridge restart or rollout before review.
