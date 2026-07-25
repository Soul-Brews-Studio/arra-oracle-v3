# Meeting Audio Recorder — Plan (v0.1, scoping only)

Owner persona: Tomás Reyes (`.claude/agents/engineering/meeting-recorder-engineer.md`). This is a
**separate, standalone sub-project** from `projects/meeting-recorder/` (the Zoom
webhook/cloud-recording project) — no shared code, no shared DB, no shared runtime.
Explicit human scope: "เอาแค่อัดเสียงพอ" (just audio recording is enough). No
transcription, no cloud, no platform API integration, no diarization, no AI
processing of any kind. This document is planning only — nothing here is built yet.

## Goal

One person (you, on this Mac) wants to record their own Zoom/Meet/Teams calls,
webinars, or any other audio-bearing session locally, capturing both their own
voice and whatever the other side is saying through the speakers — without
depending on any platform's own recording feature (which may be disabled by the
host, gated behind a paid plan, or simply not trusted to keep a local copy) and
without sending anything to a cloud service. The job is narrow on purpose: press
one shortcut, be in a call, press it again, get an audio file. Nothing else.

## Capture approach

**Decision: ScreenCaptureKit for system audio, `AVAudioEngine` for microphone —
not BlackHole or another virtual-loopback driver.**

Reasoning:

- Apple added system-audio capture to `ScreenCaptureKit` in macOS 13 (`SCStream`
  with an audio-only or audio+video `SCStreamConfiguration`), specifically so apps
  no longer need a virtual audio device to hear "what the speakers are playing."
  This machine runs macOS 26.3, far past that floor.
- The BlackHole-style approach (install a virtual audio driver, set it as the
  system output, route real output through it via Multi-Output Device or
  Loopback Audio) works on any macOS version but has real costs this project
  doesn't need to pay: a third-party kernel/audio-driver install outside Apple's
  sanctioned capture API, a manual Audio MIDI Setup configuration step the human
  has to redo if it ever breaks, and a permanent side effect on the whole
  machine's audio routing (every app's output goes through the virtual device,
  not just the one being recorded) that persists even when this tool isn't
  running.
- ScreenCaptureKit's audio capture requires no system-wide audio routing change
  at all — it taps the audio mix directly via a first-party API, gated by the
  Screen Recording TCC permission (a one-time grant), and only while the
  recorder process is actually running. Nothing changes for any other app.
- Trade-off acknowledged: ScreenCaptureKit's audio-only capture path still
  requires setting up an `SCStream` against a `SCContentFilter` (display or
  running-app scoped) even when no video frames are needed — video frames just
  get discarded (or captured at minimal size) to keep CPU/memory low. This is a
  minor implementation quirk, not a reason to avoid the framework.
- Mic capture is unrelated to system audio and uses the standard, boring path:
  `AVAudioEngine` tapping the default input node (or a specific `AVCaptureDevice`
  if the human wants to pick a mic explicitly later). No decision drama here.

**Resolved: no own-audio exclusion needed.** `SCStream` supports excluding
specific apps' audio from what it captures, which would matter if this tool
made any sound of its own. It doesn't — it's a silent background CLI process
with no start/stop chime, no notification sound, nothing to exclude. This is
"not applicable" rather than "deferred." If a future version adds any audio
feedback (a chime on start/stop, say), that chime's app would need adding to
the `SCContentFilter` exclusion list at that time — flagging so it isn't
forgotten, not because it's relevant today.

## Output: format, file structure, naming

**Decision: two independent WAV files per session (`mic.wav`, `system.wav`),
plus an auto-generated two-channel `combined.wav` produced by shelling out to
`ffmpeg` at stop time — not a single file mixed/summed in real time inside the
Swift capture process.**

Reasoning:

- Mic capture (`AVAudioEngine`) and system-audio capture (`SCStream`) are two
  independent producers with their own callback cadence, buffer sizes, and
  (potentially) sample rates. Writing each straight to its own file the moment
  a buffer arrives is the simplest possible correct implementation — no
  resampling, no shared ring buffer, no risk of one source blocking or
  corrupting the other if it hiccups.
- Real-time mixing (summing both signals into one mono/stereo stream as audio
  arrives) is exactly the kind of "generalize before the first useful version
  exists" work the human explicitly doesn't want yet. It also risks clipping
  when both sides talk at once, which two separate files never do.
