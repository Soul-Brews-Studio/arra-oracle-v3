# Meeting Recorder — Rough Plan (v0.1, scoping only)

Owner persona: Tomás Reyes (`.claude/agents/engineering/meeting-recorder-engineer.md`). This is a
sub-project living under `projects/meeting-recorder/` — self-contained (own
`package.json`, own README) the way `web-shop/` is, not wired into arra-oracle's
server/MCP surface unless a later phase decides it should be.

## Goal

For a team that runs a mix of Zoom/Meet/Teams calls and in-person meetings, give them
one place to end up with a recording + a searchable transcript/notes doc, without
manually starting/stopping a recorder or copy-pasting transcripts out of each
platform's own UI. The job it does: capture audio (however the meeting happens),
turn it into a transcript with speakers attributed, store it somewhere access-
controlled, and retire it on a schedule someone actually decided on.

## V1 scope

**Zoom, cloud-recording webhook export — not bot-join.**

Reason: Zoom's Cloud Recording feature + `recording.completed` webhook is the most
mature, documented, ToS-clean export path of the three platforms, and it needs no
bot actually joining the call as a fake participant. Lowest engineering + policy
risk for a first slice.

Everything else — Meet, Teams, bot-join for any platform, and offline local capture —
is explicitly deferred (see below). Offline capture is likely the V1.1 slice right
after this, since it validates the transcription/diarization/storage pipeline
independent of any platform's API quirks.

## Explicitly out of scope for V1

- Google Meet and Microsoft Teams integration (different auth models — Workspace
  admin consent for Meet's API, Graph app registration + admin consent for Teams —
  each is its own project-sized chunk, not a variant of Zoom's).
- Bot-join capture on any platform (joining as a visible/silent participant to
  capture live audio) — different failure modes (bot kicked, waiting-room stuck,
  detected-and-blocked) from webhook export, deliberately not mixed into V1.
- Offline/local audio capture and diarization — real pipeline, just not first.
- Real-time/streaming transcription — V1 is batch: wait for the recording, then
  transcribe.
- Calendar integration / auto-scheduling of recordings.
- Any UI beyond whatever's needed to inspect a transcript (e.g. a bare list/detail
  page) — no polished frontend in V1.
- Multi-tenant / multi-org support — single Zoom account to start.

## Core components

1. **Capture — online (this repo's Zoom adapter for V1)**
   Registers a Zoom Server-to-Server OAuth app, subscribes to the
   `recording.completed` webhook, and on receipt downloads the recording asset(s)
   (audio/video + Zoom's own VTT transcript if available) via the authenticated
   download URL. No bot, no live connection to the call.

2. **Capture — offline (deferred, but part of the target architecture)**
   Local mic + system-audio capture (platform-specific: macOS ScreenCaptureKit/
   CoreAudio tap vs. something else on Linux/Windows) plus speaker diarization,
   since there's no platform-provided speaker channel separation for an in-person
   room. Treat this as a genuinely separate code path from (1), not a branch of it
   — different triggers (manual start/stop or calendar-linked, not a webhook),
   different failure modes, different privacy surface (a live mic in a room vs. a
   cloud asset you're pulling by API).

3. **Storage**
   Object storage for raw recording files (audio/video) + a metadata DB row per
   meeting (source platform, participants if known, duration, storage path,
   retention-expiry date, access-control list). Keep raw media and transcript text
   in separate stores so retention/deletion of the sensitive raw audio can happen
   independently of keeping (or redacting) the transcript.

4. **Transcription / diarization**
   V1: use Zoom's own generated VTT transcript where available (fast, free, no
   extra pipeline); fall back to an ASR service (e.g. Whisper) when Zoom didn't
   generate one. Diarization from Zoom's cloud recording is generally weak/absent
   for VTT exports — flag this as a known gap, not solved in V1. Human
   review/correction step is a manual TODO, not built.

5. **Retention & access policy (named component, not an afterthought)**
   Every stored recording carries: who can view it (ACL, not "everyone with repo
   access"), a retention-expiry timestamp set at ingest time (not decided later),
   and a deletion job that actually runs on schedule. This needs a policy decision
   before any recording is stored in anything beyond a local dev sandbox — see open
   questions below. No recording should ever be written to storage without these
   fields populated, even in V1.

## Zoom V1 — what its API actually allows (verify before building)

Best current understanding, **not yet verified against live Zoom docs — confirm
before writing code**:

- Zoom **Cloud Recording** (paid plan feature) auto-uploads a meeting's recording to
  Zoom's cloud after the host ends the call, generating audio/video/chat/transcript
  files.
- A **Server-to-Server OAuth app** (Zoom Marketplace) can subscribe to the
  `recording.completed` webhook event, which fires with download URLs (each
  requiring the app's access token) for the recording files, including a `.vtt`
  transcript file when Zoom's auto-transcription was enabled on the account.
  This is the "webhook-based cloud-recording export" path — no bot, no live
  connection.
- Bot-join (a synthetic participant joining via Zoom's meeting SDK to capture raw
  audio/video streams) is a separate, heavier integration (Zoom's SDK/RTMS) with
  its own approval and ToS considerations — deliberately not used for V1.
- Open verification items before implementation starts:
  - Confirm current webhook event name/payload shape and download-URL auth scheme
    (Zoom has changed webhook validation — e.g. a CRC/challenge handshake — before).
  - Confirm whether Cloud Recording + auto-transcription requires a specific Zoom
    plan tier for the target account.
  - Confirm download URL expiry window (how fast the pipeline must fetch a file
    after the webhook fires).

## Key open questions needing a human decision

- **Consent/compliance**: who needs to be told a meeting is being recorded, and how
  (verbal notice, in-meeting banner, pre-meeting policy)? Jurisdiction matters here
  (one-party vs. two-party consent regions) — this blocks offline capture
  especially, since there's no platform-native "recording" notice to lean on.
- **Where do transcripts live** — same storage/DB as this repo's existing
  infra (e.g. reusing Drizzle/SQLite patterns already in `src/db/`), or fully
  separate service/data store given how sensitive meeting content is?
- **Retention duration** — 30/90/365 days? Different by meeting type (1:1 vs.
  all-hands)? Who approves early deletion or legal-hold exceptions?
- **Who gets access by default** — just the meeting host/organizer, all invited
  participants, or a named admin role? Does access need to be revocable per-person
  after the fact?
- **Runtime for the offline-capture agent**: Bun is the repo default, but native
  mic/system-audio capture APIs are OS-specific (Swift/CoreAudio on macOS,
  WASAPI on Windows) — the offline capture binary may need to be a small native
  helper (Swift/Rust) invoked by a Bun-based orchestrator, rather than pure Bun.
  Flagging now so it's not assumed away later; the online/Zoom V1 slice has no such
  constraint (plain Bun HTTP service is fine for webhook + download + ASR calls).

## First milestone ("done" for the very first slice)

A Zoom Server-to-Server OAuth app is registered against one test Zoom account;
ending a real test meeting with Cloud Recording on triggers the
`recording.completed` webhook; the service downloads the audio + VTT transcript (or
falls back to Whisper if no VTT), writes both to object storage + a DB row with
retention-expiry and an ACL field populated (even if the ACL is just "one hardcoded
user" for now), and a human can retrieve and read the transcript for that one
meeting end-to-end. No UI required beyond a CLI command or a single JSON endpoint
to fetch it.
