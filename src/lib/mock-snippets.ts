/** Mock source snippets for the Clicky demo data */
export const MOCK_SNIPPETS: Record<string, string> = {
  "leanring-buddy/leanring_buddyApp.swift": `import SwiftUI

@main
struct leanring_buddyApp: App {
    @NSApplicationDelegateAdaptor(CompanionAppDelegate.self) var appDelegate

    var body: some Scene {
        Settings {
            EmptyView()
        }
    }
}

class CompanionAppDelegate: NSObject, NSApplicationDelegate {
    var companionManager: CompanionManager?
    var menuBarManager: MenuBarPanelManager?

    func applicationDidFinishLaunching(_ notification: Notification) {
        companionManager = CompanionManager()
        menuBarManager = MenuBarPanelManager(companionManager: companionManager!)
        companionManager?.start()

        ClickyAnalytics.shared.track("app_opened")
    }

    func applicationWillTerminate(_ notification: Notification) {
        companionManager?.stop()
    }
}`,

  "leanring-buddy/CompanionManager.swift": `import Foundation
import Combine

enum CompanionVoiceState: String {
    case idle
    case listening
    case processing
    case responding
}

struct PointingParseResult {
    let x: Double
    let y: Double
    let label: String
    let screenIndex: Int
}

@MainActor
class CompanionManager: ObservableObject {
    @Published var voiceState: CompanionVoiceState = .idle
    @Published var currentTranscript: String = ""
    @Published var isOnboarding: Bool = true

    private let pttMonitor = GlobalPushToTalkShortcutMonitor()
    private let dictationManager = BuddyDictationManager()
    private let overlayManager = OverlayWindowManager()
    private let claudeAPI = ClaudeAPI()
    private let ttsClient = ElevenLabsTTSClient()
    private let screenCapture = CompanionScreenCaptureUtility()

    func start() {
        pttMonitor.onShortcutTransition = { [weak self] isPressed in
            self?.handleShortcutTransition(isPressed: isPressed)
        }
        pttMonitor.startMonitoring()
        overlayManager.createOverlays()
    }

    func handleShortcutTransition(isPressed: Bool) {
        if isPressed {
            voiceState = .listening
            dictationManager.startPushToTalkFromKeyboardShortcut()
        } else {
            voiceState = .processing
            dictationManager.stopPushToTalkFromKeyboardShortcut()
            Task { await sendTranscriptToClaudeWithScreenshot() }
        }
    }

    func sendTranscriptToClaudeWithScreenshot() async {
        guard let transcript = dictationManager.requestFinalTranscript() else { return }
        currentTranscript = transcript

        let screenshots = await screenCapture.captureAllScreensAsJPEG()
        let response = try? await claudeAPI.analyzeImageStreaming(
            images: screenshots,
            prompt: transcript
        )

        if let response {
            voiceState = .responding
            if let point = parsePointingCoordinates(from: response) {
                overlayManager.blueCursor.startNavigatingToElement(point: point)
            }
            ttsClient.speakText(response)
        }
        voiceState = .idle
    }

    func parsePointingCoordinates(from text: String) -> PointingParseResult? {
        // Parse [POINT:x,y:label:screenN] tags from Claude response
        let pattern = #"\\[POINT:(\\d+\\.?\\d*),(\\d+\\.?\\d*):([^:]+):screen(\\d+)\\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text))
        else { return nil }

        let x = Double(text[Range(match.range(at: 1), in: text)!])!
        let y = Double(text[Range(match.range(at: 2), in: text)!])!
        let label = String(text[Range(match.range(at: 3), in: text)!])
        let screen = Int(text[Range(match.range(at: 4), in: text)!])!

        return PointingParseResult(x: x, y: y, label: label, screenIndex: screen)
    }
}`,

  "leanring-buddy/GlobalPushToTalkShortcutMonitor.swift": `import Cocoa

enum BuddyPushToTalkShortcut {
    case ctrlOption
}

class GlobalPushToTalkShortcutMonitor {
    var onShortcutTransition: ((Bool) -> Void)?

    private var eventTap: CFMachPort?
    private var isPressed = false

    func startMonitoring() {
        let mask: CGEventMask = (1 << CGEventType.flagsChanged.rawValue)
        eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: mask,
            callback: { _, _, event, refcon in
                let monitor = Unmanaged<GlobalPushToTalkShortcutMonitor>
                    .fromOpaque(refcon!)
                    .takeUnretainedValue()
                monitor.handleFlagsChanged(event)
                return Unmanaged.passRetained(event)
            },
            userInfo: Unmanaged.passUnretained(self).toOpaque()
        )

        guard let eventTap else { return }
        let runLoopSource = CFMachPortCreateRunLoopSource(nil, eventTap, 0)
        CFRunLoopAddSource(CFRunLoopGetCurrent(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTap, enable: true)
    }

    private func handleFlagsChanged(_ event: CGEvent) {
        let flags = event.flags
        let ctrlOption = flags.contains(.maskControl) && flags.contains(.maskAlternate)

        if ctrlOption && !isPressed {
            isPressed = true
            shortcutTransition()
        } else if !ctrlOption && isPressed {
            isPressed = false
            shortcutTransition()
        }
    }

    func shortcutTransition() {
        onShortcutTransition?(isPressed)
    }
}`,

  "leanring-buddy/BuddyDictationManager.swift": `import AVFoundation
import Combine

class BuddyDictationManager: ObservableObject {
    @Published var isRecording = false
    @Published var currentProvider: String = "assemblyai"

    private var audioEngine: AVAudioEngine?
    private var transcriptionSession: BuddyStreamingTranscriptionSession?
    private var provider: BuddyTranscriptionProvider?

    init() {
        provider = BuddyTranscriptionProviderFactory.createProvider()
    }

    func startPushToTalkFromKeyboardShortcut() {
        guard !isRecording else { return }
        isRecording = true

        audioEngine = AVAudioEngine()
        guard let audioEngine else { return }

        let inputNode = audioEngine.inputNode
        let format = inputNode.outputFormat(forBus: 0)

        transcriptionSession = provider?.startStreamingSession()

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: format) {
            [weak self] buffer, _ in
            guard let pcm16 = BuddyPCM16AudioConverter.convert(buffer) else { return }
            self?.transcriptionSession?.appendAudioBuffer(pcm16)
        }

        try? audioEngine.start()
    }

    func stopPushToTalkFromKeyboardShortcut() {
        audioEngine?.inputNode.removeTap(onBus: 0)
        audioEngine?.stop()
        audioEngine = nil
        isRecording = false
    }

    func requestFinalTranscript() -> String? {
        let transcript = transcriptionSession?.requestFinalTranscript()
        transcriptionSession = nil
        return transcript
    }
}`,

  "leanring-buddy/ClaudeAPI.swift": `import Foundation

class ClaudeAPI {
    private let baseURL = "https://clicky-worker.farzaa.workers.dev/chat"

    func analyzeImageStreaming(
        images: [(Data, String)],
        prompt: String,
        model: String = "claude-sonnet-4-20250514"
    ) async throws -> String {
        var content: [[String: Any]] = images.map { data, mediaType in
            [
                "type": "image",
                "source": [
                    "type": "base64",
                    "media_type": mediaType,
                    "data": data.base64EncodedString()
                ]
            ]
        }
        content.append(["type": "text", "text": prompt])

        let body: [String: Any] = [
            "model": model,
            "max_tokens": 4096,
            "messages": [["role": "user", "content": content]]
        ]

        var request = URLRequest(url: URL(string: baseURL)!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (bytes, _) = try await URLSession.shared.bytes(for: request)
        var fullText = ""

        for try await line in bytes.lines {
            guard line.hasPrefix("data: ") else { continue }
            let json = String(line.dropFirst(6))
            // Parse SSE content_block_delta events
            if let data = json.data(using: .utf8),
               let parsed = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let delta = parsed["delta"] as? [String: Any],
               let text = delta["text"] as? String {
                fullText += text
            }
        }
        return fullText
    }

    func detectImageMediaType(_ data: Data) -> String {
        let bytes = [UInt8](data.prefix(4))
        if bytes.starts(with: [0xFF, 0xD8, 0xFF]) { return "image/jpeg" }
        if bytes.starts(with: [0x89, 0x50, 0x4E, 0x47]) { return "image/png" }
        return "image/jpeg"
    }
}`,

  "leanring-buddy/ElevenLabsTTSClient.swift": `import AVFoundation

class ElevenLabsTTSClient {
    private let baseURL = "https://clicky-worker.farzaa.workers.dev/tts"
    private var audioPlayer: AVAudioPlayer?

    func speakText(_ text: String) {
        Task {
            var request = URLRequest(url: URL(string: baseURL)!)
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: [
                "text": text,
                "model_id": "eleven_flash_v2_5"
            ])

            let (data, _) = try await URLSession.shared.data(for: request)
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.play()
        }
    }

    func stopPlayback() {
        audioPlayer?.stop()
        audioPlayer = nil
    }
}`,

  "leanring-buddy/OverlayWindow.swift": `import Cocoa
import SwiftUI

enum BuddyNavigationMode {
    case idle
    case navigating(target: CGPoint)
}

class OverlayWindow: NSWindow {
    init(screen: NSScreen) {
        super.init(
            contentRect: screen.frame,
            styleMask: .borderless,
            backing: .buffered,
            defer: false
        )
        self.level = .floating
        self.isOpaque = false
        self.backgroundColor = .clear
        self.ignoresMouseEvents = true
        self.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
    }
}

class OverlayWindowManager: ObservableObject {
    var blueCursor = BlueCursorView()
    private var overlays: [OverlayWindow] = []

    func createOverlays() {
        destroyOverlays()
        for screen in NSScreen.screens {
            let window = OverlayWindow(screen: screen)
            let hostingView = NSHostingView(rootView: blueCursor)
            window.contentView = hostingView
            window.makeKeyAndOrderFront(nil)
            overlays.append(window)
        }
    }

    func destroyOverlays() {
        overlays.forEach { $0.close() }
        overlays.removeAll()
    }
}`,

  "leanring-buddy/CompanionScreenCaptureUtility.swift": `import ScreenCaptureKit
import CoreGraphics

struct CompanionScreenCapture {
    let imageData: Data
    let mediaType: String
    let screenLabel: String
}

class CompanionScreenCaptureUtility {
    func captureAllScreensAsJPEG() async -> [(Data, String)] {
        var captures: [(Data, String)] = []

        for (index, screen) in NSScreen.screens.enumerated() {
            guard let cgImage = CGWindowListCreateImage(
                screen.frame,
                .optionOnScreenOnly,
                kCGNullWindowID,
                [.boundsIgnoreFraming]
            ) else { continue }

            let nsImage = NSImage(cgImage: cgImage, size: screen.frame.size)
            // Cap at 1280px wide
            let maxWidth: CGFloat = 1280
            let scale = min(1, maxWidth / nsImage.size.width)
            let targetSize = NSSize(
                width: nsImage.size.width * scale,
                height: nsImage.size.height * scale
            )

            guard let tiffData = nsImage.tiffRepresentation,
                  let bitmap = NSBitmapImageRep(data: tiffData),
                  let jpeg = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.8])
            else { continue }

            captures.append((jpeg, "image/jpeg"))
        }
        return captures
    }
}`,

  "worker/src/index.ts": `export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/chat") {
      return handleChat(request, env);
    }
    if (url.pathname === "/tts") {
      return handleTTS(request, env);
    }
    if (url.pathname === "/transcribe-token") {
      return handleTranscribeToken(env);
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env) {
  const body = await request.text();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body,
  });
  return new Response(response.body, {
    headers: { "Content-Type": "text/event-stream" },
  });
}

async function handleTTS(request: Request, env: Env) {
  const { text, model_id } = await request.json();
  const response = await fetch(
    "https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({ text, model_id }),
    }
  );
  return new Response(response.body, {
    headers: { "Content-Type": "audio/mpeg" },
  });
}

async function handleTranscribeToken(env: Env) {
  const response = await fetch("https://api.assemblyai.com/v2/realtime/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: env.ASSEMBLYAI_API_KEY,
    },
    body: JSON.stringify({ expires_in: 480 }),
  });
  return new Response(response.body, {
    headers: { "Content-Type": "application/json" },
  });
}

interface Env {
  ANTHROPIC_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
}`,
};
