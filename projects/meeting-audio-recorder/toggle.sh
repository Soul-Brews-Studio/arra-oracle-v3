#!/usr/bin/env bash
# Toggle the meeting audio recorder on/off. Meant to be bound to a global
# macOS keyboard shortcut via an Automator Quick Action in Services/ (see
# README.md), but also works fine run directly from a shell.
#
# Shape deliberately mirrors projects/voice-to-terminal/toggle.sh on this same
# machine (PID-file toggle logic, launch the real work inside Terminal.app so
# it inherits Terminal's already-granted mic/Screen-Recording TCC permissions,
# tee output to a log file since there's no visible console when launched via
# the Services menu). See that project's toggle.sh/README.md for the fuller
# writeup of *why* this shape -- not re-derived here.
#
# State tracking: record-meeting (the Swift binary) writes its own PID to
# PIDFILE once it's actually recording, and toggle.sh's stop path removes it
# after a clean SIGTERM. A stale pidfile (process no longer alive) is treated
# as "not running" and cleaned up automatically.
#
# Usage: ./toggle.sh   (no args; starts a new session if none is running,
#                        otherwise stops the current one and runs the ffmpeg
#                        merge to produce combined.wav)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDFILE="$SCRIPT_DIR/.record-meeting.pid"
SESSION_DIR_FILE="$SCRIPT_DIR/.record-meeting.session-dir"
LOGFILE="$SCRIPT_DIR/toggle.log"
RECORDINGS_ROOT="$HOME/Documents/MeetingRecordings"

# Prefer a release build (what install.sh deploys) but fall back to a debug
# build so `./toggle.sh` also works straight out of a plain `swift build` in
# this checkout without requiring `-c release` first.
if [ -x "$SCRIPT_DIR/.build/release/record-meeting" ]; then
  RECORD_BIN="$SCRIPT_DIR/.build/release/record-meeting"
elif [ -x "$SCRIPT_DIR/.build/debug/record-meeting" ]; then
  RECORD_BIN="$SCRIPT_DIR/.build/debug/record-meeting"
else
  echo "error: record-meeting binary not found. Build it first: swift build -c release" >&2
  exit 1
fi

FFMPEG="/opt/homebrew/bin/ffmpeg"

# Tee everything (including errors) to a log file too, since when this runs
# via the Automator Service (double-click in the Services menu or a bound
# keyboard shortcut), there's no visible console to see failures on -- this is
# the only way to diagnose a silent no-op or a failed ffmpeg merge.
exec > >(tee -a "$LOGFILE") 2>&1
echo "--- $(date '+%Y-%m-%d %H:%M:%S') toggle.sh invoked (caller pid $$, PATH=$PATH) ---"

is_running() {
  # Returns 0 (true) and prints the PID if a live process owns PIDFILE.
  # Cleans up a stale pidfile (process no longer exists) as a side effect.
  if [ -f "$PIDFILE" ]; then
    local pid
    pid="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
    rm -f "$PIDFILE" "$SESSION_DIR_FILE"
  fi
  return 1
}

