import Foundation

/// Minimal timestamped logger writing to stdout/stderr.
///
/// Why no dedicated log file inside the binary itself: `toggle.sh` already
/// tees this process's stdout/stderr into its own log file when launched via
/// the Automator Services runner (mirroring `projects/voice-to-terminal/run.sh`'s
/// "no visible console under Services, so log to a file" lesson -- see that
/// project's toggle.sh/run.sh). Duplicating a second log file here would just
/// be two places to check for the same information.
enum Log {
    static func info(_ message: String) {
        emit(level: "INFO", message: message, toStderr: false)
    }

    /// Soft disk-space threshold and other non-fatal conditions the human
    /// should notice in the log without the recording being interrupted
    /// (PLAN.md "Disk space safety" -- WARN at <1GB free).
    static func warn(_ message: String) {
        emit(level: "WARN", message: message, toStderr: false)
    }

    static func error(_ message: String) {
        emit(level: "ERROR", message: message, toStderr: true)
    }

    private static let formatter: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    private static func emit(level: String, message: String, toStderr: Bool) {
        let line = "[\(formatter.string(from: Date()))] [\(level)] \(message)\n"
        let handle = toStderr ? FileHandle.standardError : FileHandle.standardOutput
        handle.write(Data(line.utf8))
    }
}
