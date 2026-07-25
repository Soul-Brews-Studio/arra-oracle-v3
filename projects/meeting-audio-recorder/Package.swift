// swift-tools-version:5.9
// Meeting Audio Recorder - offline capture-only Swift Package.
// Executable target only (no library target needed) -- this is a single CLI
// binary (`record-meeting`) invoked by ../toggle.sh, per PLAN.md's "Control
// mechanism" decision. Deliberately separate from the rest of this repo (no
// shared code with projects/meeting-recorder/, no Bun/Node/TS anywhere here).
import PackageDescription

let package = Package(
    name: "record-meeting",
    // ScreenCaptureKit's `SCStreamConfiguration.capturesAudio` requires macOS 13+
    // (PLAN.md "Capture approach"). This machine runs macOS 26.3, well above
    // the floor -- v13 is the correctness floor, not a guess at what's installed.
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "record-meeting",
            path: "Sources/record-meeting"
        )
    ]
)
