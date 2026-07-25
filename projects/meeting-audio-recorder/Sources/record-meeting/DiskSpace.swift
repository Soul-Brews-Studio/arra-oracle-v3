import Foundation

/// Disk-space safety thresholds and checks, per PLAN.md "Disk space safety".
/// Lives in the capture binary (not toggle.sh) because this is the only place
/// that owns the write loop and file handles, so it's the only place that can
/// react *before* a write fails and close files cleanly instead of leaving a
/// truncated one.
enum DiskSpace {
    /// Refuse to start a new recording below this much free space.
    static let startMinimumFreeBytes: Int64 = 2 * 1_000_000_000 // 2 GB

    /// Soft threshold: log a WARN and keep recording.
    static let warnBelowFreeBytes: Int64 = 1 * 1_000_000_000 // 1 GB

    /// Hard threshold: stop gracefully (close files cleanly) and exit.
    static let hardStopBelowFreeBytes: Int64 = 200 * 1_000_000 // 200 MB

    /// How often the periodic check re-samples free space during recording.
    /// PLAN.md: "piggyback on the existing buffer-write loop, no extra thread" --
    /// this is a throttle interval checked from within an already-firing
    /// callback (see `PeriodicDiskCheck` below), not a dedicated Timer/thread.
    static let pollInterval: TimeInterval = 15

    /// Bytes free on the volume containing `path`, or nil if it can't be
    /// determined (treated as "don't know" by callers, not as "zero free").
    static func freeBytes(at path: String) -> Int64? {
        guard let attrs = try? FileManager.default.attributesOfFileSystem(forPath: path) else {
            return nil
        }
        return (attrs[.systemFreeSize] as? NSNumber)?.int64Value
    }
}

/// Throttles a disk-space check to roughly once per `DiskSpace.pollInterval`,
/// meant to be called from a callback that already fires frequently (the mic
/// tap in this project -- see `MicRecorder`) rather than owning its own timer
/// thread. Not thread-safe by design: only ever driven from the single mic
/// tap callback queue, so no locking is added for a case that can't occur.
final class PeriodicDiskCheck {
    private var lastCheck = Date.distantPast
    private let path: String

    init(path: String) {
        self.path = path
    }

    /// Returns the current free-space reading only when at least
    /// `pollInterval` has elapsed since the last check; otherwise nil (meaning
    /// "not due yet, skip this call").
    func dueCheck() -> Int64? {
        let now = Date()
        guard now.timeIntervalSince(lastCheck) >= DiskSpace.pollInterval else { return nil }
        lastCheck = now
        return DiskSpace.freeBytes(at: path)
    }
}