- A single convenience file is still produced, just as a **post-processing
  step**, not a real-time one: when the session stops, run one `ffmpeg` command
  that channel-merges (not sums) the two files into a 2-channel `combined.wav`
  — mic on the left channel, system audio on the right channel. Both sides stay
  distinctly audible (no clipping from summing), and the human still gets "one
  file" to share or play back, satisfying the practical goal without building
  synchronization logic into the capture path itself.
- `ffmpeg` is already installed on this machine (`/opt/homebrew/bin/ffmpeg`), so
  this adds no new dependency to actually set up.

**Resolved: confirmed worth doing.** `combined.wav` stays in the plan exactly
as designed above — generated *alongside* `mic.wav` and `system.wav`, never
instead of them. The two raw tracks remain on disk so nothing is lost if the
merge step itself ever fails or needs re-running with different options.

Location and naming:

- `~/Documents/MeetingRecordings/<YYYY-MM-DD_HHMMSS>/` — one timestamped folder
  per recording session, created when the recording starts.
- Inside: `mic.wav`, `system.wav`, `combined.wav`.
- No metadata DB, no ACL, no retention job — this is single-user, local-only,
  and the entire "storage layer" is just files in a folder. (Contrast with
  `projects/meeting-recorder/`'s storage component, which is a deliberately
  different, heavier tool for a different job.)

## Control mechanism

**Decision: reuse the `toggle.sh` + Automator Quick Action + global keyboard
shortcut pattern from `projects/voice-to-terminal/`**, since it's already proven
working on this exact machine (same PID-file toggle logic, same "no visible
console when launched via Services menu, so log to a file" lesson already
learned there).

- A small Swift command-line binary (e.g. `record-meeting`) does the actual
  capture: opens the `SCStream` for system audio, starts the `AVAudioEngine`
  tap for mic input, writes both to `AVAudioFile`s under the session folder,
  and on `SIGTERM` closes both files cleanly.
- `toggle.sh` (bash, same shape as the voice-to-terminal one) does process
  management only: is a recording already running (PID file)? If not, create
  the timestamped folder and launch `record-meeting` in the background. If so,
  `SIGTERM` it, wait for a clean exit, then run the one `ffmpeg` merge command
  to produce `combined.wav`.
- Bound to a global keyboard shortcut via the same Automator Quick Action +
  System Settings > Keyboard Shortcuts > Services approach already documented
  in `projects/voice-to-terminal/README.md`.

Language/runtime call: **Swift** for the capture binary, not Bun/Node/Python.
`ScreenCaptureKit` and `AVAudioEngine` are first-party Apple frameworks with
no official binding for any other runtime on this machine; trying to drive them
from Bun would mean writing this same Swift/Obj-C bridge code anyway, just
behind an FFI layer, for no benefit. This matches the open question already
flagged in `projects/meeting-recorder/PLAN.md` (native helper + shell/Bun
orchestrator) — this project just resolves it directly since it has no other
runtime requirement to reconcile with.

## Disk space safety

**New requirement (resolved): a real disk-space-full warning, not silent
failure or a corrupted file discovered after the fact.**

Lives in the Swift `record-meeting` binary itself, not `toggle.sh` — it
already owns the write loop and the file handles, so it's the only place that
can react to low space *before* a write fails, and the only place that can
close files cleanly instead of leaving a truncated one. `toggle.sh` stays pure
process management and just surfaces whatever `record-meeting` logs.

- **At start**: check available space on the target volume (e.g.
  `URLResourceValues`'s `volumeAvailableCapacityForImportantUsageKey`, or
  `statfs`). Refuse to start below **2 GB** free — print an error to the log
  and exit non-zero rather than begin a recording that's likely to run out
  mid-call. 2 GB is generous headroom over an hour-plus of dual 16-bit/48kHz
  WAV (roughly 350 MB/hour per track, ~700 MB/hour for both), while still
  being a threshold a human can act on (free up space) before it matters.
- **During recording**: re-check on a timer (every ~15s, piggybacked on the
  same dispatch loop already running for buffer writes — no extra thread).
  - Below **1 GB** free (soft threshold): log a `WARN` line to the same log
    file `toggle.sh` already tees output to, and keep recording. This is the
    "warn" the human asked for — visible in the log without interrupting the
    call.
  - Below **200 MB** free (hard threshold): stop gracefully — finish the
    current buffer write, close both `AVAudioFile`s cleanly (so `mic.wav` and
    `system.wav` are valid, playable files up to that point, not truncated
    mid-frame), log why, then exit. `toggle.sh`'s stop path still runs the
    `ffmpeg` merge afterward on whatever partial audio exists.
