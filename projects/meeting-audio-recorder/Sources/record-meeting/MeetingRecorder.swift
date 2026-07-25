import Foundation

/// Orchestrates one recording session: starts/stops both independent
/// producers (mic + system audio) into the same session directory, and wires
/// the disk-space hard-stop so both are torn down together.
///
/// Per PLAN.md, `combined.wav` is deliberately NOT produced here -- it's a
/// post-processing `ffmpeg` step that `toggle.sh` runs after this process has
/// exited, against the two independent WAV files this class produces.
final class MeetingRecorder {
    let sessionDirectory: URL
    private let mic: MicRecorder
    private var system = SystemAudioRecorder()
    private var didHardStop = false
    private let onHardStopExit: () -> Void

    /// - Parameter onHardStopExit: called once teardown from a disk-space
    ///   hard-stop completes, so `main.swift` can exit the process. Kept out
    ///   of this class's own `stop()` so a normal SIGTERM-triggered stop and a
    ///   disk-triggered stop can share the same teardown path but only the
    ///   latter forces a process exit on its own initiative.
    init(sessionDirectory: URL, onHardStopExit: @escaping () -> Void) {
        self.sessionDirectory = sessionDirectory
        self.onHardStopExit = onHardStopExit
        self.mic = MicRecorder(diskCheckPath: sessionDirectory.path)

        mic.warnHandler = {
            if let free = DiskSpace.freeBytes(at: sessionDirectory.path) {
                Log.warn("disk space low: \(free / 1_000_000) MB free (warn threshold: \(DiskSpace.warnBelowFreeBytes / 1_000_000) MB)")
            }
        }
        mic.hardStopHandler = { [weak self] in
            self?.stopForDiskSpace()
        }
    }

    func start() async throws {
        try FileManager.default.createDirectory(at: sessionDirectory, withIntermediateDirectories: true)

        guard let free = DiskSpace.freeBytes(at: sessionDirectory.path) else {
            throw RecorderError.message("could not determine free disk space at \(sessionDirectory.path)")
        }
        guard free >= DiskSpace.startMinimumFreeBytes else {
            throw RecorderError.message("only \(free / 1_000_000) MB free at \(sessionDirectory.path) -- refusing to start below \(DiskSpace.startMinimumFreeBytes / 1_000_000) MB")
        }

        let micURL = sessionDirectory.appendingPathComponent("mic.wav")
        let systemURL = sessionDirectory.appendingPathComponent("system.wav")

        try mic.start(outputURL: micURL)
        try await system.start(outputURL: systemURL)
    }

    /// Normal stop path (SIGTERM/SIGINT from toggle.sh or Ctrl+C).
    func stop() async {
        mic.stop()
        await system.stop()
    }

    /// Disk-space hard-stop path (PLAN.md: "gracefully stop ... then exit").
    /// Runs the same teardown as `stop()`, then asks main.swift to exit the
    /// process on its own initiative (a normal stop just returns and lets the
    /// signal handler's caller exit).
    private func stopForDiskSpace() {
        guard !didHardStop else { return }
        didHardStop = true
        Log.error("disk space below hard threshold (\(DiskSpace.hardStopBelowFreeBytes / 1_000_000) MB) -- stopping recording gracefully")
        Task {
            await stop()
            onHardStopExit()
        }
    }
}
