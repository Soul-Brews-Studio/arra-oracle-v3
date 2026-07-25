import AVFoundation
import Foundation

/// Captures the default microphone input to `mic.wav` via `AVAudioEngine`,
/// per PLAN.md "Capture approach" (the "standard, boring path" -- no
/// BlackHole, no virtual device).
///
/// Also owns the periodic disk-space poll: PLAN.md explicitly asks for this
/// to piggyback on "the existing buffer-write loop, no extra thread" -- the
/// mic tap fires at a short, steady interval (driven by `AVAudioEngine`'s own
/// I/O thread) regardless of whether system audio is currently producing
/// sound, which makes it a more reliable clock than the system-audio tap for
/// this purpose.
final class MicRecorder {
    private let engine = AVAudioEngine()
    private var file: AVAudioFile?
    private let diskCheck: PeriodicDiskCheck
    private(set) var isRunning = false

    /// Called (possibly repeatedly, once per poll while under the soft
    /// threshold) so the owner can log a WARN -- this class itself just
    /// reports, it doesn't dedupe repeats across polls.
    var warnHandler: (() -> Void)?

    /// Called at most once, the moment free space drops below the hard
    /// threshold; the owner is responsible for tearing down both recorders
    /// and exiting (this class does not stop itself, since system-audio
    /// capture must also stop in the same beat).
    var hardStopHandler: (() -> Void)?

    /// - Parameter diskCheckPath: directory to sample free space from (the
    ///   session directory's volume), throttled to `DiskSpace.pollInterval`.
    init(diskCheckPath: String) {
        self.diskCheck = PeriodicDiskCheck(path: diskCheckPath)
    }

    func start(outputURL: URL) throws {
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0 else {
            throw RecorderError.message("mic input has no usable format (sampleRate=\(format.sampleRate), channels=\(format.channelCount)) -- is a microphone connected/selected?")
        }

        let audioFile = try AVAudioFile(
            forWriting: outputURL,
            settings: format.settings,
            commonFormat: format.commonFormat,
            interleaved: format.isInterleaved
        )
        self.file = audioFile

        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let self else { return }
            do {
                try audioFile.write(from: buffer)
            } catch {
                Log.error("mic write failed: \(error)")
            }
            self.pollDiskSpaceIfDue()
        }

        try engine.start()
        isRunning = true
        Log.info("mic capture started -> \(outputURL.path) (sampleRate=\(format.sampleRate), channels=\(format.channelCount))")
    }

    private func pollDiskSpaceIfDue() {
        guard let free = diskCheck.dueCheck() else { return }
        if free < DiskSpace.hardStopBelowFreeBytes {
            hardStopHandler?()
        } else if free < DiskSpace.warnBelowFreeBytes {
            warnHandler?()
        }
    }

    /// Stops the tap/engine and releases the `AVAudioFile`, which is what
    /// actually finalizes the WAV header -- there is no explicit `close()` on
    /// `AVAudioFile`, so dropping the last strong reference is the close.
    func stop() {
        guard isRunning else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        file = nil
        isRunning = false
        Log.info("mic capture stopped")
    }
}

enum RecorderError: Error, CustomStringConvertible {
    case message(String)
    var description: String {
        switch self {
        case .message(let m): return m
        }
    }
}
