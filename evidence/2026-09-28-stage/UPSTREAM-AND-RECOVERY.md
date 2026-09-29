# Upstream comparison and recovery evidence

## Official-code-first audit, 2026-09-28

Live `git ls-remote origin` returned default HEAD and alpha at `aaedb8d66d2afd25e6a0326bc76dc8bd29da2e79`; main is the older `77e175293c4a0289b182e2aae0cafe9ded119f39` (June 14). Fetch did not change the deployment branch or runtime.

Compared the official source against the deployment branch: authenticated OpenAPI forwarding, optional federation mounting, bundled Simple Mode HTML, and request-owned vector search/export connections are not merged into alpha. Open PR inventory contains #3056 (SQLite extension bootstrap), #3031/#3029 (FTS ranking), #3023 (MCP session catalogue), and our #3065. These are not evidence of merged fixes; no unreviewed PR was deployed.

Retain official alpha as the base and existing official feature implementations. Private provider routing, network restrictions, curated ingestion and backup wiring remain deployment-specific. Keep demonstrated compatibility fixes narrow; do not describe them as upstream-accepted.

## Hybrid connection repair

Production reproduced `warning: Vector search error: sqlite-vec not connected` after vector-only search. Search/export routes closed factory-cached connections. Commit `d4d14f0d` switches only those request-owned routes to uncached factory instances and reports failed hybrid vector legs truthfully.

Regression RED then GREEN; focused tests 12/12; complete HTTP vector suite rerun 104/104; typecheck passed. An earlier full run had one timing-sensitive provider-config failure, which passed individually and on full rerun.

Mint disk reached 100%. Inspected Docker images and cache descriptions: Arra builds only. Exact-ID pruning reclaimed nothing; Docker dangling build-cache prune reclaimed 6.881 GB. No data volumes, runtime images, models or backups removed. Cache is rebuildable. About 2 GiB free remains: disk headroom is still limited.

Repair image built against verified `private-8cde020a` using the committed bounded-space Dockerfile. New runtime image `arra-oracle-v3:private-e7068182`, ID `sha256:066e9f31da9707908fb04244fb30067b9468256382deea479b7f3ba6e5176c8f`.

Staging and production both passed sequential hybrid → vector-only → hybrid calls, returning respectively 20, 3, 20 vector-contributing hits with no warnings. Production cited backup-policy answer also returned LLM mode, evidence and three citations before the repair; no-evidence behavior was previously proven in staging.

## Encrypted vector recovery, 12:35 UTC onward

Application-consistent `arra-vector-20260928T1235Z.age` includes 848 database records, all 848 vectors, 94 curated source files, vector config, private/embedding Compose files and a secret-free environment example. Runtime credentials and recovery identity excluded.

Mint and Mac archive SHA-256 both `57a2776853923567103e5af6a67fed5334e2fb74c9c9ab9bdc960f2ed233847a`. Mac decryption and every archive checksum passed through the existing restore script. The decrypted Mac copy was transferred back through strict SSH into a new isolated Mint restore directory; checksum verification passed there again.

Started `arra-vector-restore-20260928` from the exact production image on loopback port 49778, with only restored data mounted. Workers, watcher and LLM calls disabled; production database not mounted. Existing local Ollama provides embeddings.

Live recovery results: healthy, FTS 848/848, vectors 848/848, zero pending, hybrid retrieval with ten vector-contributing hits; Simple Mode HTML 200; Studio HTML 200; valid MCP initialize response 200. This proves restored application boot and retrieval, not merely archive extraction.

Post-restart recovery check passed: hybrid search 200, vectorAvailable true, three vector-contributing hits, no warning. Disposable recovery and staging containers stopped afterward; their data retained.

Pending: normal encrypted backup scheduling/off-host maintenance, final device-local gates, Git push/review and completion-automation removal only after all gates pass.

## Follow-up execution, September 28 evening UTC

Normal encrypted scheduling is now installed and executed: Mint `arra-backup.service`
returned `Result=success`, producing `arra-private-20260928T132953Z.age` and its
checksum receipt. The daily timer remains active. Mac's hourly/login LaunchAgent
completed with exit 0 and verified that receipt in `~/.codex/arra-backups`.
The initial Documents destination hit macOS privacy denial; no privacy setting was
changed. The identity remains outside the archive destination. The next wrapper
revision derives source identity from the running image label rather than a constant;
install that revision only after the labelled candidate reaches production.

Native Mac MCP exposed two gaps: session-owned vector stores were not opened on
initialization, and long asks outlived Bun's default ten-second idle timeout.
Commit `67365f43` adds the missing connection and a bounded private-listener timeout.
Focused regressions passed; combined MCP/private tests passed 176/176 and typecheck
passed before building. September 28 evening rerun: three focused tests, 11 assertions,
all passed. Mint Hermes session `20260929_011912_274ede` reported the same pre-fix
default-search FTS fallback and successful read; this is not a post-fix success claim.

Acer fresh execution at `2026-09-28T18:25:33.604Z`: exact five-tool catalogue,
FTS backup search, and read of `mine_bb5cff6d7e24693a235c5be5__chunk_2` passed.
Runnable `acer-read-probe.cjs` records the check. Its predecessor failed a hard-coded
September 12 document assertion despite successful initialization/catalogue.

