# meeting-audio-recorder

Offline, local-only audio recorder for your own Zoom/Meet/Teams calls (or any
audio-bearing session): press a keyboard shortcut, be in a call, press it
again, get WAV files on disk. No cloud, no transcription, no platform API
integration, no BlackHole/virtual-audio-driver. See `PLAN.md` for the full
design reasoning -- this README only covers building, running, and binding it.

This is a **separate, standalone sub-project** from `projects/meeting-recorder/`
(the Zoom webhook/cloud-recording project elsewhere in this repo) -- no shared
code, no shared runtime. It reuses the *shape* of
`projects/voice-to-terminal/`'s `toggle.sh` (PID-file toggle, launch inside
Terminal.app so the process inherits Terminal's already-granted TCC
permissions, log to a file since there's no visible console when triggered
via the Services menu) -- read that project's `toggle.sh`/README for the
fuller "why", not repeated here.

## What's here

- `Package.swift` + `Sources/record-meeting/` -- a Swift Package (no Xcode
  project) building a single CLI binary, `record-meeting`. Swift only
  (`ScreenCaptureKit` + `AVAudioEngine`, first-party Apple frameworks); no
  Bun/Node/Python anywhere in this sub-project.
  - `main.swift` -- CLI entry point, signal handling, run loop.
  - `MeetingRecorder.swift` -- orchestrates one session: starts/stops mic +
    system-audio capture together, wires the disk-space hard-stop.
  - `MicRecorder.swift` -- microphone capture via `AVAudioEngine`, writes
    `mic.wav`; also owns the periodic disk-space poll (piggybacked on its own
    tap callback, no extra thread/timer -- see PLAN.md "Disk space safety").
  - `SystemAudioRecorder.swift` -- system-audio capture via `ScreenCaptureKit`
    (`SCStream`, audio-only), writes `system.wav`.
  - `DiskSpace.swift` -- free-space thresholds/checks.
  - `Log.swift` -- minimal timestamped stdout/stderr logger.
- `toggle.sh` -- starts a new recording session if none is running, or stops
  the current one (SIGTERM, wait, then runs the `ffmpeg` merge into
  `combined.wav`) if one is. Meant to be bound to a global keyboard shortcut
  (see "Global keyboard shortcut" below), but works fine run directly too.
- `PLAN.md` / `PLAN.th.md` / `flow-design.html` -- the design doc this was
  built from (English, Thai, and a visual flow diagram).

## Build

```bash
cd projects/meeting-audio-recorder
swift build -c release
```