start() {
  local session_dir osa_err osa_status=0 run_cmd
  session_dir="$RECORDINGS_ROOT/$(date '+%Y-%m-%d_%H%M%S')"
  mkdir -p "$session_dir"
  echo "$session_dir" > "$SESSION_DIR_FILE"

  # Important: `do script` alone can open a new Terminal window on whatever
  # Space/desktop Terminal last used, without raising it or switching Spaces --
  # from the human's perspective that looks exactly like "nothing happened"
  # even though the process is really running. `activate` + explicitly
  # front-most-ing the window makes the result actually visible. Running
  # inside Terminal.app (rather than backgrounding record-meeting directly
  # from this script) is also what lets record-meeting inherit Terminal's
  # already-granted microphone/Screen-Recording TCC permissions instead of
  # needing its own separate grant.
  run_cmd="'$RECORD_BIN' '$session_dir' '$PIDFILE'"
  osa_err="$(osascript \
    -e "tell application \"Terminal\"" \
    -e "activate" \
    -e "set newTab to do script \"$run_cmd\"" \
    -e "set frontmost of window 1 to true" \
    -e "end tell" \
    2>&1 >/dev/null)" || osa_status=$?
  if [ "$osa_status" -ne 0 ]; then
    echo "error: osascript failed (exit $osa_status) trying to tell Terminal.app to run $RECORD_BIN" >&2
    echo "osascript stderr: $osa_err" >&2
    echo "This is almost always macOS blocking Automation permission -- check:" >&2
    echo "System Settings > Privacy & Security > Automation > (this Service's runner) > Terminal" >&2
    rm -f "$SESSION_DIR_FILE"
    return 1
  fi

  # record-meeting writes PIDFILE within milliseconds of actually starting
  # capture, but give it a few seconds in case Terminal.app / disk-space
  # refusal / permission prompts are slow.
  for _ in $(seq 1 40); do
    if pid="$(is_running)"; then
      echo "started (pid $pid), recording to $session_dir"
      return 0
    fi
    sleep 0.25
  done

  echo "warning: launched Terminal window but no pidfile appeared within 10s;" >&2
  echo "check the new Terminal window for errors (e.g. disk space refusal," >&2
  echo "missing mic/Screen Recording permission -- see README.md's first-run section)." >&2
  return 1
}

stop() {
  local pid="$1" session_dir
  session_dir="$(cat "$SESSION_DIR_FILE" 2>/dev/null || true)"

  kill "$pid" 2>/dev/null || true
  # record-meeting's graceful SIGTERM handler stops AVAudioEngine/SCStream and
  # closes both AVAudioFiles cleanly, which isn't instantaneous. Give it up
  # to 10s of grace, then escalate to SIGKILL so we never leave an orphaned
  # process silently holding the mic/screen-recording session open -- though
  # a SIGKILL'd file may be left with an incomplete WAV header.
  for _ in $(seq 1 100); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "warning: record-meeting (pid $pid) did not exit within 10s of SIGTERM; sending SIGKILL" >&2
    kill -9 "$pid" 2>/dev/null || true
    sleep 0.2
  fi
  rm -f "$PIDFILE" "$SESSION_DIR_FILE"
  echo "stopped (was pid $pid)"

  if [ -z "$session_dir" ] || [ ! -d "$session_dir" ]; then
    echo "warning: session directory unknown or missing; skipping combined.wav merge" >&2
    return 0
  fi
  merge_combined_wav "$session_dir"
}

merge_combined_wav() {
  local session_dir="$1" mic="$1/mic.wav" system="$1/system.wav" combined="$1/combined.wav"

  if [ ! -f "$mic" ] || [ ! -f "$system" ]; then
    echo "warning: mic.wav or system.wav missing in $session_dir; skipping combined.wav merge" >&2
    return 0
  fi
  if [ ! -x "$FFMPEG" ]; then
    echo "warning: ffmpeg not found at $FFMPEG; skipping combined.wav merge (mic.wav/system.wav are still intact)" >&2
    return 0
  fi

  # PLAN.md: mic on the left channel, system audio on the right channel, as a
  # post-processing channel-merge (not a real-time sum). Each source is first
  # downmixed to mono (regardless of its original channel count) so the
  # left/right assignment below is unambiguous even if mic or system audio
  # ever comes in as stereo.
  echo "merging combined.wav (mic=left, system=right) ..."
  if "$FFMPEG" -y -nostdin -loglevel error \
    -i "$mic" -i "$system" \
    -filter_complex "[0:a]aformat=channel_layouts=mono[mic];[1:a]aformat=channel_layouts=mono[sys];[mic][sys]join=inputs=2:channel_layout=stereo:map=0.0-FL|1.0-FR[aout]" \
    -map "[aout]" -c:a pcm_s16le \
    "$combined"; then
    echo "combined.wav written to $combined"
  else
    echo "warning: ffmpeg merge failed; mic.wav/system.wav are still intact in $session_dir" >&2
  fi
}

if pid="$(is_running)"; then
  stop "$pid"
else
  start
fi