Full official multi-stage build of `620dd0ec` completed, including frontend, but
isolated staging rejected unreadable plugin source directories. Root cause: source
archive extraction used umask 077, creating 0700 directories copied into the image.
Stopped the failed stage; production stayed on `private-e7068182`. Re-extracted the
same pinned Git archive using umask 022 (plugin directories now 0755), retaining
protected parent directories and all runtime secret permissions, then rebuilt.
No plugin security check or non-root runtime was bypassed.

## Production verification, 2026-09-29 UTC

Rebuilt source image `private-620dd0ec`, image ID
`sha256:44b760ff585aaf553c4b64a02f61c22b5d227abd96b54ac440ec685662047dc2`,
revision label `620dd0ec8d9c77d5d73ea96ceed5d1f3b33be8c0`.
Staged SDK MCP default hybrid search returned 100 vector matches and successful read.
Initial LLM request returned extractive fallback after 65.754 seconds; diagnostics
isolated Hermes timeout at 60 seconds and Codex HTTP 502. Fresh September 29
staging retry returned `mode=llm`, three citations, noEvidence=false in 28.999 seconds.

Production Compose cutover at 00:48 UTC reused the matching automatic encrypted
backup `arra-private-20260928T203435Z.age`, whose Mac checksum passed. Production
SDK MCP search/read passed; cited LLM answer passed in 25.369 seconds. Actual Mac
native MCP default hybrid search returned 100 vector matches without warning;
native `oracle_ask` returned LLM mode and three citations. Health: FTS 848/848,
vectors 848/848, zero pending, Ollama connected.

Mint Hermes session `20260929_074917_cf2f93` performed search/read with 100 vector
matches and vectorAvailable=true. Exported raw session independently confirmed
`mcp_arra_oracle_search` and `mcp_arra_oracle_read` calls. No device writer delegated.

Installed revision-aware backup wrapper after backing up its predecessor as
`scheduled-backup.sh.pre-image-label-20260929`. Service execution succeeded;
new archive `arra-private-20260929T004944Z.age` SHA-256
`fca5b30c233d0428208ffadf6dc6347bea5fa026ee5c86d65a204054a745ffce`.
Mac pull verified receipts; decryption and every checksum passed. Manifest names
620dd0ec, authorityQuiesced=true, secretIncluded=false. HTTP/adapter env files
remain mode 0600. No blind duplicate of an unchanged image was taken.

The decrypted Mac copy was transferred to a new isolated Mint directory and
booted with the exact production image on loopback 49778, workers/LLM disabled.
Initial manual restore omitted the private plugin-root override and failed closed;
recreated only that disposable container with the original explicit plugin root,
retaining its data. Restored health: 848 records/vectors, no pending. Simple HTML
passed; post-restart SDK MCP hybrid search returned 100 vector matches and no warning.
Authenticated root with `Accept: text/html` returned Studio HTML 200. The earlier
`/studio` JSON-default request was not a valid SPA check. Restore and staging
containers stopped after verification; their data retained.

**Remaining access blocker:** at 00:47 UTC, actual Mint Codex inference failed with
401 `invalid_refresh_token` despite `codex login status` reporting ChatGPT login.
Both local service units are active. Hermes CLI inference separately passed.
Codex fallback requires the user's interactive Mint sign-in; no logout, credential
copying, auth reset, or host-trust weakening performed. Keep completion automation
active and do not count fallback as accepted.

## User re-login verification, 2026-09-29 08:13 UTC

After the user reported completing Mint sign-in, strict-SSH actual Codex inference
no longer returned invalid_refresh_token or HTTP 401. It still returned turn.failed:
the newly authenticated account has reached its usage limit. A second bounded
inference probe confirmed the provider's usage-limit error and suggested retry at
October 13, 2026, 4:01 PM (provider message did not specify timezone).

Authentication repair is verified; inference availability is not. No credentials,
subscription, account, or deployment configuration changed by this verification.
Fallback acceptance remains blocked on available Codex quota; retain completion
automation and the existing functioning Hermes primary.

## Independent gate closeout, 2026-09-29 08:15 UTC

Continued quota-independent checks rather than retrying unavailable inference:

- `bun test tests/deploy/private tests/mcp`: 176 passed, zero failed, 334 assertions.
- `bunx tsc --noEmit` and `git diff --check`: exit 0.
- Production container running/healthy with revision 620dd0ec; normal backup service
  Result=success, ExecMainStatus=0; backup timer active.
- Authenticated health, stats, OpenAPI, federation status, vector stats and hybrid
  search: HTTP 200. Missing and invalid HTTP credentials: 401 in both cases.
- Mac encrypted backup pull: all three available receipts passed checksums.
- Official `maw arra health` through Mac loopback tunnel: ok, embedded vector mode,
  SQLite-vec bge-m3, 848 documents. Existing duplicate plugin-discovery warnings
  were observed; no unrelated plugin tree was modified. Initial JSON-only output
  parser was unsuitable for maw's text output; direct command was rerun.

These checks do not waive the remaining real Codex fallback quota gate.

## User-approved scope acceptance — 2026-09-29

User explicitly accepted the proposed Hermes-only acceptance with Codex deferred.
The original successful-live-Codex-fallback requirement is therefore deferred,
not passed. Existing provider wiring is unchanged; Codex availability remains
unverified while quota-limited. No billing changes or purchases authorized.

Fresh closeout HTTP health: healthy; FTS 848/848, vectors 848/848, zero pending.
Prior execution above records actual Hermes cited answers, native Mac/Mint/Acer
client checks, isolated encrypted recovery, security gates, tests and Git delivery.
Accept the revised scope and remove only finish-private-arra-deployment;
retain normal backup timer, Mac encrypted pull and health monitoring.
