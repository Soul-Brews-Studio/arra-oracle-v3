import Dispatch
import Foundation

// record-meeting <session-directory> <pidfile-path>
//
// Invoked by ../toggle.sh (never meant to be a friendly interactive CLI --
// see PLAN.md "Control mechanism"). Writes its own PID to <pidfile-path> as
// soon as it's actually recording, so toggle.sh's start() can confirm success
// and later SIGTERM this exact process to stop it, mirroring
// projects/voice-to-terminal/run.sh's own PIDFILE-on-launch/remove-on-exit
// pattern (there it's a child process's PID; here this binary IS that process,
// so it just writes its own `getpid()`).
//
// IMPORTANT: this file deliberately has no top-level `await`. An earlier
// version called `try await recorder.start()` directly at top level, which
// implicitly makes the whole file an async context; ending it with
// `RunLoop.main.run()` then triggers a Swift 6 compiler warning ("run cannot
// be used from async contexts"), and the seemingly-obvious fix --
// `dispatchMain()` -- turned out to *crash* every time in manual testing here
// with "BUG IN CLIENT OF LIBDISPATCH: dispatch_main called from a block on
// the main queue" (top-level async code itself runs as a block already
// scheduled on the main queue, and libdispatch hard-asserts if you then call
// dispatchMain() from inside that block). Wrapping the async startup in an
// explicit `Task { ... }` keeps this file's top level synchronous, so the
// plain, well-worn `RunLoop.main.run()` at the bottom is both legal and,
// unlike dispatchMain() here, does not crash.

let arguments = CommandLine.arguments
guard arguments.count >= 3 else {
    Log.error("usage: record-meeting <session-directory> <pidfile-path>")
    exit(1)
}

let sessionDirectory = URL(fileURLWithPath: arguments[1])
let pidfilePath = arguments[2]

let recorder = MeetingRecorder(sessionDirectory: sessionDirectory) {
    // Disk-space hard-stop path: teardown already ran by the time this
    // fires (see MeetingRecorder.stopForDiskSpace) -- just clean up and exit.
    try? FileManager.default.removeItem(atPath: pidfilePath)
    exit(0)
}

func gracefulShutdown() {
    Task {
        await recorder.stop()
        try? FileManager.default.removeItem(atPath: pidfilePath)
        Log.info("shutdown complete, exiting")
        exit(0)
    }
}

// SIG_IGN the default disposition first so DispatchSourceSignal is the only
// handler (per Apple's documented pattern for handling signals via GCD).
signal(SIGTERM, SIG_IGN)
signal(SIGINT, SIG_IGN)

let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler {
    Log.info("received SIGTERM, stopping gracefully")
    gracefulShutdown()
}
sigtermSource.resume()

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigintSource.setEventHandler {
    Log.info("received SIGINT, stopping gracefully")
    gracefulShutdown()
}
sigintSource.resume()

Task {
    do {
        try await recorder.start()
        // Only written once capture has actually started -- if `start()`
        // throws below (e.g. disk space refusal, declined Screen Recording
        // permission), no pidfile appears, and toggle.sh's wait-for-pidfile
        // loop correctly reports a failed start instead of a false-positive
        // "running".
        try? String(ProcessInfo.processInfo.processIdentifier)
            .write(toFile: pidfilePath, atomically: true, encoding: .utf8)
        Log.info("recording pid \(ProcessInfo.processInfo.processIdentifier) started, session dir \(sessionDirectory.path)")
    } catch {
        Log.error("failed to start recording: \(error)")
        // mic and system-audio start independently (PLAN.md "two independent
        // producers"), so one can succeed before the other throws (e.g. mic
        // starts fine, ScreenCaptureKit then fails on a declined/missing
        // Screen Recording permission). Without this, an already-opened
        // AVAudioFile is torn down by process exit rather than a clean close,
        // leaving a WAV header that understates the audio actually written
        // (observed during manual testing: `afinfo` reported "audio bytes: 0"
        // / duration 0 despite real PCM data being present on disk) -- stop()
        // here ensures whatever did start gets its file(s) closed properly
        // before exiting.
        await recorder.stop()
        exit(1)
    }
}

RunLoop.main.run()