Produces `.build/release/record-meeting`. `toggle.sh` prefers the release
build if present, falling back to `.build/debug/record-meeting` (plain
`swift build`) so it also works straight out of a fresh checkout without
requiring `-c release` first. Requires macOS 13+ (this machine runs macOS
26.3) and `ffmpeg` at `/opt/homebrew/bin/ffmpeg` (already installed via
Homebrew on this machine; `toggle.sh`'s merge step degrades gracefully -- it
skips `combined.wav` with a warning, leaving `mic.wav`/`system.wav` intact --
if `ffmpeg` isn't found there).

## Run

```bash
./toggle.sh    # not running -> opens a new Terminal window recording
./toggle.sh    # running -> stops it, merges combined.wav
```

Output lands at:

```
~/Documents/MeetingRecordings/<YYYY-MM-DD_HHMMSS>/
  mic.wav       -- your microphone
  system.wav    -- whatever's playing through the speakers (the other side of the call)
  combined.wav  -- 2-channel merge, mic on the left, system audio on the right
                   (produced by toggle.sh's ffmpeg step at stop time, not
                   real-time-mixed -- see PLAN.md "Output" section)
```

`toggle.sh` doesn't auto-close the Terminal window it opened when you stop
the tool (same deliberate trade-off as `voice-to-terminal` -- reliably
matching "which window is this" from the outside is fragile; the window just
goes back to a shell prompt).

### First-run permission flow (read this before your first real call)

The very first time `record-meeting` actually runs, macOS will prompt for:

1. **Microphone access** -- for whichever app is the "responsible process" for
   the running binary. Since `toggle.sh` launches `record-meeting` inside a
   `Terminal.app` window (see "What's here" above), this permission is
   granted to **Terminal.app**, not to `record-meeting` itself -- check
   System Settings > Privacy & Security > Microphone > Terminal if you don't
   see the prompt.
2. **Screen Recording access** -- required for `ScreenCaptureKit`'s
   audio-only capture path even though no video is ever written to disk (see
   PLAN.md's "trade-off acknowledged" note on this ScreenCaptureKit quirk).
   Same responsible-process story: grant it to **Terminal.app** under System
   Settings > Privacy & Security > Screen Recording.

**Known macOS quirk, observed directly in this repo's own testing**: even
after granting Screen Recording permission, the *first* recording attempt can
still fail with:

```
Error Domain=com.apple.ScreenCaptureKit.SCStreamErrorDomain Code=-3801
"The user declined TCCs for application, window, display capture"
```

If you hit this right after granting the permission (not before), **quit and
relaunch Terminal.app once**, then try `./toggle.sh` again. This is expected,
one-time setup friction -- not a bug in this tool, and not something worth
building a workaround for (per PLAN.md's "First milestone" section, which
explicitly accepts this UX rather than routing around it).

If a session fails to start (disk space refusal, declined permission, etc.),
`toggle.sh` prints a warning after ~10s and no `mic.wav`/`system.wav` folder
is left with a stray running process -- check the newly-opened Terminal
window (or `toggle.log`, see below) for the actual error line from
`record-meeting`.

### Disk space safety

Per PLAN.md, this lives in `record-meeting` itself, not `toggle.sh`:

- **Refuses to start** below 2 GB free on the volume containing
  `~/Documents/MeetingRecordings/` (logs an error, exits non-zero, no
  `mic.wav`/`system.wav` are ever created for that attempt).
- **Logs a WARN** every ~15s once free space drops below 1 GB, while
  continuing to record (piggybacked on the mic capture's own tap callback --
  see `MicRecorder.swift` -- not a dedicated timer thread).
- **Stops gracefully** (closes both WAV files cleanly, so they stay valid,
  playable files up to that point) if free space drops below 200 MB.

### Logs

- `toggle.log` (next to `toggle.sh`, gitignored) -- every `toggle.sh`
  invocation: start/stop decisions, osascript errors, the `ffmpeg` merge
  outcome. This is the only place to see a failure if triggered via the
  Services menu, since Terminal's default profile can close a tab the moment
  a `do script` command exits, before you can read anything on screen.
  `record-meeting`'s own stdout/stderr is also captured here when launched
  through `toggle.sh`, since it inherits the same Terminal tab.

## Global keyboard shortcut (one-time manual setup)

Mirrors `projects/voice-to-terminal/README.md`'s approach exactly -- macOS
does not allow assigning a keyboard shortcut from a script or CLI, so this
part is unavoidably manual, once:

1. Create an Automator Quick Action (`Automator.app` > New Document > Quick
   Action):
   - "Workflow receives no input" in any application.
   - Add a **"Run Shell Script"** action, shell `/bin/bash`, pass input "as
     arguments", with:
     ```bash
     /absolute/path/to/projects/meeting-audio-recorder/toggle.sh
     ```
     (Use the absolute path to this checkout, or -- if you hit the same
     `~/Documents` TCC restriction `voice-to-terminal` documents, where the
     Automator/Services runner process can't execute a script living under a
     TCC-protected folder even though a plain Terminal shell can -- deploy
     `toggle.sh` and the built binary to a location outside `~/Documents`
     first, e.g. `~/.meeting-audio-recorder/`, the same fix that project's
     `install.sh` applies, and point this Quick Action at the deployed copy
     instead.)
   - Save as e.g. `Toggle Meeting Recorder.workflow` -- Automator installs it
     to `~/Library/Services/` automatically.
2. Open **System Settings > Keyboard > Keyboard Shortcuts... > Services**.
3. Scroll to the **General** section, find **"Toggle Meeting Recorder"**. (If
   it isn't listed, log out/in once, or re-save the workflow in Automator to
   force macOS to re-scan `~/Library/Services/`.)
4. Click the empty space to the right of its name and press your desired key
   combination.
5. Close System Settings. The shortcut is now global -- press it from any
   app (e.g. right before joining a call) to start, press it again to stop.

**Not verified end-to-end in this environment**: binding the actual keyboard
shortcut and triggering it via the Services menu requires interactive System
Settings access this session doesn't have. What *was* verified here: running
`./toggle.sh` directly, which drives `record-meeting` through the exact same
`osascript ... tell application "Terminal" ... do script` path the Quick
Action would use (see "How this was verified" below) -- so the mechanism the
Quick Action depends on is confirmed working, just not the final shortcut
binding step itself.

## How this was verified

This machine has a real, logged-in GUI session (confirmed via
`osascript -e 'tell application "System Events" to get name of every process'`
and `zoom.us` actually running), so more could be exercised directly than a
typical headless CI environment:

- **`swift build` / `swift build -c release`**: both succeed cleanly, no
  warnings, no errors.
- **Mic capture**: verified directly by running the built binary
  (`.build/release/record-meeting <dir> <pidfile>`) for several seconds --
  produced a real `mic.wav` (1ch, 48kHz, Float32) with actual PCM data, closed
  with a correct WAV header (`afinfo` reported a real duration, not 0) after a
  clean `SIGTERM`.
- **System audio capture**: verified the same way -- produced a real
  `system.wav` (2ch, 48kHz, Float32 interleaved) with a correct header after
  clean shutdown, in the one run where Screen Recording permission happened to
  be granted for the responsible process at the time.
- **Graceful SIGTERM shutdown**: confirmed via log output --
  `received SIGTERM, stopping gracefully` -> `mic capture stopped` ->
  `system audio capture stopped` -> `shutdown complete, exiting`, and the
  process actually gone afterward (`kill -0` fails).
- **`combined.wav` merge**: ran `toggle.sh`'s exact `ffmpeg` command by hand
  against the real `mic.wav`/`system.wav` produced above -- produced a valid
  2-channel, 16-bit `combined.wav` whose duration (4.24s) matched the source
  files within 0.06s, well inside the "no multi-second drift" requirement.
- **`toggle.sh` end-to-end via the real `osascript`/Terminal.app path** (not
  just running the binary directly): confirmed a real Terminal window opened
  and ran `record-meeting` with the correct session-directory and pidfile
  arguments, mic capture started, and -- on this run -- **system audio
  capture failed with the exact `SCStreamErrorDomain Code=-3801 "The user
  declined TCCs for application, window, display capture"` error**, i.e. this
  environment's Terminal.app does not currently have Screen Recording
  permission granted. This is the real, expected first-run gate PLAN.md
  anticipates -- not a bug in this tool. `toggle.sh` correctly reported the
  failed start (no pidfile appeared, exit code 1) rather than a false
  positive.
- **Partial-start cleanup**: an early version of `record-meeting` crashed
  under `dispatchMain()` (see "Bugs found and fixed during this session"
  below) and separately left `mic.wav` with a lying WAV header
  (`audio bytes: 0`) if system-audio startup failed *after* mic capture had
  already started and wrote real data, because the process exited immediately
  without releasing the still-open `AVAudioFile`. Both are fixed now: `stop()`
  runs on any partial-start failure, so whatever did start gets its file(s)
  closed properly before the process exits.

**Not verified / could not be verified in this environment**:
- The actual bound keyboard shortcut + Services menu trigger (System Settings
  interaction is outside this session's reach) -- see "Global keyboard
  shortcut" above.
- A real Zoom/Meet/Teams call end-to-end with two real speakers audible in
  `combined.wav` -- no real call was placed in this session; what's verified
  is that the capture/write/merge *mechanics* work correctly with real system
  audio and mic PCM data flowing through them, not the perceptual content of
  a specific call.
- The disk-space refusal (<2GB) and hard-stop (<200MB) paths were code-reviewed
  but not exercised at runtime -- doing so safely would mean actually filling
  this machine's disk close to empty, which wasn't done.
- Screen Recording permission was not (and could not be) granted
  non-interactively in this session -- see the -3801 error above. Grant it
  under System Settings > Privacy & Security > Screen Recording > Terminal
  (and relaunch Terminal once if the very next attempt still fails -- see
  "First-run permission flow" above) before relying on this for a real call.

## Bugs found and fixed during this session

Both found via actual runtime testing on this machine, not just code review:

1. **Crash: `dispatchMain()` called from a block on the main queue.**
   `main.swift` originally had a top-level `try await recorder.start()`,
   which implicitly makes the whole file an async context; the Swift 6
   compiler then flags `RunLoop.main.run()` as unavailable there, and the
   seemingly-correct fix, `dispatchMain()`, crashed on every single run in
   this environment with `EXC_BREAKPOINT` /
   `"BUG IN CLIENT OF LIBDISPATCH: dispatch_main called from a block on the
   main queue"` (confirmed via the actual crash report in
   `~/Library/Logs/DiagnosticReports/`). Fixed by wrapping the async startup
   in an explicit `Task { ... }` instead, keeping the file's top level
   synchronous so the original `RunLoop.main.run()` is legal again. See the
   comment at the top of `main.swift` for the full explanation.
2. **Untruthful WAV header on partial-start failure.** If mic capture starts
   successfully but system-audio capture then throws (e.g. declined Screen
   Recording permission), the original code logged the error and called
   `exit(1)` immediately, without stopping the already-running
   `AVAudioEngine`/closing the already-open `mic.wav`. Observed directly:
   `afinfo` reported `audio bytes: 0` / `estimated duration: 0.000000 sec` on
   a `mic.wav` that demonstrably had several seconds of real PCM data written
   to it on disk. Fixed by calling `await recorder.stop()` in that error path
   too (see `main.swift`), so whichever producer(s) did start get torn down
   cleanly before the process exits.
