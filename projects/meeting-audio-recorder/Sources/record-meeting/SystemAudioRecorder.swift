import AVFoundation
import CoreMedia
import Foundation
import ScreenCaptureKit

/// Captures "what's playing through the speakers" to `system.wav` via
/// `ScreenCaptureKit`'s audio-only `SCStream` capture, per PLAN.md "Capture
/// approach". Video frames are configured at minimal size/frame-rate (the
/// framework still requires a content filter even for audio-only capture --
/// see PLAN.md's "trade-off acknowledged" note) purely to keep CPU/memory low;
/// no video is ever written anywhere.
final class SystemAudioRecorder: NSObject, SCStreamOutput, SCStreamDelegate {
    private var stream: SCStream?
    private var file: AVAudioFile?
    private let outputQueue = DispatchQueue(label: "meeting-audio-recorder.system-audio-output")
    private(set) var isRunning = false

    func start(outputURL: URL) async throws {
        // audio-only capture still needs a valid display-scoped content
        // filter (PLAN.md's documented ScreenCaptureKit quirk) even though no
        // video frame is ever written to disk here.
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw RecorderError.message("no display available for ScreenCaptureKit content filter -- is this running in a headless/no-display session?")
        }

        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let config = SCStreamConfiguration()
        config.capturesAudio = true
        config.sampleRate = 48000
        config.channelCount = 2
        // Minimal video path: frames are never consumed, just kept small/rare
        // to avoid paying for real screen capture we don't want.
        config.width = 2
        config.height = 2
        config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        config.showsCursor = false

        let newStream = SCStream(filter: filter, configuration: config, delegate: self)
        try newStream.addStreamOutput(self, type: .audio, sampleHandlerQueue: outputQueue)
        self.stream = newStream

        try await newStream.startCapture()
        isRunning = true
        Log.info("system audio capture started -> \(outputURL.path)")

        // File is created lazily on first sample buffer (see below) so its
        // AVAudioFormat exactly matches whatever ASBD SCStream actually hands
        // us, rather than guessing it up front.
        self.pendingOutputURL = outputURL
    }

    private var pendingOutputURL: URL?

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferDataIsReady(sampleBuffer) else { return }

        guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer),
              let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription),
              let format = AVAudioFormat(streamDescription: asbdPointer) else {
            return
        }

        if file == nil {
            guard let url = pendingOutputURL else { return }
            do {
                file = try AVAudioFile(
                    forWriting: url,
                    settings: format.settings,
                    commonFormat: format.commonFormat,
                    interleaved: format.isInterleaved
                )
            } catch {
                Log.error("failed to open system.wav for writing: \(error)")
                return
            }
        }

        var blockBuffer: CMBlockBuffer?
        var bufferListSizeNeeded = 0
        var status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: &bufferListSizeNeeded,
            bufferListOut: nil,
            bufferListSize: 0,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: 0,
            blockBufferOut: nil
        )
        guard status == noErr, bufferListSizeNeeded > 0 else { return }

        let rawPointer = UnsafeMutableRawPointer.allocate(
            byteCount: bufferListSizeNeeded,
            alignment: MemoryLayout<AudioBufferList>.alignment
        )
        defer { rawPointer.deallocate() }
        let audioBufferListPointer = rawPointer.bindMemory(to: AudioBufferList.self, capacity: 1)

        status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
            sampleBuffer,
            bufferListSizeNeededOut: nil,
            bufferListOut: audioBufferListPointer,
            bufferListSize: bufferListSizeNeeded,
            blockBufferAllocator: nil,
            blockBufferMemoryAllocator: nil,
            flags: kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
            blockBufferOut: &blockBuffer
        )
        guard status == noErr,
              let pcmBuffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: audioBufferListPointer) else {
            return
        }

        // `blockBuffer` (retained above) owns the actual sample memory that
        // `audioBufferListPointer.mData` points into; it must stay alive
        // through this synchronous write, which it does simply by being a
        // local var still in scope here.
        do {
            try file?.write(from: pcmBuffer)
        } catch {
            Log.error("system audio write failed: \(error)")
        }
        withExtendedLifetime(blockBuffer) {}
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        Log.error("system audio stream stopped unexpectedly: \(error)")
    }

    func stop() async {
        guard isRunning, let stream else { return }
        do {
            try await stream.stopCapture()
        } catch {
            Log.error("error stopping system audio stream: \(error)")
        }
        self.stream = nil
        file = nil
        isRunning = false
        Log.info("system audio capture stopped")
    }
}
