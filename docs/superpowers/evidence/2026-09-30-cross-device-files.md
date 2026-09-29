# Cross-device file corpus deployment evidence

Date: 2026-09-30 (Asia/Bangkok)
Branch: `feat/private-full-stack-arra-deployment`

## Gate matrix

| Gate | Result | Evidence |
| --- | --- | --- |
| Strict collector transport | PASS | Mac and Acer real-file pilots; forced-command receiver; host verification remained strict |
| Receiver integrity | PASS | Framed size, sequence, per-chunk checksum, object hash, device namespace, and no-shell tests |
| Isolated worker | PASS | `arra-files-worker:20260930`; UID 1000; read-only runtime/source; network probe unreachable; OCR/Office/PDF tools present |
| Mint corpus separation | PASS | Separate SQLite/FTS/vector state and loopback-only authenticated HTTP/MCP |
| Semantic retrieval | PASS | Ollama `bge-m3`, 1024 dimensions; bounded semantic MCP result set |
| Read-only client surface | PASS | Exactly `arra_files_search`, `arra_files_read`, `arra_files_status`; arbitrary write/admin calls denied |
| Native schedules | PASS | Mint scan/ingest/embed timers, Mac LaunchAgent, Acer user task; latest Mac/Acer task exits 0 |
| Backup/recovery | PASS | Age archive checksum verified; isolated restore reproduced files/vectors/FTS and known project paths |
| Lifecycle safety | PASS | Changed content removes stale vectors; complete-scan-only deletion reconciliation; resumable snapshot checkpoints |
| Local media path | PARTIAL | Mint and Mac CPU Whisper-small transcript pilots passed; Acer model install is pending while the device is offline, so its media remains explicit blocked/metadata-only |
| Full coverage | PARTIAL | Mint online-root scan is complete (487,296 discovered); Mac and Acer retain explicit cloud/unreadable/separate-root gaps; hourly ingestion advances bounded batches |

## Verification commands

- `python3 -m unittest discover -s tests/deploy/private -p 'test_file_*.py'`: 33 passed.
- `bun test tests/deploy/private`: 31 passed.
- `bunx tsc --noEmit`: passed.
- `git diff --check`: passed.
- Manifest secret scan: clean after replacing secret-like fixture literals with
  generated synthetic data.

## Explicit gaps

Mint's online-root snapshot is complete, but cross-device coverage is not claimed
complete while Mac cloud/unreadable roots and Acer C:/D: gaps remain. Acer's
logical G: volume is absent from verified partitions and remains unverified.
Codex fallback, public hosting, and a separate swarm runtime remain deferred by
approved scope.