- Both behaviors from the human's question apply: a log warning at the soft
  threshold, and an actual graceful stop-with-intact-files at the hard
  threshold — not one or the other.

## Auto-detect meeting apps

**New requirement: auto-start recording when a meeting app is detected
running, instead of manual-only start/stop.**

**Decision: V1.1, not V1.** The mechanism splits into two very different
reliability tiers, and only one of them is simple enough to belong in a "just
recording" first version:

- **Native apps (Zoom.app, Microsoft Teams.app)**: detectable cheaply and
  reliably via `NSWorkspace`'s `didLaunchApplicationNotification`/
  `didTerminateApplicationNotification` (event-driven, no polling loop) or a
  one-time bundle-ID check against `NSWorkspace.shared.runningApplications`.
  This part alone would be a small, low-risk addition.
- **Browser-based Meet (and browser-based Teams/Zoom-in-tab)**: has no
  process to watch — it's a tab in whatever browser the human uses. The only
  way to detect it is Accessibility-API window/tab-title inspection (its own
  TCC permission prompt) or per-browser AppleScript querying open tab URLs/
  titles, which breaks across browser updates, doesn't generalize past the
  browsers explicitly supported, and is exactly the kind of "different code
  path per platform" complexity this project has otherwise avoided.
- Shipping auto-detect that reliably covers native apps but silently misses
  Meet-in-browser would be worse than no auto-detect at all — a human relying
  on it would only discover the gap when a Meet call goes unrecorded, which
  undermines the whole point ("capture both sides, reliably"). Given the
  human's stated priority is "just recording, simply," V1 keeps manual
  start/stop (zero false-negative risk, already proven via the
  voice-to-terminal shortcut pattern), and V1.1 adds native-app detection
  (Zoom.app/Teams.app via `NSWorkspace` notifications) as the achievable
  slice. Browser-based detection is a separate, harder problem to size and
  decide on later — possibly never, if manual-start-for-browser-tabs turns
  out to be an acceptable permanent gap once native-app auto-start covers the
  common case.

## Explicitly out of scope

- Transcription (no Whisper, no ASR, no VTT parsing).
- Cloud upload or any network call at all.
- Zoom / Meet / Teams API integration of any kind (no webhook, no bot-join, no
  SDK) — this tool doesn't know or care what app is making sound.
- Speaker diarization.
- Multi-user / team features, access control, retention policy engine (it's one
  person's local files, in a folder they already own).
- A GUI. A menu-bar icon is a plausible V2 nicety, not V1.
- Auto-detecting "you're in a meeting" — resolved as **V1.1, not V1**; see the
  "Auto-detect meeting apps" section above for the mechanism and reasoning.

## First milestone ("done" for the smallest useful version)

**Resolved: first-run permission prompts are acceptable UX, no workaround
needed.** The very first invocation will trigger a microphone permission
dialog and a Screen Recording permission dialog, in whichever order macOS
presents them. Screen Recording has a known macOS quirk — the app sometimes
needs one relaunch after that permission is first granted before capture
actually starts working. This is expected, one-time setup friction, not a
bug to route around: document it plainly (e.g. in the tool's first-run output
and in a README setup section once built) so the human isn't surprised by it,
rather than building anything to smooth it over.

Run `./toggle.sh` once (or trigger the bound keyboard shortcut) before or during
a real Zoom/Meet/Teams call — or just play some audio through the speakers
while talking, no real call needed to test it. Run it again (or the shortcut
again) to stop. End up with
`~/Documents/MeetingRecordings/<timestamp>/{mic.wav,system.wav,combined.wav}`
where a human, listening to `combined.wav`, can clearly hear both their own
voice and the other side's audio, reasonably in sync (no multi-second drift
over a few minutes — sample-accurate sync is not a requirement). No
transcription, no UI beyond the shortcut and the resulting files in Finder.

## Open questions needing a human decision

No open questions remain from the original planning pass. `combined.wav`
(kept, alongside the raw tracks), permission-prompt UX (accepted as-is),
disk-space handling (see "Disk space safety" above), own-output exclusion
(not applicable — see Capture approach), and auto-detect scope (V1.1, see
"Auto-detect meeting apps" above) were all resolved this round.

Still genuinely open: file retention *duration* (as opposed to the
disk-space-full guard, which is now designed) — recordings still accumulate
in `~/Documents/MeetingRecordings/` indefinitely with no auto-delete.
