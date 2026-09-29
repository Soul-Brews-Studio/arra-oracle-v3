# Private Arra file corpus

Mint owns this separate corpus. The curated Arra database and its clients are
untouched. Mac writes deployment/configuration; Mac, Mint and Acer collectors
run as their existing users and send only screened extracted payloads.

## Layout

- Mint database/state: `~/.local/state/arra-files/` (mode `0700`)
- Mint HTTP/MCP read surface: loopback `127.0.0.1:47782`
- Mint receiver: forced SSH keys, device namespaces `mac` and `acer`
- Mac state: `~/.codex/arra-files-state/`
- Acer state: `%LOCALAPPDATA%\arra-files-state\`
- Separate age backups: Mint `~/.local/state/arra-files/backups/`, copied to
  Mac `~/.codex/arra-files-backups/`

The receiver accepts only framed `begin/chunk/commit` JSON over forced SSH.
Keys have no shell, PTY, forwarding, or arbitrary destination. Host checking is
always strict. Never reuse the Acer Arra MCP key for collection.

## Read surfaces

With the private bearer token (never put it in a URL or log):

```text
GET /status
GET /dashboard?q=term
GET /search?q=term&mode=keyword|semantic&limit=5
GET /read?id=<document-id>&offset=0&limit=16000
```

Search is bounded to 20 results and 500-character previews. Reads require a
document ID and return provenance plus a pagination offset. MCP exposes only
`arra_files_search`, `arra_files_read`, and `arra_files_status`.

## Schedules and rollback

- Mint: `arra-files-scan.timer`, `arra-files-ingest.timer`, and
  `arra-files-embed.timer` (hourly). Ingestion advances at most 100 records per
  run and resets safely when a newer snapshot replaces the checkpoint.
- Mac: `com.poramateake.arra-files-scan` LaunchAgent (hourly/startup)
- Acer: user task `ArraFilesScan` (hourly/interactive)

To roll back, stop only these collectors, timers, and `arra-files.service`.
Keep the private state for recovery; do not delete source files or alter the
curated service. Restore an age archive only into a new, non-existing target:

```sh
ARRA_FILES_AGE_IDENTITY=/path/to/recovery.agekey \
  sh restore-files.sh backup.tar.age /path/to/new-isolated-target
```

## Capacity and coverage

Transport spools are capped at 512 MiB per device. No total corpus cap is
applied. Work pauses before free space falls below Mac 10 GiB, Mint 15 GiB, or
Acer 20 GiB. Cloud placeholders, offline roots, secrets, encrypted files,
unsupported formats and permission gaps remain explicit non-success outcomes.
Only a complete online-root scan may reconcile deletions.

Mint media extraction uses the pinned CPU Whisper-small runtime
(`openai-whisper 20250625`, `torch 2.8.0+cpu`; model SHA-256
`9ecf779972d90ba49c06d968637d720dd632c55bbf19d441fb42bf17a411e794`).
Audio segments retain timestamps; video adds bounded sampled-frame OCR. Clients
without the local model keep media as explicit blocked/metadata-only outcomes.
