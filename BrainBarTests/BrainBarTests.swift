import Darwin
import AppKit
import CryptoKit
import WebKit
import XCTest
@testable import BrainBar

private struct RendererCounts: Equatable {
    let nodes: Int
    let edges: Int
}

private let reviewedVisualCaptureFixtureDigests = [
    "1k": "1f7ec933358a7bd1ff5405278d986a3998b4f37f6c4d9df621dfe08071260bad",
    "inspected-shape": "e1a4217a3ce6f117ac4155710c67f5f36754d2b3d9599bca08b817506534438f"
]

private let matchedCoreVisualCaptureScenarioNames = [
    "1k-overview-collapsed", "1k-overview-docked", "1k-community", "1k-node-focus",
    "1k-selected-hub", "1k-selected-peripheral", "1k-active-path", "1k-recent-orbit",
    "1k-agent-activity", "1k-workflow-highlight", "1k-graph-check", "1k-reduce-motion"
]

private struct LayoutCacheSnapshot: Equatable {
    let count: Int
    let fingerprint: String
}

private struct TransactionalLayoutSnapshot: Decodable, Equatable {
    let visibleNodeIDs: [String]
    let paintedNodeIDs: [String]
    let coordinateFingerprint: String
    let graphReady: Bool
}

private typealias ThreeDRendererHarness = (
    webView: WKWebView,
    coordinator: Graph3DWebView.Coordinator,
    graphDataStore: GraphDataStore
)

private actor GraphDataLoaderGate {
    private var continuations: [CheckedContinuation<Data?, Never>] = []

    func load(_: URL) async -> Data? {
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func waiterCount() -> Int {
        continuations.count
    }

    func resumeFirst(with data: Data?) {
        guard !continuations.isEmpty else {
            return
        }
        continuations.removeFirst().resume(returning: data)
    }

    func resumeLast(with data: Data?) {
        guard let continuation = continuations.popLast() else {
            return
        }
        continuation.resume(returning: data)
    }
}

private actor GraphChangeRadarCommitGate {
    private var continuations: [CheckedContinuation<Void, Never>] = []
    private var claimCount = 0

    func wait() async {
        await withCheckedContinuation { continuation in
            continuations.append(continuation)
        }
    }

    func waiterCount() -> Int {
        continuations.count
    }

    func claimInvocationCount() -> Int {
        claimCount
    }

    func waitForFirstClaim() async {
        claimCount += 1
        guard claimCount == 1 else {
            return
        }
        await wait()
    }

    func resume() {
        guard !continuations.isEmpty else {
            return
        }
        continuations.removeFirst().resume()
    }
}

private extension GraphDataLoadResult {
    var readyHandle: GraphDataHandle? {
        guard case .ready(let handle) = self else { return nil }
        return handle
    }
}

private let reviewedMeasurementFixtureCounts: [String: RendererCounts] = [
    "1k": .init(nodes: 1000, edges: 2380),
    "10k": .init(nodes: 10000, edges: 23805),
    "inspected-shape": .init(nodes: 12547, edges: 29868),
    "25k-stress": .init(nodes: 25000, edges: 59512)
]

private struct MeasurementGraphDirectories {
    let root: URL
    let payload: URL
    let threeD: URL
    let twoDHTML: URL
}

private struct RendererMeasurementSample {
    let graphTransportPreparationMs: Double
    let appProcessResidentDeltaAfterTransportPreparationBytes: Double
    let appProcessResidentMaxSampleBytes: Double
    let threeDLoadToSettledPaintMs: Double
    let threeDNativePrepareToIndexMs: Double
    let threeDNavigationToAPIReadyMs: Double
    let threeDGraphFetchMs: Double
    let threeDGraphJSONParseMs: Double
    let threeDEvidenceBuildMs: Double
    let threeDGraphPreparationMs: Double
    let threeDApplyLensPreLayoutMs: Double
    let threeDMetadataReplayMs: Double
    let threeDNormalizeGraphMs: Double
    let threeDPresentationIndexBuildMs: Double
    let threeDLayoutCacheReadMs: Double
    let threeDMeshHitGeometryMs: Double
    let threeDFirstProjectionStaticPaintMs: Double
    let threeDLayoutEndToEndMs: Double
    let threeDLayoutPreparationMs: Double
    let threeDProbeGraphFetchAndParseMs: Double
    let threeDLayoutCallReturnMs: Double
    let threeDLayoutZeroDelayTimerProbeMs: Double
    let threeDLensToSettledMs: Double
    let threeDSearchToSettledMs: Double
    let threeDPanOrbitFrameMs: Double
    let threeDHoverToHighlightMs: Double
    let threeDSelectionToFirstFeedbackMs: Double
    let threeDSidebarOpenReframeMs: Double
    let threeDOverviewCommunityTransitionMs: Double
    let twoDRuntimeLoadToDiagnosticsMs: Double
    let twoDRuntimeLensToDiagnosticsMs: Double
    let twoDRuntimeSearchToDiagnosticsMs: Double
    let threeDQueryableNodes: Int
    let threeDQueryableEdges: Int
    let twoDQueryableNodes: Int
    let twoDQueryableEdges: Int

    var metrics: [String: Double] {
        [
            "graphTransportPreparationMs": graphTransportPreparationMs,
            "appProcessResidentDeltaAfterTransportPreparationBytes": appProcessResidentDeltaAfterTransportPreparationBytes,
            "appProcessResidentMaxSampleBytes": appProcessResidentMaxSampleBytes,
            "threeDLoadToSettledPaintMs": threeDLoadToSettledPaintMs,
            "threeDNativePrepareToIndexMs": threeDNativePrepareToIndexMs,
            "threeDNavigationToAPIReadyMs": threeDNavigationToAPIReadyMs,
            "threeDGraphFetchMs": threeDGraphFetchMs,
            "threeDGraphJSONParseMs": threeDGraphJSONParseMs,
            "threeDEvidenceBuildMs": threeDEvidenceBuildMs,
            "threeDGraphPreparationMs": threeDGraphPreparationMs,
            "threeDApplyLensPreLayoutMs": threeDApplyLensPreLayoutMs,
            "threeDMetadataReplayMs": threeDMetadataReplayMs,
            "threeDNormalizeGraphMs": threeDNormalizeGraphMs,
            "threeDPresentationIndexBuildMs": threeDPresentationIndexBuildMs,
            "threeDLayoutCacheReadMs": threeDLayoutCacheReadMs,
            "threeDMeshHitGeometryMs": threeDMeshHitGeometryMs,
            "threeDFirstProjectionStaticPaintMs": threeDFirstProjectionStaticPaintMs,
            "threeDLayoutEndToEndMs": threeDLayoutEndToEndMs,
            "threeDLayoutPreparationMs": threeDLayoutPreparationMs,
            "threeDProbeGraphFetchAndParseMs": threeDProbeGraphFetchAndParseMs,
            "threeDLayoutCallReturnMs": threeDLayoutCallReturnMs,
            "threeDLayoutZeroDelayTimerProbeMs": threeDLayoutZeroDelayTimerProbeMs,
            "threeDLensToSettledMs": threeDLensToSettledMs,
            "threeDSearchToSettledMs": threeDSearchToSettledMs,
            "threeDPanOrbitFrameMs": threeDPanOrbitFrameMs,
            "threeDHoverToHighlightMs": threeDHoverToHighlightMs,
            "threeDSelectionToFirstFeedbackMs": threeDSelectionToFirstFeedbackMs,
            "threeDSidebarOpenReframeMs": threeDSidebarOpenReframeMs,
            "threeDOverviewCommunityTransitionMs": threeDOverviewCommunityTransitionMs,
            "twoDRuntimeLoadToDiagnosticsMs": twoDRuntimeLoadToDiagnosticsMs,
            "twoDRuntimeLensToDiagnosticsMs": twoDRuntimeLensToDiagnosticsMs,
            "twoDRuntimeSearchToDiagnosticsMs": twoDRuntimeSearchToDiagnosticsMs
        ]
    }
}

private struct RendererMeasurementSummary: Encodable {
    let samples: [Double]
    let p50: Double
    let p95: Double
    let cvPercent: Double
}

private struct RendererMeasurementRequest: Decodable {
    let version: Int
    let fixtureName: String
    let measurementRoot: String
    let fixturePath: String
    let outputPath: String
    let measurementKind: String?
    let createdAt: TimeInterval
    let launcherPID: Int32

    init(
        version: Int,
        fixtureName: String,
        measurementRoot: String,
        fixturePath: String,
        outputPath: String,
        measurementKind: String? = nil,
        createdAt: TimeInterval,
        launcherPID: Int32
    ) {
        self.version = version
        self.fixtureName = fixtureName
        self.measurementRoot = measurementRoot
        self.fixturePath = fixturePath
        self.outputPath = outputPath
        self.measurementKind = measurementKind
        self.createdAt = createdAt
        self.launcherPID = launcherPID
    }

    private enum CodingKeys: String, CodingKey {
        case version, fixtureName, measurementRoot, fixturePath, outputPath, measurementKind, createdAt, launcherPID
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.init(
            version: try container.decode(Int.self, forKey: .version),
            fixtureName: try container.decode(String.self, forKey: .fixtureName),
            measurementRoot: try container.decode(String.self, forKey: .measurementRoot),
            fixturePath: try container.decode(String.self, forKey: .fixturePath),
            outputPath: try container.decode(String.self, forKey: .outputPath),
            measurementKind: try container.decodeIfPresent(String.self, forKey: .measurementKind),
            createdAt: try container.decode(TimeInterval.self, forKey: .createdAt),
            launcherPID: try container.decode(Int32.self, forKey: .launcherPID)
        )
    }
}

private struct Graph3DVisualCaptureScenario: Decodable, Equatable {
    let name: String
    let fixtureName: String
    let width: Int
    let height: Int
    let outputName: String
}

private struct Graph3DVisualCaptureRequest: Decodable {
    let version: Int
    let captureRoot: String
    let fixturePaths: [String: String]
    let fixtureDigests: [String: String]
    let outputRoot: String
    let scenarios: [Graph3DVisualCaptureScenario]
    let createdAt: TimeInterval
    let launcherPID: Int32
}

private struct Graph3DVisualCaptureManifest: Encodable {
    let schemaVersion = 1
    let kind = "graph3d-visual-acceptance"
    let captures: [Capture]

    struct Capture: Encodable {
        let scenario: String
        let fixture: Fixture
        let viewport: Viewport
        let snapshot: String
        let coordinateFingerprint: String
        let diagnostics: Diagnostics
    }

    struct Fixture: Encodable {
        let name: String
        let sha256: String
        let nodeCount: Int
        let edgeCount: Int
    }

    struct Viewport: Encodable {
        let width: Int
        let height: Int
    }

    struct Diagnostics: Encodable {
        let layoutSchemaVersion: Int
        let layoutProfile: String
        let detailLevel: String
        let detailReason: String
        let paintedNodeCount: Int
        let paintedEdgeCount: Int
        let communityAnchorCount: Int
        let persistentLabelCount: Int
        let persistentLabelMaxOverlapArea: Double
        let activeMode: String
        let selectedNodeCount: Int
        let agentActivityEventCount: Int
        let agentActivityRenderableCount: Int
        let workflowHighlightNodeCount: Int
        let workflowHighlightPendingPathCount: Int
        let graphCheckVisible: Bool
        let sidebarState: String
        let cameraPreset: String
        let staticLayerRebuildMs: Double
        let labelAllocationMs: Double
        let frameQuality: String
        let paintedProjectedCoverageX: Double
        let paintedProjectedCoverageY: Double
        let paintedProjectedCoverageWidth: Double
        let paintedProjectedCoverageHeight: Double
        let visualPixelRatio: Double
        let baseStateHubGlowEnabled: Bool
        let balancedDiscMinimumAlpha: Double
        let darkSeparationRimWidth: Double
        let balancedEdgeAlpha: Double
        let staticRebuildP95Ms: Double
        let visualBackingWidth: Int
        let visualBackingHeight: Int
    }
}

private struct ThreeDRendererMeasurement {
    let loadToSettledPaintMs: Double
    let nativePrepareToIndexMs: Double
    let navigationToAPIReadyMs: Double
    let graphFetchMs: Double
    let graphJSONParseMs: Double
    let evidenceBuildMs: Double
    let graphPreparationMs: Double
    let applyLensPreLayoutMs: Double
    let metadataReplayMs: Double
    let normalizeGraphMs: Double
    let presentationIndexBuildMs: Double
    let layoutCacheReadMs: Double
    let meshHitGeometryMs: Double
    let firstProjectionStaticPaintMs: Double
    let layoutEndToEndMs: Double
    let layoutPreparationMs: Double
    let probeGraphFetchAndParseMs: Double
    let layoutCallReturnMs: Double
    let layoutZeroDelayTimerProbeMs: Double
    let lensToSettledMs: Double
    let searchToSettledMs: Double
    let panOrbitFrameMs: Double
    let hoverToHighlightMs: Double
    let selectionToFirstFeedbackMs: Double
    let sidebarOpenReframeMs: Double
    let overviewCommunityTransitionMs: Double
    let counts: RendererCounts
    let layoutCache: String
}

private struct ThreeDLayoutResponsivenessProbe {
    let graphFetchAndParseMs: Double
    let callReturnMs: Double
    let zeroDelayTimerProbeMs: Double
    let didSucceed: Bool
}

private struct TwoDRuntimeMeasurement {
    let loadToDiagnosticsMs: Double
    let lensToDiagnosticsMs: Double
    let searchToDiagnosticsMs: Double
    let counts: RendererCounts
}

private struct RendererMeasurementReport: Encodable {
    let schemaVersion = 1
    let fixture: Fixture
    let protocolInfo = ProtocolInfo()
    let environment: Environment
    let cold: [String: RendererMeasurementSummary]
    let measured: [String: RendererMeasurementSummary]
    let parity: Parity
    let memoryScope = "app_process_resident_max_sample_bytes_only"

    enum CodingKeys: String, CodingKey {
        case schemaVersion, fixture, protocolInfo = "protocol", environment, cold, measured, parity, memoryScope
    }

    struct Fixture: Encodable {
        let name: String
        let nodeCount: Int
        let edgeCount: Int
    }

    struct ProtocolInfo: Encodable {
        let coldRuns = 1
        let warmupRuns = 2
        let measuredRuns = 9
    }

    struct Environment: Encodable {
        let processIdentifier: Int32
        let operatingSystemVersion: String
        let physicalMemoryBytes: UInt64
    }

    struct Parity: Encodable {
        let threeDQueryableNodes: Int
        let threeDQueryableEdges: Int
        let twoDQueryableNodes: Int
        let twoDQueryableEdges: Int
        let matchesFixture: Bool
    }
}

@MainActor
private final class RendererWebViewHost {
    let window: NSWindow
    let webView: WKWebView

    init(webView: WKWebView) {
        self.webView = webView
        let size = NSSize(width: 320, height: 240)
        let visibleFrame = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1_024, height: 768)
        window = NSWindow(
            contentRect: NSRect(
                x: visibleFrame.maxX - size.width - 16,
                y: visibleFrame.minY + 16,
                width: size.width,
                height: size.height
            ),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.ignoresMouseEvents = true
        window.hasShadow = false
        window.contentView = webView
        window.orderFrontRegardless()
    }

    func close(messageHandlerNames: [String] = []) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        for name in messageHandlerNames {
            webView.configuration.userContentController.removeScriptMessageHandler(forName: name)
        }
        window.orderOut(nil)
        window.close()
    }
}

@MainActor
private final class GraphReadyEventRecorder: NSObject, WKScriptMessageHandler {
    private(set) var graphReadyGenerations: [Int] = []

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            message.name == "brainBarGraphDiagnostic",
            let body = message.body as? [String: Any],
            String(describing: body["event"] ?? "") == "graphReady",
            let generation = (body["generation"] as? NSNumber)?.intValue
        else {
            return
        }
        graphReadyGenerations.append(generation)
    }
}

@MainActor
private final class GraphNodeActionRecorder: NSObject, WKScriptMessageHandler {
    private(set) var actions: [[String: Any]] = []

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "brainBarNodeAction", let action = message.body as? [String: Any] else {
            return
        }
        actions.append(action)
    }
}

final class BrainBarTests: XCTestCase {
    func testConfigurationManagerCreatesDefaultWithoutOverwritingExistingFile() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]

        let created = try manager.loadOrCreate()
        XCTAssertEqual(created, .default)
        XCTAssertTrue(FileManager.default.fileExists(atPath: configURL.path))

        var changed = BrainBarConfig.default
        changed.vaultPath = "/tmp/example-vault"
        try manager.save(changed)

        let loaded = try manager.loadOrCreate()
        XCTAssertEqual(loaded.vaultPath, "/tmp/example-vault")
    }

    func testGraphRendererChoiceFollowsModeRoundTripAndJSONOnlyFallback() {
        let choices = [GraphViewMode.twoD, .threeD, .twoD].map {
            graphRendererChoice(
                isFocus: true,
                graphJSONExists: true,
                graphHTMLExists: true,
                requestedMode: $0,
                experimental3DEnabled: true
            )
        }

        XCTAssertEqual(choices, [.twoD, .threeD, .twoD])
        XCTAssertEqual(
            graphRendererChoice(
                isFocus: true,
                graphJSONExists: true,
                graphHTMLExists: false,
                requestedMode: .twoD,
                experimental3DEnabled: true
            ),
            .threeD
        )
        XCTAssertEqual(
            graphRendererChoice(
                isFocus: false,
                graphJSONExists: true,
                graphHTMLExists: true,
                requestedMode: .threeD,
                experimental3DEnabled: true
            ),
            .twoD
        )
    }

    func testRendererMeasurementRequestValidationRejectsStaleOrUnsafeRequests() throws {
        let now = Date().timeIntervalSince1970
        let root = try measurementRequestTemporaryDirectory()
        let outside = try temporaryDirectory()
        defer {
            removeTemporaryDirectory(root)
            removeTemporaryDirectory(outside)
        }
        let fixtures = root.appendingPathComponent("fixtures", isDirectory: true)
        let fixtureURL = fixtures.appendingPathComponent("1k.json")
        try FileManager.default.createDirectory(at: fixtures, withIntermediateDirectories: true)
        try "{}".write(to: fixtureURL, atomically: true, encoding: .utf8)
        let valid = RendererMeasurementRequest(
            version: 2,
            fixtureName: "1k",
            measurementRoot: root.path,
            fixturePath: fixtureURL.path,
            outputPath: root.appendingPathComponent("report.json").path,
            measurementKind: nil,
            createdAt: now,
            launcherPID: getpid()
        )
        XCTAssertNoThrow(try validatedRendererMeasurementRequest(valid, now: now))
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 0, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: valid.fixturePath, outputPath: valid.outputPath, createdAt: now, launcherPID: getpid()), now: now))
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "unknown", measurementRoot: valid.measurementRoot, fixturePath: valid.fixturePath, outputPath: valid.outputPath, createdAt: now, launcherPID: getpid()), now: now))
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: "/tmp/1k.json", outputPath: valid.outputPath, createdAt: now, launcherPID: getpid()), now: now))
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: valid.fixturePath, outputPath: valid.outputPath, createdAt: now - 301, launcherPID: getpid()), now: now))

        let escapedFixture = root.appendingPathComponent("escaped-fixture/1k.json")
        let outsideFixture = outside.appendingPathComponent("1k.json")
        try FileManager.default.createDirectory(at: escapedFixture.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "{}".write(to: outsideFixture, atomically: true, encoding: .utf8)
        try FileManager.default.createSymbolicLink(at: escapedFixture, withDestinationURL: outsideFixture)
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: escapedFixture.path, outputPath: valid.outputPath, createdAt: now, launcherPID: getpid()), now: now))

        let escapedFixtureParent = root.appendingPathComponent("escaped-fixture-parent", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: escapedFixtureParent, withDestinationURL: outside)
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: escapedFixtureParent.appendingPathComponent("1k.json").path, outputPath: valid.outputPath, createdAt: now, launcherPID: getpid()), now: now))

        let escapedReportParent = root.appendingPathComponent("escaped-report-parent", isDirectory: true)
        try FileManager.default.createSymbolicLink(at: escapedReportParent, withDestinationURL: outside)
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: valid.measurementRoot, fixturePath: valid.fixturePath, outputPath: escapedReportParent.appendingPathComponent("report.json").path, createdAt: now, launcherPID: getpid()), now: now))

        let escapedRoot = URL(fileURLWithPath: "/private/tmp/brainbar-renderer-measurements-link-\(UUID().uuidString)", isDirectory: true)
        defer { try? FileManager.default.removeItem(at: escapedRoot) }
        try FileManager.default.createSymbolicLink(at: escapedRoot, withDestinationURL: outside)
        XCTAssertThrowsError(try validatedRendererMeasurementRequest(.init(version: 2, fixtureName: "1k", measurementRoot: escapedRoot.path, fixturePath: escapedRoot.appendingPathComponent("1k.json").path, outputPath: escapedRoot.appendingPathComponent("report.json").path, createdAt: now, launcherPID: getpid()), now: now))
    }

    func testCommandRunnerCapturesSuccessOutput() async throws {
        let spec = CommandSpec(executable: "/bin/echo", arguments: ["hello"], workingDirectory: nil)
        let result = try await CommandRunner().run(spec, name: "echo", vaultURL: nil)

        XCTAssertTrue(result.succeeded)
        XCTAssertEqual(result.stdout.trimmingCharacters(in: .whitespacesAndNewlines), "hello")
        XCTAssertEqual(result.exitCode, 0)
    }

    func testCommandRunnerCapturesFailureOutput() async throws {
        let spec = CommandSpec(executable: "/bin/sh", arguments: ["-c", "echo nope >&2; exit 7"], workingDirectory: nil)
        let result = try await CommandRunner().run(spec, name: "failure", vaultURL: nil)

        XCTAssertFalse(result.succeeded)
        XCTAssertEqual(result.exitCode, 7)
        XCTAssertEqual(result.stderr.trimmingCharacters(in: .whitespacesAndNewlines), "nope")
    }

    func testCommandRunnerDrainsLargeConcurrentOutputWithBoundedCapture() async throws {
        let bytesPerStream = 1_200_000
        let script = "(yes O | head -c \(bytesPerStream)) & (yes E | head -c \(bytesPerStream) >&2) & wait"
        let startedAt = Date()
        let result = try await CommandRunner().run(
            CommandSpec(executable: "/bin/sh", arguments: ["-c", script], workingDirectory: nil),
            name: "large-output",
            vaultURL: nil,
            timeoutSeconds: 8
        )

        XCTAssertTrue(result.succeeded)
        XCTAssertLessThan(result.duration, 8)
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 8)
        XCTAssertTrue(result.stdout.hasPrefix("O"))
        XCTAssertTrue(result.stderr.hasPrefix("E"))
        XCTAssertTrue(result.stdout.contains("[BrainBar: output truncated after 1048576 bytes]"))
        XCTAssertTrue(result.stderr.contains("[BrainBar: output truncated after 1048576 bytes]"))
        XCTAssertLessThanOrEqual(result.stdout.utf8.count, 1_048_576)
        XCTAssertLessThanOrEqual(result.stderr.utf8.count, 1_048_576)
    }

    func testCommandRunnerBoundsMalformedTruncatedOutput() async throws {
        let bytesPerStream = 1_200_000
        let script = "import sys; sys.stdout.buffer.write(b'\\xff' * \(bytesPerStream)); sys.stderr.buffer.write(b'\\xfe' * \(bytesPerStream))"
        let result = try await CommandRunner().run(
            CommandSpec(executable: "/usr/bin/python3", arguments: ["-c", script], workingDirectory: nil),
            name: "malformed-output",
            vaultURL: nil,
            timeoutSeconds: 8
        )

        XCTAssertTrue(result.succeeded)
        let marker = "\n[BrainBar: output truncated after 1048576 bytes]\n"
        XCTAssertEqual(result.stdout, marker)
        XCTAssertEqual(result.stderr, marker)
        XCTAssertLessThanOrEqual(result.stdout.utf8.count, 1_048_576)
        XCTAssertLessThanOrEqual(result.stderr.utf8.count, 1_048_576)
    }

    func testCommandRunnerRetainsMultibytePrefixAtTruncationBoundary() async throws {
        let marker = "\n[BrainBar: output truncated after 1048576 bytes]\n"
        let script = "import sys; sys.stdout.buffer.write('😀'.encode() * 300000)"
        let result = try await CommandRunner().run(
            CommandSpec(executable: "/usr/bin/python3", arguments: ["-c", script], workingDirectory: nil),
            name: "multibyte-output",
            vaultURL: nil,
            timeoutSeconds: 8
        )

        XCTAssertTrue(result.succeeded)
        XCTAssertTrue(result.stdout.hasSuffix(marker))
        XCTAssertTrue(result.stdout.dropLast(marker.count).hasSuffix("😀"))
        XCTAssertLessThanOrEqual(result.stdout.utf8.count, 1_048_576)
    }

    func testCommandRunnerForceKillsTermIgnoringProcessAfterTimeout() async throws {
        let directory = try temporaryDirectory()
        let pidURL = directory.appendingPathComponent("ignoring-term.pid")
        let script = "trap '' TERM; echo $$ > '\(pidURL.path)'; while :; do :; done"
        let startedAt = Date()

        do {
            _ = try await CommandRunner().run(
                CommandSpec(executable: "/bin/sh", arguments: ["-c", script], workingDirectory: nil),
                name: "ignoring-term",
                vaultURL: nil,
                timeoutSeconds: 1
            )
            XCTFail("Expected timeout")
        } catch let error as BrainBarError {
            XCTAssertEqual(error, .commandTimedOut("ignoring-term", 1))
        }

        let elapsed = Date().timeIntervalSince(startedAt)
        XCTAssertGreaterThanOrEqual(elapsed, 1.8)
        XCTAssertLessThan(elapsed, 4)
        let pidText = try String(contentsOf: pidURL, encoding: .utf8)
        let pidValue = try XCTUnwrap(Int32(pidText.trimmingCharacters(in: .whitespacesAndNewlines)))
        let pid = pid_t(pidValue)
        XCTAssertTrue(processIsGone(pid))
    }

    func testCommandRunnerBoundsInheritedPipeDrainAfterDirectProcessExit() async throws {
        let startedAt = Date()
        let result = try await CommandRunner().run(
            CommandSpec(executable: "/bin/sh", arguments: ["-c", "(sleep 2) & printf foreground"], workingDirectory: nil),
            name: "inherited-pipe",
            vaultURL: nil,
            timeoutSeconds: 4
        )

        let elapsed = Date().timeIntervalSince(startedAt)
        XCTAssertTrue(result.succeeded)
        XCTAssertEqual(result.stdout, "foreground")
        XCTAssertGreaterThanOrEqual(elapsed, 0.15)
        XCTAssertLessThan(elapsed, 1)
    }

    func testVaultStatusResolvesFilesAndGitDirtyState() async throws {
        let vault = try temporaryDirectory()
        try "dashboard".write(to: vault.appendingPathComponent("Project Dashboard.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: vault.appendingPathComponent("graphify-out"), withIntermediateDirectories: true)
        try "graph".write(to: vault.appendingPathComponent("graphify-out/graph.html"), atomically: true, encoding: .utf8)
        try "report".write(to: vault.appendingPathComponent("graphify-out/GRAPH_REPORT.md"), atomically: true, encoding: .utf8)
        _ = try await CommandRunner().run(CommandSpec(executable: "git", arguments: ["init"], workingDirectory: vault.path), name: "git", vaultURL: nil)
        try "dirty".write(to: vault.appendingPathComponent("dirty.md"), atomically: true, encoding: .utf8)

        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        let status = await VaultStatusService().status(for: config)

        XCTAssertTrue(status.vaultExists)
        XCTAssertTrue(status.dashboardExists)
        XCTAssertTrue(status.graphHtmlExists)
        XCTAssertFalse(status.graphJSONExists)
        XCTAssertTrue(status.graphOutputExists)
        XCTAssertTrue(status.graphReportExists)
        XCTAssertEqual(status.gitDirty, true)
    }

    func testVaultStatusRecognizesGraphifyJSONWithoutHTML() async throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try #"{"nodes":[],"edges":[]}"#.write(
            to: graphDirectory.appendingPathComponent("graph.json"),
            atomically: true,
            encoding: .utf8
        )

        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        let status = await VaultStatusService().status(for: config)

        XCTAssertFalse(status.graphHtmlExists)
        XCTAssertTrue(status.graphJSONExists)
        XCTAssertTrue(status.graphOutputExists)
        XCTAssertNotNil(status.graphOutputModifiedAt)
    }

    func testSetupDoctorDiagnosesConfigurationAndVaultBlockers() async throws {
        var config = BrainBarConfig.default
        config.commands.refreshGraph.executable = "/bin/echo"
        let service = SetupDoctorService(environment: ["PATH": "/usr/bin:/bin"])

        let emptyReport = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertFalse(emptyReport.canSave)
        XCTAssertEqual(emptyReport.findings.first(where: { $0.code == .noConfiguration })?.action, .chooseVault)

        config.vaultPath = "/path/that/does/not/exist"
        let missingReport = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertFalse(missingReport.canSave)
        XCTAssertNotNil(missingReport.findings.first(where: { $0.code == .vaultMissing }))

        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        config.vaultPath = vault.path
        config.serverPort = 0
        let invalidReport = await service.inspect(config: config, lastGraphRefresh: nil)
        let invalidFinding = try XCTUnwrap(invalidReport.findings.first(where: { $0.code == .invalidConfiguration }))
        XCTAssertEqual(invalidFinding.severity, .error)
        XCTAssertTrue(invalidFinding.blocksSaving)
        XCTAssertFalse(invalidReport.canSave)
    }

    func testSetupDoctorGraphOutputMatrixIncludesJSONOnlyAndInvalidCases() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.commands.refreshGraph.executable = "/bin/echo"
        let service = SetupDoctorService(environment: ["PATH": "/usr/bin:/bin"])

        let missing = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertNotNil(missing.findings.first(where: { $0.code == .graphJSONMissing }))
        XCTAssertTrue(missing.canSave)

        try "not json".write(to: graphURL, atomically: true, encoding: .utf8)
        let invalidJSON = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertNotNil(invalidJSON.findings.first(where: { $0.code == .graphJSONInvalid }))

        try #"{"nodes":[],"edges":[],"links":[]}"#.write(to: graphURL, atomically: true, encoding: .utf8)
        let invalidShape = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertNotNil(invalidShape.findings.first(where: { $0.code == .graphJSONInvalidShape }))

        try #"{"nodes":[],"edges":[]}"#.write(to: graphURL, atomically: true, encoding: .utf8)
        let jsonOnly = await service.inspect(config: config, lastGraphRefresh: nil)
        let jsonOnlyFinding = try XCTUnwrap(jsonOnly.findings.first(where: { $0.code == .graphJSONOnly }))
        XCTAssertEqual(jsonOnlyFinding.severity, .ready)
        XCTAssertTrue(jsonOnly.canSave)
    }

    func testSetupDoctorDistinguishesVaultAndGraphPermissionFailures() async throws {
        let service = SetupDoctorService(environment: ["PATH": "/usr/bin:/bin"])
        let unreadableVault = try temporaryDirectory()
        defer {
            chmod(unreadableVault.path, 0o700)
            removeTemporaryDirectory(unreadableVault)
        }
        var config = BrainBarConfig.default
        config.vaultPath = unreadableVault.path
        config.commands.refreshGraph.executable = "/bin/echo"
        XCTAssertEqual(chmod(unreadableVault.path, 0o000), 0)

        let vaultReport = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertNotNil(vaultReport.findings.first(where: { $0.code == .vaultUnreadable }))
        XCTAssertFalse(vaultReport.canSave)

        XCTAssertEqual(chmod(unreadableVault.path, 0o700), 0)
        let graphDirectory = unreadableVault.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try #"{"nodes":[],"edges":[]}"#.write(to: graphURL, atomically: true, encoding: .utf8)
        defer { chmod(graphURL.path, 0o600) }
        XCTAssertEqual(chmod(graphURL.path, 0o000), 0)

        let graphReport = await service.inspect(config: config, lastGraphRefresh: nil)
        XCTAssertNotNil(graphReport.findings.first(where: { $0.code == .graphJSONUnreadable }))
        XCTAssertTrue(graphReport.canSave)
    }

    func testSetupDoctorReportsExactCommandEnvironmentAndAvailability() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let nonExecutable = vault.appendingPathComponent("not-executable")
        try "#!/bin/sh".write(to: nonExecutable, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: nonExecutable.path)

        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.commands.refreshGraph = CommandSpec(
            executable: nonExecutable.path,
            arguments: ["update", "."],
            workingDirectory: "vault"
        )
        config.commands.brainCheck = CommandSpec(
            executable: "definitely-missing-brainbar-command",
            arguments: [],
            workingDirectory: "vault"
        )
        let report = await SetupDoctorService(environment: ["PATH": "/usr/bin:/bin"]).inspect(
            config: config,
            lastGraphRefresh: nil
        )

        XCTAssertTrue(report.effectivePATH.contains("/opt/homebrew/bin"))
        let refresh = try XCTUnwrap(report.commands.first(where: { $0.id == "refreshGraph" }))
        XCTAssertEqual(refresh.resolvedExecutablePath, nonExecutable.path)
        XCTAssertEqual(refresh.workingDirectoryPath, vault.path)
        XCTAssertFalse(refresh.available)
        XCTAssertEqual(report.findings.first(where: { $0.id == "command-refreshGraph" })?.code, .commandNotExecutable)
        XCTAssertEqual(report.findings.first(where: { $0.id == "command-brainCheck" })?.code, .commandUnavailable)
        XCTAssertEqual(refresh.commandLine, "\(nonExecutable.path) update .")
    }

    func testSetupDoctorUsesFailedRefreshAsExplicitStaleEvidence() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try #"{"nodes":[],"edges":[]}"#.write(to: graphURL, atomically: true, encoding: .utf8)
        let oldDate = Date(timeIntervalSince1970: 100)
        try FileManager.default.setAttributes([.modificationDate: oldDate], ofItemAtPath: graphURL.path)
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.commands.refreshGraph.executable = "/bin/echo"
        let refresh = CommandResult(
            commandName: "Refresh Graph",
            exitCode: 1,
            stdout: "",
            stderr: "private failure details",
            startedAt: Date(timeIntervalSince1970: 200),
            finishedAt: Date(timeIntervalSince1970: 201)
        )

        let report = await SetupDoctorService().inspect(config: config, lastGraphRefresh: refresh)

        let failed = try XCTUnwrap(report.findings.first(where: { $0.code == .refreshFailed }))
        XCTAssertFalse(failed.evidence.contains("private failure details"))
        XCTAssertNotNil(report.findings.first(where: { $0.code == .staleOutput }))
        XCTAssertTrue(report.canSave)
    }

    @MainActor
    func testAppModelValidatesSetupBeforeSaving() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(
            configurationManager: manager,
            setupDoctorService: SetupDoctorService(environment: ["PATH": "/usr/bin:/bin"])
        )
        var invalid = model.config
        invalid.vaultPath = "/missing/setup-doctor-vault"

        let blocked = await model.validateAndSaveConfig(invalid)

        XCTAssertFalse(blocked.saved)
        XCTAssertFalse(blocked.report.canSave)
        XCTAssertNotEqual(model.config.vaultPath, invalid.vaultPath)

        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        var valid = invalid
        valid.vaultPath = vault.path
        valid.commands.refreshGraph.executable = "/bin/echo"
        let saved = await model.validateAndSaveConfig(valid)
        XCTAssertTrue(saved.saved)
        XCTAssertTrue(saved.report.canSave)
        XCTAssertEqual(model.config.vaultPath, vault.path)
    }

    func testVaultGitDescriptionNamesVaultAndAvoidsDirtyLabel() {
        let status = VaultStatus(
            vaultPath: "/tmp/example-vault",
            vaultExists: true,
            dashboardExists: false,
            graphHtmlExists: false,
            graphHtmlModifiedAt: nil,
            graphJSONExists: false,
            graphJSONModifiedAt: nil,
            graphReportExists: false,
            gitBranch: "main",
            gitDirty: true
        )

        XCTAssertEqual(status.gitDescription, "Vault · main · changes")
    }

    func testGraphNodeSourceResolvesRelativePathInsideVault() throws {
        let vault = try temporaryDirectory()
        let noteURL = vault.appendingPathComponent("Notes/Example.md")
        try FileManager.default.createDirectory(at: noteURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "note".write(to: noteURL, atomically: true, encoding: .utf8)

        var config = BrainBarConfig.default
        config.vaultPath = vault.path

        let resolved = try VaultStatusService().resolvedGraphNodeSourceURL("Notes/Example.md", config: config)

        XCTAssertEqual(resolved.path, noteURL.standardizedFileURL.path)
    }

    func testGraphNodeSourceResolvesAbsolutePathInsideVault() throws {
        let vault = try temporaryDirectory()
        let noteURL = vault.appendingPathComponent("Example.md")
        try "note".write(to: noteURL, atomically: true, encoding: .utf8)

        var config = BrainBarConfig.default
        config.vaultPath = vault.path

        let resolved = try VaultStatusService().resolvedGraphNodeSourceURL(noteURL.path, config: config)

        XCTAssertEqual(resolved.path, noteURL.standardizedFileURL.path)
    }

    func testGraphNodeSourceRejectsParentTraversalOutsideVault() throws {
        let vault = try temporaryDirectory()
        var config = BrainBarConfig.default
        config.vaultPath = vault.path

        XCTAssertThrowsError(try VaultStatusService().resolvedGraphNodeSourceURL("../outside.md", config: config)) { error in
            XCTAssertEqual(error as? BrainBarError, .graphNodeSourceOutsideVault("../outside.md"))
        }
    }

    func testGraphNodeSourceRejectsAbsolutePathOutsideVault() throws {
        let vault = try temporaryDirectory()
        let outsideURL = try temporaryDirectory().appendingPathComponent("Outside.md")
        try "outside".write(to: outsideURL, atomically: true, encoding: .utf8)
        var config = BrainBarConfig.default
        config.vaultPath = vault.path

        XCTAssertThrowsError(try VaultStatusService().resolvedGraphNodeSourceURL(outsideURL.path, config: config)) { error in
            XCTAssertEqual(error as? BrainBarError, .graphNodeSourceOutsideVault(outsideURL.path))
        }
    }

    func testGraphNodeSourceMissingFileUsesReadableRelativePath() throws {
        let vault = try temporaryDirectory()
        var config = BrainBarConfig.default
        config.vaultPath = vault.path

        XCTAssertThrowsError(try VaultStatusService().resolvedGraphNodeSourceURL("Missing.md", config: config)) { error in
            XCTAssertEqual(error as? BrainBarError, .graphNodeSourceFileMissing("Missing.md"))
        }
    }

    @MainActor
    func testGraph3DProductionSchemeLoadsNodeFileMetadata() async throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let noteURL = vault.appendingPathComponent("Notes/Recent.md")
        defer { removeTemporaryDirectory(vault) }
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: noteURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "recent".write(to: noteURL, atomically: true, encoding: .utf8)
        let graphJSON = """
        {
          "nodes": [
            { "id": "recent", "label": "Recent", "source_file": "Notes/Recent.md" }
          ],
          "edges": []
        }
        """
        try graphJSON.write(to: graphDirectory.appendingPathComponent("graph.json"), atomically: true, encoding: .utf8)
        let vaultContentHashBeforeInteraction = try vaultContentHash(vault)

        let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        var shouldCloseHost = true
        defer {
            if shouldCloseHost {
                host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }
        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        do {
            _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "3D metadata diagnostics API") {
                diagnosticString($0, "activeMode") != nil
            }
            _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "3D metadata graph load") {
                diagnosticCount($0, "queryableNodes") == 1 && diagnosticString($0, "layoutState") == "committed"
            }
            let evidenceReady = try await evaluateJavaScriptString(
                "typeof window.BrainBarGraphEvidence?.build === 'function' ? 'ready' : null",
                in: threeD.webView
            )
            XCTAssertEqual(evidenceReady, "ready")
            let healthPanelText = try await evaluateJavaScriptString(
                "window.brainBarRevealNode3D('recent'); window.brainBarShowGraphHealth(); document.querySelector('[data-copy-proposal]')?.click(); document.querySelector('#graph-health-panel')?.textContent || null",
                in: threeD.webView
            )
            let graphCheckText = try XCTUnwrap(healthPanelText)
            XCTAssertTrue(graphCheckText.contains("Graph Check"))
            XCTAssertTrue(graphCheckText.contains("Rule orphan-node v1"))
            XCTAssertTrue(graphCheckText.contains("Caveat:"))
            XCTAssertTrue(graphCheckText.contains("Sources (1): Notes/Recent.md"))
            XCTAssertFalse(graphCheckText.contains("[object Object]"))
            XCTAssertEqual(try vaultContentHash(vault), vaultContentHashBeforeInteraction)
            let metadata = try await evaluateThreeDJavaScriptValue(
                "JSON.stringify(window.__brainBarNodeFileMetadata)",
                action: "read production scheme metadata",
                in: threeD.webView
            )
            XCTAssertTrue(metadata?.contains(#""recent""#) == true)
            XCTAssertTrue(metadata?.contains(#""Notes/Recent.md""#) == true)
            XCTAssertTrue(metadata?.contains(#""mtime""#) == true)
            try await waitForCoordinatorGraphReady(threeD.coordinator)
            let graphURL = try graphSchemeURL(for: threeD.coordinator)
            let metadataURL = graphURL.replacingOccurrences(of: "/graph.json?", with: "/graph-metadata.json?")
            XCTAssertEqual(
                URLComponents(string: graphURL)?.queryItems?.first(where: { $0.name == "digest" })?.value,
                URLComponents(string: metadataURL)?.queryItems?.first(where: { $0.name == "digest" })?.value
            )
            let schemeResources = try await callAsyncJavaScriptString(
                """
                const [graphResponse, metadataResponse] = await Promise.all([
                  fetch(\(Graph3DWebView.jsStringLiteral(graphURL))),
                  fetch(\(Graph3DWebView.jsStringLiteral(metadataURL)))
                ]);
                return JSON.stringify({
                  graph: await graphResponse.json(),
                  metadata: await metadataResponse.json()
                });
                """,
                in: threeD.webView
            )
            guard
                let schemeResources,
                let schemeData = schemeResources.data(using: .utf8),
                let schemePayload = try JSONSerialization.jsonObject(with: schemeData) as? [String: Any],
                let graph = schemePayload["graph"] as? [String: Any],
                let nodes = graph["nodes"] as? [[String: Any]],
                let metadataPayload = schemePayload["metadata"] as? [String: Any],
                let byNodeID = metadataPayload["byNodeId"] as? [String: Any]
            else {
                return XCTFail("Expected graph and metadata from the digest-bound 3D scheme")
            }
            XCTAssertEqual(nodes.compactMap { $0["id"] as? String }, ["recent"])
            XCTAssertNotNil(byNodeID["recent"])
            await quiesceRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            shouldCloseHost = false
        } catch {
            XCTFail(
                "3D production metadata scheme failed: \(error.localizedDescription)"
            )
            return
        }
    }

    @MainActor
    func testGraph3DRejectedStoreSnapshotsDoNotNavigateOrEmitGraphReady() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphDirectory = directory.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        let sentinel = "GRAPH_3D_STORE_PRIVACY_SENTINEL"
        let rejected: [(String, GraphDataValidationCode)] = [
            ("{", .invalidJSON),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-a"}],"edges":[]}"#, .duplicateNodeID),
            ("{\"nodes\":[{\"id\":\"node-a\",\"label\":\"\(sentinel)\"}],\"edges\":[{\"from\":\"node-a\",\"to\":\"missing\"}]}", .missingEndpoint)
        ]

        for (index, rejectedSnapshot) in rejected.enumerated() {
            try rejectedSnapshot.0.write(to: graphURL, atomically: true, encoding: .utf8)
            let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory)
            let host = RendererWebViewHost(webView: threeD.webView)
            defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }
            var loadEvents: [GraphRendererLoadEvent] = []
            threeD.coordinator.onLoadEvent = { event, attempt in
                guard attempt == index + 1 else {
                    return
                }
                loadEvents.append(event)
            }
            threeD.coordinator.prepareGraph(
                url: graphURL,
                policy: .normal,
                attempt: index + 1,
                in: threeD.webView
            )
            let deadline = Date().addingTimeInterval(2)
            while loadEvents.count < 2 && Date() < deadline {
                await Task.yield()
            }
            XCTAssertEqual(loadEvents, [.loading, .failed(.validation(rejectedSnapshot.1))])
            XCTAssertNil(threeD.coordinator.indexURL)
            XCTAssertFalse(threeD.coordinator.graphReady)
            XCTAssertFalse(String(describing: loadEvents).contains(sentinel))
        }
    }

    @MainActor
    func testGraph3DCurrentGraphFetchFailureReportsRendererFailureWithoutContent() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphDirectory = directory.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        let sentinel = "GRAPH_3D_FETCH_PRIVACY_SENTINEL"
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try "{\"nodes\":[{\"id\":\"node-a\",\"label\":\"\(sentinel)\"}],\"edges\":[]}".write(
            to: graphURL,
            atomically: true,
            encoding: .utf8
        )
        let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }
        var loadEvents: [GraphRendererLoadEvent] = []
        var diagnostics: [String] = []
        threeD.coordinator.onLoadEvent = { event, attempt in
            guard attempt == 73 else {
                return
            }
            loadEvents.append(event)
        }
        threeD.coordinator.onDiagnostic = { diagnostics.append($0) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory, attempt: 72)
        try await waitForRendererFunction("brainBarLoadGraphFromURL", in: threeD.webView, phase: "3D graph fetch failure API")
        let generation = threeD.coordinator.beginGraphLoad(attempt: 73)
        let didLoad = try await awaitThreeDBooleanResult(
            "window.brainBarLoadGraphFromURL('brainbar3d://resources/graph.json?digest=wrong', 'brainbar3d://resources/graph-metadata.json?digest=wrong', 'all', \(generation))",
            in: threeD.webView
        )
        XCTAssertFalse(didLoad)

        let deadline = Date().addingTimeInterval(2)
        while loadEvents.count < 2 && Date() < deadline {
            await Task.yield()
        }
        XCTAssertEqual(loadEvents, [.loading, .failed(.rendererFailed)])
        XCTAssertFalse(threeD.coordinator.graphReady)
        XCTAssertFalse(diagnostics.joined(separator: " ").contains(sentinel))
        await quiesceRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DGatedReloadCommitsOnlyLatestPreparedSnapshot() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphDirectory = directory.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try #"{"nodes":[{"id":"placeholder"}],"edges":[]}"#.write(to: graphURL, atomically: true, encoding: .utf8)
        let firstPayload = #"{"nodes":[{"id":"node-a","label":"A"}],"edges":[]}"#
        let secondPayload = #"{"nodes":[{"id":"node-b","label":"B"}],"edges":[]}"#
        let gate = GraphDataLoaderGate()
        let store = GraphDataStore(dataLoader: { url in
            await gate.load(url)
        })
        let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory, graphDataStore: store)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        threeD.coordinator.prepareGraph(url: graphURL, policy: .normal, attempt: 41, in: threeD.webView)
        let firstDeadline = Date().addingTimeInterval(2)
        while await gate.waiterCount() < 1 && Date() < firstDeadline {
            await Task.yield()
        }
        let firstWaiterCount = await gate.waiterCount()
        XCTAssertEqual(firstWaiterCount, 1)
        threeD.coordinator.prepareGraph(url: graphURL, policy: .retry, attempt: 42, in: threeD.webView)
        let secondDeadline = Date().addingTimeInterval(2)
        while await gate.waiterCount() < 2 && Date() < secondDeadline {
            await Task.yield()
        }
        let secondWaiterCount = await gate.waiterCount()
        XCTAssertEqual(secondWaiterCount, 2)
        await gate.resumeLast(with: Data(secondPayload.utf8))
        let navigationDeadline = Date().addingTimeInterval(2)
        while threeD.coordinator.indexURL == nil && Date() < navigationDeadline {
            await Task.yield()
        }
        guard threeD.coordinator.indexURL != nil else {
            throw BrainBarError.processFailed("Latest gated preparation did not create a digest-bound renderer navigation.")
        }
        threeD.coordinator.reloadIndexForTesting(
            try rendererTestIndexURL(for: threeD.coordinator),
            in: threeD.webView
        )
        try await waitForRendererFunction(
            "brainBarLoadGraphFromURL",
            in: threeD.webView,
            phase: "latest gated 3D test renderer API"
        )
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest gated 3D graph") {
            diagnosticCount($0, "queryableNodes") == 1 && diagnosticBool($0, "paintedCountsSettled") == true
        }
        let graphURLForLatest = try graphSchemeURL(for: threeD.coordinator)
        let loadedGraph = try await callAsyncJavaScriptString(
            "const response = await fetch(\(Graph3DWebView.jsStringLiteral(graphURLForLatest))); return await response.text();",
            in: threeD.webView
        )
        XCTAssertEqual(loadedGraph, secondPayload)

        await gate.resumeFirst(with: Data(firstPayload.utf8))
        await Task.yield()
        let retainedGraph = try await callAsyncJavaScriptString(
            "const response = await fetch(\(Graph3DWebView.jsStringLiteral(graphURLForLatest))); return await response.text();",
            in: threeD.webView
        )
        XCTAssertEqual(retainedGraph, secondPayload)
        try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DCoordinatorIgnoresLateGraphReadyAfterReload() {
        let coordinator = Graph3DWebView.Coordinator(onDiagnostic: { _ in }, onOpenNode: { _ in })
        let firstGeneration = coordinator.beginGraphLoad()
        XCTAssertTrue(coordinator.acceptsGraphReady(generation: firstGeneration))
        XCTAssertTrue(coordinator.graphReady)

        let replacementGeneration = coordinator.beginGraphLoad()

        XCTAssertEqual(firstGeneration + 1, replacementGeneration)
        XCTAssertFalse(coordinator.acceptsGraphReady(generation: firstGeneration))
        XCTAssertFalse(coordinator.graphReady)
        XCTAssertTrue(coordinator.acceptsGraphReady(generation: replacementGeneration))
        XCTAssertTrue(coordinator.graphReady)
    }

    @MainActor
    func testGraph3DCoordinatorRejectsStaleRendererDiagnosticAfterReload() async {
        var loadEvents: [GraphRendererLoadEvent] = []
        let coordinator = Graph3DWebView.Coordinator(
            onDiagnostic: { _ in },
            onLoadEvent: { event, _ in loadEvents.append(event) },
            onOpenNode: { _ in }
        )
        let firstGeneration = coordinator.beginGraphLoad(attempt: 31)
        let replacementGeneration = coordinator.beginGraphLoad(attempt: 32)
        let sentinel = "GRAPH_3D_DIAGNOSTIC_PRIVACY_SENTINEL"

        XCTAssertFalse(coordinator.acceptsRendererDiagnostic(generation: firstGeneration))
        XCTAssertTrue(coordinator.acceptsRendererDiagnostic(generation: replacementGeneration))
        coordinator.receiveRendererDiagnostic(message: sentinel, generation: firstGeneration)
        await Task.yield()
        XCTAssertEqual(loadEvents, [.loading, .loading])

        coordinator.receiveRendererDiagnostic(message: sentinel, generation: replacementGeneration)
        await Task.yield()
        XCTAssertEqual(loadEvents, [.loading, .loading, .failed(.rendererFailed)])
        XCTAssertFalse(String(describing: loadEvents).contains(sentinel))
    }

    func testGraphDataStoreAcceptsIdlessAliasesAndKeepsSemanticFingerprintStableAcrossReorder() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: vault.appendingPathComponent("Notes"), withIntermediateDirectories: true)
        try "note".write(to: vault.appendingPathComponent("Notes/A.md"), atomically: true, encoding: .utf8)
        let original = #"""
        {
          "nodes": [
            { "id": "node-a", "label": "A", "community": "One", "source_file": "Notes/A.md" },
            { "id": "node-b", "label": "B", "community": "One" }
          ],
          "links": [
            { "from": { "id": "node-a" }, "to": "node-b", "context": "linked", "source_location": "12:4" },
            { "from": "node-a", "to": "node-b", "context": "linked", "source_location": "12:4" },
            { "source": "node-b", "target": "node-a", "relation": "linked" }
          ]
        }
        """#
        let reordered = #"""
        {
          "nodes": [
            { "id": "node-b", "label": "B", "community": "One" },
            { "id": "node-a", "label": "A", "community": "One", "source_file": "Notes/A.md" }
          ],
          "links": [
            { "source": "node-b", "target": "node-a", "relation": "linked" },
            { "from": "node-a", "to": "node-b", "context": "linked", "source_location": "12:4" },
            { "from": { "id": "node-a" }, "to": "node-b", "context": "linked", "source_location": "12:4" }
          ]
        }
        """#
        try original.write(to: graphURL, atomically: true, encoding: .utf8)
        let store = GraphDataStore()

        guard case .ready(let first) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected idless Graphify-style links to prepare")
        }
        XCTAssertEqual(first.counts, GraphDataCounts(nodes: 2, edges: 3))
        let firstGraph = await store.resource(for: first, kind: .graph)
        let firstMetadata = await store.resource(for: first, kind: .metadata)
        XCTAssertEqual(firstGraph, Data(original.utf8))
        XCTAssertNotNil(firstMetadata)
        guard
            let firstGraph,
            let fixture = try JSONSerialization.jsonObject(with: firstGraph) as? [String: Any],
            let fixtureNodes = fixture["nodes"] as? [[String: Any]],
            let fixtureLinks = fixture["links"] as? [[String: Any]]
        else {
            return XCTFail("Expected graph resource to retain the accepted fixture")
        }
        XCTAssertEqual(Set(fixtureNodes.compactMap { $0["id"] as? String }), ["node-a", "node-b"])
        let endpointID: (Any?) -> String? = { endpoint in
            if let id = endpoint as? String {
                return id
            }
            return (endpoint as? [String: Any])?["id"] as? String
        }
        let edgeMultiset = fixtureLinks.compactMap { link -> String? in
            guard
                let source = endpointID(link["source"] ?? link["from"]),
                let target = endpointID(link["target"] ?? link["to"])
            else {
                return nil
            }
            let relation = (link["relation"] ?? link["context"]) as? String ?? ""
            return "\(source)|\(target)|\(relation)"
        }.sorted()
        XCTAssertEqual(
            edgeMultiset,
            ["node-a|node-b|linked", "node-a|node-b|linked", "node-b|node-a|linked"]
        )
        let unrelatedHandle = GraphDataHandle(
            digest: "other",
            semanticFingerprint: "other",
            counts: GraphDataCounts(nodes: 0, edges: 0),
            sourceSignature: "other"
        )
        let unrelatedGraph = await store.resource(for: unrelatedHandle, kind: .graph)
        let unrelatedMetadata = await store.resource(for: unrelatedHandle, kind: .metadata)
        XCTAssertNil(unrelatedGraph)
        XCTAssertNil(unrelatedMetadata)

        try reordered.write(to: graphURL, atomically: true, encoding: .utf8)
        guard case .ready(let second) = await store.prepare(url: graphURL, policy: .retry) else {
            return XCTFail("Expected reordered graph to prepare")
        }
        XCTAssertEqual(second.counts, GraphDataCounts(nodes: 2, edges: 3))
        XCTAssertEqual(first.semanticFingerprint, second.semanticFingerprint)
        XCTAssertNotEqual(first.digest, second.digest)
    }

    func testGraphDataStoreRawDigestMatchesKnownSHA256Vector() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let graph = #"{"nodes":[],"edges":[]}"#
        try Data(graph.utf8).write(to: graphURL)
        let store = GraphDataStore()

        guard case .ready(let handle) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected known SHA-256 fixture to prepare")
        }
        XCTAssertEqual(
            handle.digest,
            "a461bf77bc4e4d732f7afc121c70e7f70ed8bf225a082a4e01951d1eb6b5c278"
        )
    }

    func testGraphDataStoreRejectsInvalidInputWithoutReplacingPriorReadySnapshot() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let valid = #"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"from":"node-a","to":"node-b"}]}"#
        try valid.write(to: graphURL, atomically: true, encoding: .utf8)
        let store = GraphDataStore()
        guard case .ready(let ready) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected valid graph to prepare")
        }

        let sentinel = "GRAPH_DATA_STORE_PRIVACY_SENTINEL"
        let invalidCases: [(payload: String, code: GraphDataValidationCode)] = [
            ("{", .invalidJSON),
            ("[]", .invalidShape),
            (#"{"nodes":[],"edges":[],"links":[]}"#, .invalidShape),
            (#"{"nodes":[3],"edges":[]}"#, .invalidShape),
            (#"{"nodes":[],"edges":[3]}"#, .invalidShape),
            ("{\"nodes\":[{\"label\":\"\(sentinel)\"}],\"edges\":[]}", .missingNodeID),
            (#"{"nodes":[{"id":1}],"edges":[]}"#, .missingNodeID),
            (#"{"nodes":[{"id":" "}],"edges":[]}"#, .missingNodeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-a"}],"edges":[]}"#, .duplicateNodeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"id":1,"from":"node-a","to":"node-b"}]}"#, .missingEdgeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"id":null,"from":"node-a","to":"node-b"}]}"#, .missingEdgeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"id":" ","from":"node-a","to":"node-b"}]}"#, .missingEdgeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"id":"edge","from":"node-a","to":"node-b"},{"id":"edge","from":"node-a","to":"node-b"}]}"#, .duplicateEdgeID),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"to":"node-b"}]}"#, .missingEndpoint),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"from":1,"to":"node-b"}]}"#, .missingEndpoint),
            (#"{"nodes":[{"id":" a "},{"id":"node-b"}],"edges":[{"from":"a","to":"node-b"}]}"#, .missingEndpoint),
            (#"{"nodes":[{"id":"node-a"},{"id":"node-b"}],"edges":[{"from":"node-a","to":"missing"}]}"#, .missingEndpoint)
        ]

        for invalidCase in invalidCases {
            try invalidCase.payload.write(to: graphURL, atomically: true, encoding: .utf8)
            let result = await store.prepare(url: graphURL, policy: .retry)
            XCTAssertEqual(result, .failed(invalidCase.code))
            XCTAssertFalse(String(describing: result).contains(sentinel))
            let preservedGraph = await store.resource(for: ready, kind: .graph)
            XCTAssertEqual(preservedGraph, Data(valid.utf8))
        }
    }

    func testGraphDataStoreSemanticFingerprintChangesForNodeContentAndMembership() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let initial = #"{"nodes":[{"id":"node-a","label":"A"},{"id":"node-b","label":"B"}],"edges":[{"from":"node-a","to":"node-b"}]}"#
        let changedContent = #"{"nodes":[{"id":"node-a","label":"Changed"},{"id":"node-b","label":"B"}],"edges":[{"from":"node-a","to":"node-b"}]}"#
        let addedNode = #"{"nodes":[{"id":"node-a","label":"Changed"},{"id":"node-b","label":"B"},{"id":"node-c","label":"C"}],"edges":[{"from":"node-a","to":"node-b"}]}"#
        try initial.write(to: graphURL, atomically: true, encoding: .utf8)
        let store = GraphDataStore()
        guard case .ready(let first) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected initial graph to prepare")
        }

        try changedContent.write(to: graphURL, atomically: true, encoding: .utf8)
        guard case .ready(let changed) = await store.prepare(url: graphURL, policy: .retry) else {
            return XCTFail("Expected graph with changed node content to prepare")
        }
        XCTAssertNotEqual(first.semanticFingerprint, changed.semanticFingerprint)

        try addedNode.write(to: graphURL, atomically: true, encoding: .utf8)
        guard case .ready(let expanded) = await store.prepare(url: graphURL, policy: .retry) else {
            return XCTFail("Expected graph with added node to prepare")
        }
        XCTAssertNotEqual(changed.semanticFingerprint, expanded.semanticFingerprint)

        let duplicateEdge = #"{"nodes":[{"id":"node-a","label":"Changed"},{"id":"node-b","label":"B"},{"id":"node-c","label":"C"}],"edges":[{"from":"node-a","to":"node-b"},{"from":"node-a","to":"node-b"}]}"#
        try duplicateEdge.write(to: graphURL, atomically: true, encoding: .utf8)
        guard case .ready(let multiplied) = await store.prepare(url: graphURL, policy: .retry) else {
            return XCTFail("Expected graph with duplicated idless edge to prepare")
        }
        XCTAssertNotEqual(expanded.semanticFingerprint, multiplied.semanticFingerprint)
    }

    func testGraphDataStoreRetainsExactWhitespaceIdentifiers() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let graph = #"{"nodes":[{"id":" a "},{"id":"node-b"}],"edges":[{"from":" a ","to":"node-b"}]}"#
        try graph.write(to: graphURL, atomically: true, encoding: .utf8)
        let store = GraphDataStore()

        guard case .ready(let handle) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected exact nonblank whitespace identifiers to remain valid")
        }
        XCTAssertEqual(handle.counts, GraphDataCounts(nodes: 2, edges: 1))
        let rawGraph = await store.resource(for: handle, kind: .graph)
        XCTAssertEqual(rawGraph, Data(graph.utf8))
    }

    func testGraphDataStoreDoesNotReuseSameSizedSameMtimeDifferentSource() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let firstDirectory = directory.appendingPathComponent("first/graphify-out")
        let secondDirectory = directory.appendingPathComponent("second/graphify-out")
        try FileManager.default.createDirectory(at: firstDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: secondDirectory, withIntermediateDirectories: true)
        let firstURL = firstDirectory.appendingPathComponent("graph.json")
        let secondURL = secondDirectory.appendingPathComponent("graph.json")
        let firstPayload = #"{"nodes":[{"id":"node-a","label":"A"}],"edges":[]}"#
        let secondPayload = #"{"nodes":[{"id":"node-b","label":"B"}],"edges":[]}"#
        XCTAssertEqual(firstPayload.utf8.count, secondPayload.utf8.count)
        let stableModifiedAt = Date(timeIntervalSince1970: 1_700_000_000)
        try firstPayload.write(to: firstURL, atomically: true, encoding: .utf8)
        try secondPayload.write(to: secondURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: stableModifiedAt], ofItemAtPath: firstURL.path)
        try FileManager.default.setAttributes([.modificationDate: stableModifiedAt], ofItemAtPath: secondURL.path)
        let store = GraphDataStore()

        guard case .ready(let first) = await store.prepare(url: firstURL, policy: .normal),
              case .ready(let second) = await store.prepare(url: secondURL, policy: .normal)
        else {
            return XCTFail("Expected both distinct graph URLs to prepare")
        }
        XCTAssertNotEqual(first.sourceSignature, second.sourceSignature)
        XCTAssertNotEqual(first.digest, second.digest)
        let secondGraph = await store.resource(for: second, kind: .graph)
        XCTAssertEqual(secondGraph, Data(secondPayload.utf8))
    }

    func testGraphDataStoreMetadataExcludesTraversalAndOutsideSymlink() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let notesDirectory = vault.appendingPathComponent("Notes")
        let graphURL = graphDirectory.appendingPathComponent("graph.json")
        let insideURL = notesDirectory.appendingPathComponent("inside.md")
        let outside = try temporaryDirectory().appendingPathComponent("outside.md")
        defer { removeTemporaryDirectory(outside.deletingLastPathComponent()) }
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: notesDirectory, withIntermediateDirectories: true)
        try "inside".write(to: insideURL, atomically: true, encoding: .utf8)
        try "outside".write(to: outside, atomically: true, encoding: .utf8)
        let symlinkURL = notesDirectory.appendingPathComponent("outside-link.md")
        try FileManager.default.createSymbolicLink(atPath: symlinkURL.path, withDestinationPath: outside.path)
        let graph = #"{"nodes":[{"id":"inside","source_file":"Notes/inside.md"},{"id":"traversal","source_file":"../outside.md"},{"id":"symlink","source_file":"Notes/outside-link.md"}],"edges":[]}"#
        try graph.write(to: graphURL, atomically: true, encoding: .utf8)
        let store = GraphDataStore()

        guard case .ready(let handle) = await store.prepare(url: graphURL, policy: .normal),
              let metadata = await store.resource(for: handle, kind: .metadata),
              let payload = try JSONSerialization.jsonObject(with: metadata) as? [String: Any],
              let byNodeID = payload["byNodeId"] as? [String: Any]
        else {
            return XCTFail("Expected graph metadata")
        }
        XCTAssertNotNil(byNodeID["inside"])
        XCTAssertNil(byNodeID["traversal"])
        XCTAssertNil(byNodeID["symlink"])
    }

    func testGraphDataStoreRetryReadsChangedBytesWithSameSourceSignature() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let stableModifiedAt = Date(timeIntervalSince1970: 1_700_000_000)
        let firstPayload = #"{"nodes":[{"id":"node-a","label":"A"}],"edges":[]}"#
        let secondPayload = #"{"nodes":[{"id":"node-a","label":"B"}],"edges":[]}"#
        XCTAssertEqual(firstPayload.utf8.count, secondPayload.utf8.count)
        try firstPayload.write(to: graphURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: stableModifiedAt], ofItemAtPath: graphURL.path)
        let store = GraphDataStore()
        guard case .ready(let first) = await store.prepare(url: graphURL, policy: .normal) else {
            return XCTFail("Expected initial graph to prepare")
        }

        try secondPayload.write(to: graphURL, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes([.modificationDate: stableModifiedAt], ofItemAtPath: graphURL.path)
        guard case .ready(let second) = await store.prepare(url: graphURL, policy: .retry) else {
            return XCTFail("Expected retry to prepare changed bytes")
        }

        XCTAssertEqual(first.sourceSignature, second.sourceSignature)
        XCTAssertNotEqual(first.digest, second.digest)
        let retriedGraph = await store.resource(for: second, kind: .graph)
        XCTAssertEqual(retriedGraph, Data(secondPayload.utf8))
    }

    func testGraphDataStoreSupersedesHeldOlderPrepareAndCommitsOnlyLatestData() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphURL = directory.appendingPathComponent("graph.json")
        let firstPayload = #"{"nodes":[{"id":"node-a"}],"edges":[]}"#
        let secondPayload = #"{"nodes":[{"id":"node-b"}],"edges":[]}"#
        try firstPayload.write(to: graphURL, atomically: true, encoding: .utf8)
        let gate = GraphDataLoaderGate()
        let store = GraphDataStore(dataLoader: { url in
            await gate.load(url)
        })

        let firstTask = Task {
            await store.prepare(url: graphURL, policy: .normal)
        }
        let firstDeadline = Date().addingTimeInterval(2)
        while await gate.waiterCount() < 1 && Date() < firstDeadline {
            await Task.yield()
        }
        let firstWaiterCount = await gate.waiterCount()
        XCTAssertEqual(firstWaiterCount, 1)

        let secondTask = Task {
            await store.prepare(url: graphURL, policy: .retry)
        }
        let secondDeadline = Date().addingTimeInterval(2)
        while await gate.waiterCount() < 2 && Date() < secondDeadline {
            await Task.yield()
        }
        let secondWaiterCount = await gate.waiterCount()
        XCTAssertEqual(secondWaiterCount, 2)
        await gate.resumeLast(with: Data(secondPayload.utf8))

        guard case .ready(let latest) = await secondTask.value else {
            return XCTFail("Expected newest gated prepare to commit")
        }
        let latestGraph = await store.resource(for: latest, kind: .graph)
        XCTAssertEqual(latestGraph, Data(secondPayload.utf8))

        await gate.resumeFirst(with: Data(firstPayload.utf8))
        let firstResult = await firstTask.value
        XCTAssertEqual(firstResult, .superseded)
        let retainedLatestGraph = await store.resource(for: latest, kind: .graph)
        XCTAssertEqual(retainedLatestGraph, Data(secondPayload.utf8))
    }

    @MainActor
    func testAppModelGraphLoadEventsAcceptOnlyLatestAttemptPerRenderer() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, surface: .focus, attempt: 1)
        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, surface: .focus, attempt: 2)
        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(.failed(.rendererFailed), renderer: .threeD, surface: .focus, attempt: 1)

        XCTAssertEqual(model.graphLoadState(for: .threeD, surface: .focus), .loading(attempt: 2, previousReadyAttempt: nil))
        XCTAssertEqual(model.graphLoadState(for: .twoD, surface: .focus), .idle)

        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, surface: .focus, attempt: 2)
        XCTAssertEqual(model.graphLoadState(for: .threeD, surface: .focus), .ready(attempt: 2))

        model.handleGraphRendererLoadEvent(.failed(.rendererFailed), renderer: .threeD, surface: .focus, attempt: 2)
        XCTAssertEqual(
            model.graphLoadState(for: .threeD, surface: .focus),
            .failed(attempt: 2, reason: .rendererFailed, previousReadyAttempt: 2)
        )

        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 2)
        model.handleGraphRendererLoadEvent(.failed(.navigationFailed), renderer: .twoD, surface: .focus, attempt: 2)

        XCTAssertEqual(
            model.graphLoadState(for: .threeD, surface: .focus),
            .failed(attempt: 2, reason: .rendererFailed, previousReadyAttempt: 2)
        )
        XCTAssertEqual(
            model.graphLoadState(for: .twoD, surface: .focus),
            .failed(attempt: 2, reason: .navigationFailed, previousReadyAttempt: nil)
        )
    }

    @MainActor
    func testAppModelGraphLoadStatesAreIndependentPerTwoDSurface() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .popover, attempt: 1)
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(.ready, renderer: .twoD, surface: .focus, attempt: 1)

        XCTAssertEqual(model.graphLoadState(for: .twoD, surface: .focus), .ready(attempt: 1))
        XCTAssertEqual(model.graphLoadState(for: .twoD, surface: .popover), .loading(attempt: 1, previousReadyAttempt: nil))

        model.handleGraphRendererLoadEvent(.failed(.rendererFailed), renderer: .twoD, surface: .popover, attempt: 1)

        XCTAssertEqual(model.graphLoadState(for: .twoD, surface: .focus), .ready(attempt: 1))
        XCTAssertEqual(
            model.graphLoadState(for: .twoD, surface: .popover),
            .failed(attempt: 1, reason: .rendererFailed, previousReadyAttempt: nil)
        )
    }

    @MainActor
    func testAppModelMissingTwoDRuntimeInCurrentFocusFallsBackToThreeDOnce() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        model.status.graphJSONExists = true
        model.setGraphViewMode(.twoD)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .focus,
            attempt: 1,
            threeDRendererAvailable: true
        )

        let recoveryMessage = model.errorMessage
        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertEqual(model.graphReloadToken, 1)
        XCTAssertTrue(recoveryMessage?.contains("switched to the local 3D graph") == true)
        XCTAssertEqual(
            model.graphLoadState(for: .twoD, surface: .focus),
            .failed(attempt: 1, reason: .twoDRuntimeUnavailable, previousReadyAttempt: nil)
        )

        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .focus,
            attempt: 1,
            threeDRendererAvailable: true
        )

        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertEqual(model.graphReloadToken, 1)
        XCTAssertEqual(model.errorMessage, recoveryMessage)
    }

    @MainActor
    func testAppModelMissingTwoDRuntimeInPopoverReportsCompatibilityWithoutLoop() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        model.status.graphJSONExists = true
        model.setGraphViewMode(.twoD)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .popover, attempt: 1)
        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .popover,
            attempt: 1,
            threeDRendererAvailable: true
        )

        let compatibilityMessage = model.errorMessage
        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertEqual(model.graphReloadToken, 1)
        XCTAssertTrue(compatibilityMessage?.contains("popover can’t host the 3D renderer") == true)

        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .popover,
            attempt: 1,
            threeDRendererAvailable: true
        )

        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertEqual(model.graphReloadToken, 1)
        XCTAssertEqual(model.errorMessage, compatibilityMessage)
    }

    @MainActor
    func testAppModelStaleTwoDRuntimeFailureDoesNotChangeRenderer() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        model.status.graphJSONExists = true
        model.setGraphViewMode(.twoD)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 1)
        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 2)
        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .focus,
            attempt: 1,
            threeDRendererAvailable: true
        )

        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertNil(model.errorMessage)
        XCTAssertEqual(
            model.graphLoadState(for: .twoD, surface: .focus),
            .loading(attempt: 2, previousReadyAttempt: nil)
        )
    }

    @MainActor
    func testAppModelTwoDRuntimeFailureNeedsGraphJSONAndGenericFailuresNeverFallback() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        model.setGraphViewMode(.twoD)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(
            .failed(.twoDRuntimeUnavailable),
            renderer: .twoD,
            surface: .focus,
            attempt: 1,
            threeDRendererAvailable: true
        )

        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertNil(model.errorMessage)

        model.status.graphJSONExists = true
        model.retryGraphLoad()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 2)
        model.handleGraphRendererLoadEvent(
            .failed(.navigationFailed),
            renderer: .twoD,
            surface: .focus,
            attempt: 2,
            threeDRendererAvailable: true
        )
        XCTAssertEqual(model.graphViewMode, .twoD)

        model.retryGraphLoad()
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .focus, attempt: 3)
        model.handleGraphRendererLoadEvent(
            .failed(.validation(.invalidJSON)),
            renderer: .twoD,
            surface: .focus,
            attempt: 3,
            threeDRendererAvailable: true
        )
        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor
    func testAppModelGraphLoadRetryMarksReadyGraphStaleAndRecovers() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 1)
        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, attempt: 1)

        model.retryGraphLoad()

        XCTAssertEqual(model.graphReloadToken, 2)
        XCTAssertEqual(model.graphLoadState(for: .threeD), .stale(readyAttempt: 1, availableAttempt: 2))

        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 2)
        model.handleGraphRendererLoadEvent(.failed(.rendererFailed), renderer: .threeD, attempt: 2)

        XCTAssertEqual(
            model.graphLoadState(for: .threeD),
            .failed(attempt: 2, reason: .rendererFailed, previousReadyAttempt: 1)
        )

        model.retryGraphLoad()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 3)
        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, attempt: 3)

        XCTAssertEqual(model.graphReloadToken, 3)
        XCTAssertEqual(model.graphLoadState(for: .threeD), .ready(attempt: 3))
    }

    @MainActor
    func testAppModelGraphLoadCancellationIsCurrentAndSurfaceScoped() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(.loading, renderer: .twoD, surface: .popover, attempt: 1)
        model.cancelGraphLoad(renderer: .threeD, surface: .focus)

        XCTAssertEqual(
            model.graphLoadState(for: .threeD, surface: .focus),
            .cancelled(attempt: 1, previousReadyAttempt: nil)
        )
        XCTAssertEqual(
            model.graphLoadCancellationRequest(for: .threeD, surface: .focus)?.attempt,
            1
        )
        XCTAssertEqual(
            model.graphLoadState(for: .twoD, surface: .popover),
            .loading(attempt: 1, previousReadyAttempt: nil)
        )

        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, surface: .focus, attempt: 1)
        model.handleGraphRendererLoadEvent(.failed(.rendererFailed), renderer: .threeD, surface: .focus, attempt: 1)
        XCTAssertEqual(
            model.graphLoadState(for: .threeD, surface: .focus),
            .cancelled(attempt: 1, previousReadyAttempt: nil)
        )
    }

    @MainActor
    func testAppModelCancellationPreservesPreviousReadyAndRetryCreatesAttempt() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.reloadGraphView()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 1)
        model.handleGraphRendererLoadEvent(.ready, renderer: .threeD, attempt: 1)
        model.retryGraphLoad()
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 2)
        model.cancelGraphLoad(renderer: .threeD)

        XCTAssertEqual(
            model.graphLoadState(for: .threeD),
            .cancelled(attempt: 2, previousReadyAttempt: 1)
        )

        model.retryGraphLoad()
        XCTAssertEqual(model.graphReloadToken, 3)
        model.handleGraphRendererLoadEvent(.loading, renderer: .threeD, attempt: 3)
        XCTAssertEqual(
            model.graphLoadState(for: .threeD),
            .loading(attempt: 3, previousReadyAttempt: 1)
        )
    }

    @MainActor
    func testGraphCoordinatorsCancelWithoutReportingFailure() async {
        var threeDEvents: [GraphRendererLoadEvent] = []
        let threeD = Graph3DWebView.Coordinator(
            onDiagnostic: { _ in },
            onLoadEvent: { event, _ in threeDEvents.append(event) },
            onOpenNode: { _ in }
        )
        let threeDWebView = WKWebView()
        let generation = threeD.beginGraphLoad(attempt: 51)
        XCTAssertTrue(threeD.cancelGraphLoadIfNeeded(
            GraphLoadCancellationRequest(id: 1, attempt: 51),
            in: threeDWebView
        ))
        XCTAssertTrue(threeD.isGraphLoadCancelled(attempt: 51))
        XCTAssertFalse(threeD.acceptsGraphReady(generation: generation))
        threeD.webViewWebContentProcessDidTerminate(threeDWebView)

        var twoDEvents: [GraphRendererLoadEvent] = []
        let twoD = GraphWebView.Coordinator(
            onLoadEvent: { event, _ in twoDEvents.append(event) },
            onOpenNode: { _ in }
        )
        let twoDWebView = WKWebView()
        twoD.beginGraphLoad(attempt: 52)
        XCTAssertTrue(twoD.cancelGraphLoadIfNeeded(
            GraphLoadCancellationRequest(id: 2, attempt: 52),
            in: twoDWebView
        ))
        XCTAssertTrue(twoD.isGraphLoadCancelled(attempt: 52))
        twoD.webViewWebContentProcessDidTerminate(twoDWebView)

        await Task.yield()
        XCTAssertEqual(threeDEvents, [.loading])
        XCTAssertEqual(twoDEvents, [.loading])
    }

    @MainActor
    func testGraph3DAsyncBootReplaysLensActivityAndViewportAfterGraphReady() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        let activity = AgentActivityEvent(
            id: "activity-node-c",
            agent: "codex",
            action: .focus,
            path: "Notes/Beacon.md",
            timestamp: Date(timeIntervalSince1970: 1_700_000_000),
            nodeId: "node-c"
        )
        let mappedActivity = AgentActivityMappedEvent(
            event: activity,
            node: AgentActivityGraphNode(id: "node-c", label: "Beacon", sourceFile: "Notes/Beacon.md")
        )
        let workflow = AgentActivityWorkflow(
            id: "workflow:async-boot",
            workflowId: "async-boot",
            sessionId: nil,
            title: "Async boot",
            status: "completed",
            trail: [],
            sourcePaths: [],
            outputPaths: ["Notes/Beacon.md"],
            touchedPaths: [],
            nodeIds: ["node-c"],
            pendingPaths: [],
            firstEventAt: activity.timestamp,
            lastEventAt: activity.timestamp
        )
        threeD.coordinator.sourceLens = .graphify
        threeD.coordinator.agentActivitySnapshot = AgentActivitySnapshot(
            events: [mappedActivity],
            nodeIds: ["node-c"],
            pendingPaths: [],
            lastEventAt: activity.timestamp,
            eventLogPath: "",
            codexIntegrationInstalled: true,
            claudeIntegrationInstalled: false,
            claudeIntegrationPartial: false,
            tracingEnabled: true,
            workflows: [workflow]
        )
        threeD.coordinator.workflowSelectionID = workflow.id
        threeD.coordinator.pendingViewportCommand = GraphViewportCommand(
            id: 1,
            kind: .revealNode3D,
            payload: "node-c"
        )

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        let diagnostics = try await waitForRendererDiagnostics(
            in: threeD.webView,
            functionName: "brainBarRendererDiagnostics",
            phase: "3D graph-ready state replay"
        ) {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticCount($0, "selectedNodeCount") == 1 &&
            diagnosticCount($0, "agentActivityEventCount") == 1 &&
            diagnosticCount($0, "agentActivityRenderableCount") == 1 &&
            diagnosticCount($0, "workflowHighlightNodeCount") == 1 &&
            diagnosticCount($0, "workflowHighlightPendingPathCount") == 0 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        assertRendererDiagnosticsAreContentFree(diagnostics)
        try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DLayoutResponsivenessProbeUsesRealSchemeWithoutAutoLoad() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "3D layout responsiveness API")
        let beforeProbe = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "3D layout responsiveness pre-probe") {
            diagnosticString($0, "activeMode") != nil
        }
        XCTAssertEqual(diagnosticCount(beforeProbe, "queryableNodes"), 0)
        XCTAssertEqual(diagnosticCount(beforeProbe, "queryableEdges"), 0)
        let probe = try await invokeThreeDLayoutResponsivenessProbe(
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            in: threeD.webView
        )

        XCTAssertTrue(probe.didSucceed)
        XCTAssertTrue(probe.callReturnMs.isFinite)
        XCTAssertTrue(probe.zeroDelayTimerProbeMs.isFinite)
        let diagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "3D layout responsiveness graph") {
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3 &&
            diagnosticString($0, "layoutState") == "committed"
        }
        assertRendererDiagnosticsAreContentFree(diagnostics)
        await quiesceRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DLayoutCacheReusesCoordinatesAndFallsBackSafely() async throws {
        await clearRendererLayoutCache()
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let first = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let firstHost = RendererWebViewHost(webView: first.webView)
        var didCloseFirstHost = false
        defer {
            if !didCloseFirstHost {
                firstHost.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }

        try await prepareThreeDGraph(first, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: first.webView, phase: "initial layout cache page")
        try await navigateToTestPage(
            try layoutCacheTestIndexURL(for: first.coordinator, mode: "enable"),
            queryItem: "layout-cache-test",
            value: "enable",
            in: first.webView
        )
        try await waitForRendererObject("__brainBarLayoutCacheTest", in: first.webView, phase: "layout cache test API")
        let didClearFirstCache = try await awaitThreeDBooleanResult("window.__brainBarLayoutCacheTest.clear()", in: first.webView)
        XCTAssertTrue(didClearFirstCache)
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarCachedFirst",
            graphURL: try graphSchemeURL(for: first.coordinator),
            lens: "all",
            generation: 701,
            in: first.webView
        )
        let didLoadFirstCache = try await awaitThreeDBooleanResult("window.__brainBarCachedFirst", in: first.webView)
        XCTAssertTrue(didLoadFirstCache)
        let firstDiagnostics = try await waitForRendererDiagnostics(in: first.webView, functionName: "brainBarRendererDiagnostics", phase: "layout cache first worker") {
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticString($0, "layoutCache") == "stored"
        }
        let firstSnapshot = try await layoutCacheSnapshot(in: first.webView)
        XCTAssertEqual(firstSnapshot.count, 4)
        XCTAssertNotEqual(firstSnapshot.fingerprint, "")
        assertRendererDiagnosticsAreContentFree(firstDiagnostics)
        try await quiesceThreeDRendererWebView(first.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        try await closeThreeDRendererTestHost(firstHost, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        didCloseFirstHost = true

        let second = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let secondHost = RendererWebViewHost(webView: second.webView)
        var didCloseSecondHost = false
        defer {
            if !didCloseSecondHost {
                secondHost.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }
        try await prepareThreeDGraph(second, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: second.webView, phase: "initial fresh cache page")
        try await navigateToTestPage(
            try layoutCacheTestIndexURL(for: second.coordinator, mode: "enable"),
            queryItem: "layout-cache-test",
            value: "enable",
            in: second.webView
        )
        try await waitForRendererObject("__brainBarLayoutCacheTest", in: second.webView, phase: "fresh layout cache API")
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarCachedSecond",
            graphURL: try graphSchemeURL(for: second.coordinator),
            lens: "all",
            generation: 702,
            in: second.webView
        )
        let didLoadSecondCache = try await awaitThreeDBooleanResult("window.__brainBarCachedSecond", in: second.webView)
        XCTAssertTrue(didLoadSecondCache)
        let hitDiagnostics = try await waitForRendererDiagnostics(in: second.webView, functionName: "brainBarRendererDiagnostics", phase: "fresh layout cache hit") {
            diagnosticString($0, "layoutState") == "committed" && diagnosticString($0, "layoutCache") == "hit"
        }
        let secondSnapshot = try await layoutCacheSnapshot(in: second.webView)
        XCTAssertEqual(secondSnapshot, firstSnapshot)
        XCTAssertEqual(diagnosticCount(hitDiagnostics, "queryableNodes"), 4)
        XCTAssertEqual(diagnosticCount(hitDiagnostics, "queryableEdges"), 3)
        XCTAssertEqual(diagnosticDouble(hitDiagnostics, "layoutWorkerComputeMs"), 0)
        assertRendererDiagnosticsAreContentFree(hitDiagnostics)

        let didApplyGraphify = try await awaitThreeDGraphOperation(
            "window.brainBarApplyGraphLens('graphify', 703)",
            action: "layout cache lens miss",
            in: second.webView
        )
        XCTAssertTrue(didApplyGraphify)
        let lensMissDiagnostics = try await waitForRendererDiagnostics(in: second.webView, functionName: "brainBarRendererDiagnostics", phase: "layout cache lens miss") {
            diagnosticString($0, "lens") == "graphify" && diagnosticString($0, "layoutCache") == "stored"
        }
        XCTAssertNotEqual(diagnosticString(lensMissDiagnostics, "layoutCache"), "hit")
        let didRemoveCacheMetadata = try await awaitThreeDBooleanResult("window.__brainBarLayoutCacheTest.missingMetadata()", in: second.webView)
        XCTAssertTrue(didRemoveCacheMetadata)
        assertRendererDiagnosticsAreContentFree(lensMissDiagnostics)
        try await quiesceThreeDRendererWebView(second.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        try await closeThreeDRendererTestHost(secondHost, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        didCloseSecondHost = true

        let corrupted = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let corruptedHost = RendererWebViewHost(webView: corrupted.webView)
        var didCloseCorruptedHost = false
        defer {
            if !didCloseCorruptedHost {
                corruptedHost.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }
        try await prepareThreeDGraph(corrupted, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: corrupted.webView, phase: "initial corrupt cache page")
        try await navigateToTestPage(
            try layoutCacheTestIndexURL(for: corrupted.coordinator, mode: "enable"),
            queryItem: "layout-cache-test",
            value: "enable",
            in: corrupted.webView
        )
        try await waitForRendererObject("__brainBarLayoutCacheTest", in: corrupted.webView, phase: "corrupt cache API")
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarCorruptCache",
            graphURL: try graphSchemeURL(for: corrupted.coordinator),
            lens: "graphify",
            generation: 704,
            in: corrupted.webView
        )
        let didLoadCorruptFallback = try await awaitThreeDBooleanResult("window.__brainBarCorruptCache", in: corrupted.webView)
        XCTAssertTrue(didLoadCorruptFallback)
        let corruptFallbackDiagnostics = try await waitForRendererDiagnostics(in: corrupted.webView, functionName: "brainBarRendererDiagnostics", phase: "corrupt cache fallback") {
            diagnosticString($0, "layoutState") == "committed" && diagnosticString($0, "layoutCache") == "stored"
        }
        XCTAssertNotEqual(diagnosticString(corruptFallbackDiagnostics, "layoutCache"), "hit")
        assertRendererDiagnosticsAreContentFree(corruptFallbackDiagnostics)
        let didCorruptCacheMetadata = try await awaitThreeDBooleanResult("window.__brainBarLayoutCacheTest.corruptMetadata()", in: corrupted.webView)
        XCTAssertTrue(didCorruptCacheMetadata)
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarCorruptMetadataCache",
            graphURL: try graphSchemeURL(for: corrupted.coordinator),
            lens: "graphify",
            generation: 705,
            in: corrupted.webView
        )
        let didLoadCorruptMetadataFallback = try await awaitThreeDBooleanResult("window.__brainBarCorruptMetadataCache", in: corrupted.webView)
        XCTAssertTrue(didLoadCorruptMetadataFallback)
        let corruptMetadataFallbackDiagnostics = try await waitForRendererDiagnostics(in: corrupted.webView, functionName: "brainBarRendererDiagnostics", phase: "corrupt metadata cache fallback") {
            diagnosticString($0, "layoutState") == "committed" && diagnosticString($0, "layoutCache") == "stored"
        }
        XCTAssertNotEqual(diagnosticString(corruptMetadataFallbackDiagnostics, "layoutCache"), "hit")
        assertRendererDiagnosticsAreContentFree(corruptMetadataFallbackDiagnostics)
        try await navigateToTestPage(
            try layoutCacheTestIndexURL(for: corrupted.coordinator, mode: "unavailable"),
            queryItem: "layout-cache-test",
            value: "unavailable",
            in: corrupted.webView
        )
        try await waitForRendererFunction("brainBarLoadGraph", in: corrupted.webView, phase: "unavailable cache API")
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarUnavailableCache",
            graphURL: try graphSchemeURL(for: corrupted.coordinator),
            lens: "all",
            generation: 706,
            in: corrupted.webView
        )
        let didLoadUnavailableFallback = try await awaitThreeDBooleanResult("window.__brainBarUnavailableCache", in: corrupted.webView)
        XCTAssertTrue(didLoadUnavailableFallback)
        let unavailableFallbackDiagnostics = try await waitForRendererDiagnostics(in: corrupted.webView, functionName: "brainBarRendererDiagnostics", phase: "unavailable cache fallback") {
            diagnosticString($0, "layoutState") == "committed" && diagnosticString($0, "layoutCache") == "disabled"
        }
        XCTAssertNotEqual(diagnosticString(unavailableFallbackDiagnostics, "layoutCache"), "hit")
        assertRendererDiagnosticsAreContentFree(unavailableFallbackDiagnostics)
        try await closeThreeDRendererTestHost(corruptedHost, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        didCloseCorruptedHost = true
    }

    @MainActor
    func testGraph3DStaleLayoutCacheLookupCannotCommitOverLatestLens() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        var didCloseHost = false
        defer {
            if !didCloseHost {
                host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }
        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "initial held cache page")
        try await navigateToTestPage(
            try layoutCacheTestIndexURL(for: threeD.coordinator, mode: "hold"),
            queryItem: "layout-cache-test",
            value: "hold",
            in: threeD.webView
        )
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "held cache renderer API")
        try await waitForRendererObject("__brainBarLayoutCacheTest", in: threeD.webView, phase: "held cache API")
        // Hold mode pauses before IndexedDB is read, so pre-existing shared cache
        // contents cannot affect the latest-wins race asserted below. Avoid deleting
        // the shared IndexedDB database here: other hosted renderer tests may hold a
        // connection while this test is scheduled in the full suite.
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarHeldCacheFirst",
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            lens: "all",
            generation: 711,
            in: threeD.webView
        )
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "held all cache lookup") {
            diagnosticString($0, "layoutState") == "holding-cache" && diagnosticString($0, "lens") == "all"
        }
        try await beginThreeDGraphOperation(
            "window.__brainBarHeldCacheSecond = window.brainBarApplyGraphLens('graphify', 712)",
            in: threeD.webView
        )
        try await waitForHeldLayoutCacheLookup(lens: "graphify", generation: 712, in: threeD.webView)
        let results = try await releaseHeldCacheAndAwaitOperationResults(in: threeD.webView)
        XCTAssertTrue(results.release, "Held cache release did not target the latest request.")
        XCTAssertFalse(results.first, "Superseded cache-backed load committed after the newer lens request.")
        XCTAssertTrue(results.second, "Latest cache-backed lens request did not commit after release.")
        let diagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest cache lookup commit") {
            diagnosticString($0, "layoutState") == "committed" && diagnosticString($0, "lens") == "graphify"
        }
        XCTAssertEqual(diagnosticCount(diagnostics, "visibleNodes"), 3)
        XCTAssertEqual(diagnosticCount(diagnostics, "visibleEdges"), 2)
        assertRendererDiagnosticsAreContentFree(diagnostics)
        try await closeThreeDRendererTestHost(host, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        didCloseHost = true
    }

    @MainActor
    func testGraph3DLensChangeBeforeReadyReplaysOnlyAfterLatestCommittedLayout() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDRendererWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        var didCloseHost = false
        defer {
            if !didCloseHost {
                host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            }
        }

        let activity = AgentActivityEvent(
            id: "activity-node-c-race",
            agent: "codex",
            action: .focus,
            path: "Notes/Beacon.md",
            timestamp: Date(timeIntervalSince1970: 1_700_000_000),
            nodeId: "node-c"
        )
        let mappedActivity = AgentActivityMappedEvent(
            event: activity,
            node: AgentActivityGraphNode(id: "node-c", label: "Beacon", sourceFile: "Notes/Beacon.md")
        )
        threeD.coordinator.agentActivitySnapshot = AgentActivitySnapshot(
            events: [mappedActivity],
            nodeIds: ["node-c"],
            pendingPaths: [],
            lastEventAt: activity.timestamp,
            eventLogPath: "",
            codexIntegrationInstalled: true,
            claudeIntegrationInstalled: false,
            claudeIntegrationPartial: false,
            tracingEnabled: true
        )
        threeD.coordinator.pendingViewportCommand = GraphViewportCommand(
            id: 41,
            kind: .revealNode3D,
            payload: "node-c"
        )

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        threeD.coordinator.activeNavigation = threeD.webView.load(
            URLRequest(url: try workerTestIndexURL(mode: "holdResult"))
        )
        let initialHolding = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "initial held 3D layout") {
            diagnosticString($0, "lens") == "all" &&
            diagnosticString($0, "layoutState") == "holding" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3
        }
        XCTAssertFalse(threeD.coordinator.graphReady)
        let graphReadyWhileInitialLayoutHeld = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyWhileInitialLayoutHeld)
        XCTAssertEqual(diagnosticCount(initialHolding, "agentActivityEventCount"), 0)
        XCTAssertEqual(diagnosticCount(initialHolding, "selectedNodeCount"), 0)

        threeD.coordinator.sourceLens = .graphify
        threeD.coordinator.applyLens(.graphify, in: threeD.webView)
        let latestHolding = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest held 3D lens") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "holding" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3
        }
        XCTAssertFalse(threeD.coordinator.graphReady)
        let graphReadyWhileLatestLayoutHeld = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyWhileLatestLayoutHeld)
        XCTAssertEqual(diagnosticCount(latestHolding, "agentActivityEventCount"), 0)
        XCTAssertEqual(diagnosticCount(latestHolding, "selectedNodeCount"), 0)

        let didReleaseHeldLayout = try await releaseHeldLayoutWorkerResult(in: threeD.webView)
        XCTAssertTrue(didReleaseHeldLayout)
        let final = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest committed 3D lens") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3 &&
            diagnosticCount($0, "visibleNodes") == 3 &&
            diagnosticCount($0, "visibleEdges") == 2 &&
            diagnosticCount($0, "agentActivityEventCount") == 1 &&
            diagnosticCount($0, "agentActivityRenderableCount") == 1 &&
            diagnosticCount($0, "selectedNodeCount") == 1 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        try await waitForCoordinatorGraphReady(threeD.coordinator)
        let graphReadyAfterLatestCommit = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertTrue(graphReadyAfterLatestCommit)
        assertRendererDiagnosticsAreContentFree(final)
        try await closeThreeDRendererTestHost(host, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
        didCloseHost = true
    }

    @MainActor
    func testGraph3DGraphAbsentLensDefersToLatestGenerationWithoutEmptyReady() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let recorder = GraphReadyEventRecorder()
        let threeD = try makeThreeDWorkerTestWebView(graphDirectory: graphDirectory, graphReadyRecorder: recorder)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        threeD.webView.load(URLRequest(url: try workerTestIndexURL(mode: "holdResult")))
        try await waitForRendererFunction("brainBarApplyGraphLens", in: threeD.webView, phase: "graph-absent lens API installation")
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "graph-absent precondition") {
            diagnosticCount($0, "queryableNodes") == 0 && diagnosticCount($0, "queryableEdges") == 0
        }
        let didApplyAbsentGraphLens = try await awaitThreeDGraphOperation(
            "window.brainBarApplyGraphLens('graphify', 202)",
            action: "graph-absent lens",
            in: threeD.webView
        )
        XCTAssertFalse(didApplyAbsentGraphLens)
        let graphAbsent = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "graph-absent lens") {
            diagnosticCount($0, "queryableNodes") == 0 &&
            diagnosticCount($0, "queryableEdges") == 0 &&
            diagnosticString($0, "layoutState") != "committed"
        }
        XCTAssertNotEqual(diagnosticString(graphAbsent, "layoutState"), "committed")
        XCTAssertEqual(recorder.graphReadyGenerations, [])
        let graphReadyWithoutGraph = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyWithoutGraph)

        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarGraphAfterAbsentLens",
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            lens: "all",
            generation: 201,
            in: threeD.webView
        )
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "held graph after absent lens") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "holding" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3
        }
        XCTAssertEqual(recorder.graphReadyGenerations, [])
        let didReleaseHeldLayout = try await releaseHeldLayoutWorkerResult(in: threeD.webView)
        XCTAssertTrue(didReleaseHeldLayout)
        let didLoadGraph = try await awaitThreeDBooleanResult("window.__brainBarGraphAfterAbsentLens", in: threeD.webView)
        XCTAssertTrue(didLoadGraph)
        let final = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest graph-absent lens commit") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3 &&
            diagnosticCount($0, "visibleNodes") == 3 &&
            diagnosticCount($0, "visibleEdges") == 2 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        try await waitForRecordedGraphReadyGenerations([202], recorder: recorder)
        XCTAssertEqual(recorder.graphReadyGenerations, [202])
        let graphReadyAfterLatestGraphLoad = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertTrue(graphReadyAfterLatestGraphLoad)
        assertRendererDiagnosticsAreContentFree(final)
        try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DOverlappingWorkerLayoutsPublishOnlyLatestGraphReady() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let recorder = GraphReadyEventRecorder()
        let threeD = try makeThreeDWorkerTestWebView(graphDirectory: graphDirectory, graphReadyRecorder: recorder)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        threeD.webView.load(URLRequest(url: try workerTestIndexURL(mode: "holdResult")))
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "overlapping layout API installation")
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarFirstLayout",
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            lens: "all",
            generation: 101,
            in: threeD.webView
        )
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "first held worker layout") {
            diagnosticString($0, "lens") == "all" && diagnosticString($0, "layoutState") == "holding"
        }
        XCTAssertEqual(recorder.graphReadyGenerations, [])
        let graphReadyWhileFirstLayoutHeld = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyWhileFirstLayoutHeld)

        try await beginThreeDGraphOperation("window.__brainBarSecondLayout = window.brainBarApplyGraphLens('graphify', 102)", in: threeD.webView)
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "second held worker layout") {
            diagnosticString($0, "lens") == "graphify" && diagnosticString($0, "layoutState") == "holding"
        }
        XCTAssertEqual(recorder.graphReadyGenerations, [])
        let graphReadyWhileSecondLayoutHeld = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyWhileSecondLayoutHeld)

        let didReleaseHeldLayout = try await releaseHeldLayoutWorkerResult(in: threeD.webView)
        XCTAssertTrue(didReleaseHeldLayout)
        let results = try await awaitThreeDOperationResults(in: threeD.webView)
        XCTAssertEqual(results.first, false)
        XCTAssertEqual(results.second, true)
        let final = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "latest worker layout commit") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3 &&
            diagnosticCount($0, "visibleNodes") == 3 &&
            diagnosticCount($0, "visibleEdges") == 2 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        try await waitForRecordedGraphReadyGenerations([102], recorder: recorder)
        XCTAssertEqual(recorder.graphReadyGenerations, [102])
        assertRendererDiagnosticsAreContentFree(final)
        try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DWorkerStartupFailureReportsFailedLayoutWithoutGraphReady() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }
        var loadEvents: [GraphRendererLoadEvent] = []
        threeD.coordinator.onLoadEvent = { event, attempt in
            guard attempt == 301 else {
                return
            }
            loadEvents.append(event)
        }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        threeD.webView.load(URLRequest(url: try workerTestIndexURL(mode: "failStartup")))
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "worker startup failure API installation")
        let generation = threeD.coordinator.beginGraphLoad(attempt: 301)
        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarFailureLayout",
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            lens: "all",
            generation: generation,
            in: threeD.webView
        )
        let didLoad = try await awaitThreeDBooleanResult("window.__brainBarFailureLayout", in: threeD.webView)
        XCTAssertFalse(didLoad)
        let diagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "worker startup failure") {
            diagnosticString($0, "layoutState") == "failed" &&
            diagnosticBool($0, "hasDiagnostic") == true
        }
        let graphReadyAfterWorkerFailure = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertFalse(graphReadyAfterWorkerFailure)
        XCTAssertEqual(diagnosticString(diagnostics, "diagnostic"), "reported")
        assertRendererDiagnosticsAreContentFree(diagnostics)
        let deadline = Date().addingTimeInterval(2)
        while loadEvents != [.loading, .failed(.rendererFailed)] && Date() < deadline {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertEqual(loadEvents, [.loading, .failed(.rendererFailed)])
        await quiesceRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DReplacementLayoutFailurePreservesReadyGraphAndRetriesLatest() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let recorder = GraphReadyEventRecorder()
        let threeD = try makeThreeDWorkerTestWebView(graphDirectory: graphDirectory, graphReadyRecorder: recorder)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        threeD.webView.load(URLRequest(url: try workerTestIndexURL(mode: "holdResult")))
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "replacement preservation API installation")
        try await waitForRendererFunction("__brainBarLayoutWorkerTestFail", in: threeD.webView, phase: "replacement preservation fail API")

        try await beginThreeDGraphLoadFromScheme(
            "window.__brainBarReplacementBaseline",
            graphURL: try graphSchemeURL(for: threeD.coordinator),
            lens: "all",
            generation: 801,
            in: threeD.webView
        )
        try await waitForHeldLayoutWorkerResult(lens: "all", generation: 801, in: threeD.webView)
        let didReleaseBaseline = try await releaseHeldLayoutWorkerResult(in: threeD.webView)
        XCTAssertTrue(didReleaseBaseline)
        let didLoadBaseline = try await awaitThreeDBooleanResult("window.__brainBarReplacementBaseline", in: threeD.webView)
        XCTAssertTrue(didLoadBaseline)
        _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "replacement preservation baseline") {
            diagnosticString($0, "lens") == "all" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        let baseline = try await transactionalLayoutSnapshot(in: threeD.webView)
        XCTAssertTrue(baseline.graphReady)
        try await waitForRecordedGraphReadyGenerations([801], recorder: recorder)

        try await beginThreeDGraphOperation(
            "window.__brainBarReplacementFailure = window.brainBarApplyGraphLens('graphify', 802)",
            in: threeD.webView
        )
        try await waitForHeldLayoutWorkerResult(lens: "graphify", generation: 802, in: threeD.webView)
        let heldDiagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "replacement preservation held") {
            diagnosticString($0, "lens") == "all" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        let heldSnapshot = try await transactionalLayoutSnapshot(in: threeD.webView)
        XCTAssertEqual(heldSnapshot, baseline)
        let graphReadyWhileHeld = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertTrue(graphReadyWhileHeld)
        assertRendererDiagnosticsAreContentFree(heldDiagnostics)

        let didFailHeldReplacement = try await awaitThreeDBooleanResult("window.__brainBarLayoutWorkerTestFail()", in: threeD.webView)
        XCTAssertTrue(didFailHeldReplacement)
        let didFailReplacement = try await awaitThreeDBooleanResult("window.__brainBarReplacementFailure", in: threeD.webView)
        XCTAssertFalse(didFailReplacement)
        let failureDiagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "replacement preservation failure") {
            diagnosticString($0, "lens") == "all" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticBool($0, "hasDiagnostic") == true &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        let failedSnapshot = try await transactionalLayoutSnapshot(in: threeD.webView)
        XCTAssertEqual(failedSnapshot, baseline)
        let graphReadyAfterFailure = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertTrue(graphReadyAfterFailure)
        XCTAssertEqual(recorder.graphReadyGenerations, [801])
        assertRendererDiagnosticsAreContentFree(failureDiagnostics)

        try await beginThreeDGraphOperation(
            "window.__brainBarReplacementRetry = window.brainBarApplyGraphLens('graphify', 803)",
            in: threeD.webView
        )
        try await waitForHeldLayoutWorkerResult(lens: "graphify", generation: 803, in: threeD.webView)
        let didReleaseRetry = try await releaseHeldLayoutWorkerResult(in: threeD.webView)
        XCTAssertTrue(didReleaseRetry)
        let didRetry = try await awaitThreeDBooleanResult("window.__brainBarReplacementRetry", in: threeD.webView)
        XCTAssertTrue(didRetry)
        let retryDiagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "replacement preservation retry") {
            diagnosticString($0, "lens") == "graphify" &&
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticCount($0, "visibleNodes") == 3 &&
            diagnosticCount($0, "visibleEdges") == 2 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        try await waitForRecordedGraphReadyGenerations([801, 803], recorder: recorder)
        let graphReadyAfterRetry = try await rendererGlobalGraphReady(in: threeD.webView)
        XCTAssertTrue(graphReadyAfterRetry)
        assertRendererDiagnosticsAreContentFree(retryDiagnostics)
        try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DInteractionMatrixUsesCommittedQueryableState() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        var openRequests: [GraphNodeOpenRequest] = []
        let threeD = try makeThreeDLayoutResponsivenessWebView(
            graphDirectory: graphDirectory,
            onOpenNode: { openRequests.append($0) }
        )
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "3D interaction matrix API")
        let serialized = try await callAsyncJavaScriptString(
            """
            const response = await fetch(\(Graph3DWebView.jsStringLiteral(try graphSchemeURL(for: threeD.coordinator))));
            const graph = await response.json();
            window.__brainBarNodeFileMetadata = {
              byNodeId: {
                'node-a': { mtime: '2026-08-07T12:00:00Z' },
                'node-c': { mtime: '2026-08-06T12:00:00Z' }
              },
              bySourceFile: {}
            };
            const loaded = await window.brainBarLoadGraph(graph, 'all', 501);
            const snapshot = () => {
              const diagnostics = window.brainBarRendererDiagnostics();
              return {
                activeMode: diagnostics.activeMode,
                queryableNodes: diagnostics.queryableNodes,
                queryableEdges: diagnostics.queryableEdges,
                visibleNodes: diagnostics.visibleNodes,
                visibleEdges: diagnostics.visibleEdges,
                layoutState: diagnostics.layoutState,
                panel: document.getElementById('node-info')?.textContent || ''
              };
            };
            const initial = snapshot();
            document.getElementById('start-recent-orbit')?.click();
            const recent = snapshot();
            document.getElementById('clear-recent-orbit')?.click();
            window.brainBarRevealNode3D('node-a');
            document.getElementById('open-note')?.click();
            document.getElementById('focus-orbit')?.click();
            const focus = snapshot();
            document.getElementById('back-to-all')?.click();
            window.brainBarShowCommunity3D('Research');
            const community = snapshot();
            window.brainBarStartPathFromNode3D(JSON.stringify({ sourceId: 'node-a', targetId: 'node-d' }));
            const path = snapshot();
            await window.brainBarApplyGraphLens('graphify', 502);
            const search = document.getElementById('search');
            search.value = 'type:decision tag:memory status:active source:notes date:2026-08 agent:codex';
            search.dispatchEvent(new Event('input', { bubbles: true }));
            const searchResult = document.querySelector('#search-results .search-item');
            const searchReason = searchResult?.querySelector('small')?.textContent || '';
            searchResult?.click();
            for (let attempt = 0; attempt < 180; attempt += 1) {
              const diagnostics = window.brainBarRendererDiagnostics();
              if (diagnostics.activeMode === 'search' && diagnostics.lens === 'all') break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const temporarySearchState = snapshot();
            document.getElementById('back-to-all')?.click();
            for (let attempt = 0; attempt < 180; attempt += 1) {
              const diagnostics = window.brainBarRendererDiagnostics();
              if (diagnostics.activeMode === 'none' && diagnostics.lens === 'graphify') break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            const restoredSearchState = snapshot();
            await window.brainBarApplyGraphLens('all', 503);
            const sessionApplied = window.brainBarApplyGraphSessionState({
              schemaVersion: 1,
              graphVersion: 'fixture-v1',
              selectedNodeID: 'node-d',
              sourceLens: 'all',
              focusDepth: 2,
              path: { sourceNodeID: 'node-a', targetNodeID: 'node-d', variant: 'shortest' },
              communityID: 'Research',
              searchQuery: 'North',
              cameraState: {
                position: { x: 12, y: 34, z: 56 },
                target: { x: 1, y: 2, z: 3 },
                zoom: 1.5,
                preset: 'Saved test'
              }
            });
            const restoredSession = window.brainBarGraphSessionSnapshot();
            return JSON.stringify({
              loaded, initial, recent, focus, community, path,
              searchReason, temporarySearchState, restoredSearchState,
              sessionApplied, restoredSession
            });
            """,
            in: threeD.webView
        )
        let value = try XCTUnwrap(serialized)
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any]
        )
        XCTAssertEqual(result["loaded"] as? Bool, true)

        func assertState(
            _ key: String,
            mode: String,
            panelContains: String? = nil
        ) throws {
            let state = try XCTUnwrap(result[key] as? [String: Any])
            XCTAssertEqual(state["activeMode"] as? String, mode)
            XCTAssertEqual((state["queryableNodes"] as? NSNumber)?.intValue, 4)
            XCTAssertEqual((state["queryableEdges"] as? NSNumber)?.intValue, 3)
            XCTAssertEqual((state["visibleNodes"] as? NSNumber)?.intValue, 4)
            XCTAssertEqual((state["visibleEdges"] as? NSNumber)?.intValue, 3)
            XCTAssertEqual(state["layoutState"] as? String, "committed")
            if let panelContains {
                XCTAssertTrue((state["panel"] as? String)?.contains(panelContains) == true)
            }
        }

        try assertState("initial", mode: "none")
        try assertState("recent", mode: "recent", panelContains: "Recent Orbit")
        try assertState("focus", mode: "focus", panelContains: "Focused · depth 1")
        try assertState("community", mode: "community", panelContains: "Community Spotlight")
        try assertState("path", mode: "path", panelContains: "3 steps")
        XCTAssertTrue((result["searchReason"] as? String)?.contains("Hidden by Graphify Source Lens") == true)
        let temporarySearchState = try XCTUnwrap(result["temporarySearchState"] as? [String: Any])
        XCTAssertEqual(temporarySearchState["activeMode"] as? String, "search")
        XCTAssertEqual((temporarySearchState["visibleNodes"] as? NSNumber)?.intValue, 4)
        let restoredSearchState = try XCTUnwrap(result["restoredSearchState"] as? [String: Any])
        XCTAssertEqual(restoredSearchState["activeMode"] as? String, "none")
        XCTAssertEqual((restoredSearchState["visibleNodes"] as? NSNumber)?.intValue, 3)
        XCTAssertEqual(result["sessionApplied"] as? Bool, true)
        let restoredSession = try XCTUnwrap(result["restoredSession"] as? [String: Any])
        XCTAssertEqual(restoredSession["schemaVersion"] as? Int, 2)
        XCTAssertEqual(restoredSession["graphVersion"] as? String, "fixture-v1")
        XCTAssertEqual(restoredSession["selectedNodeID"] as? String, "node-d")
        XCTAssertEqual(restoredSession["sourceLens"] as? String, "all")
        XCTAssertEqual(restoredSession["focusDepth"] as? Int, 2)
        XCTAssertEqual(restoredSession["communityID"] as? String, "Research")
        XCTAssertEqual(restoredSession["searchQuery"] as? String, "North")
        let restoredCamera = try XCTUnwrap(restoredSession["cameraState"] as? [String: Any])
        XCTAssertEqual((restoredCamera["zoom"] as? NSNumber)?.doubleValue, 1.5)
        XCTAssertEqual(restoredCamera["preset"] as? String, "manual")
        let restoredPosition = try XCTUnwrap(restoredCamera["position"] as? [String: Any])
        let restoredTarget = try XCTUnwrap(restoredCamera["target"] as? [String: Any])
        let targetX = try XCTUnwrap((restoredTarget["x"] as? NSNumber)?.doubleValue)
        let targetY = try XCTUnwrap((restoredTarget["y"] as? NSNumber)?.doubleValue)
        let targetZ = try XCTUnwrap((restoredTarget["z"] as? NSNumber)?.doubleValue)
        XCTAssertEqual(targetX, 1, accuracy: 0.000_001)
        XCTAssertEqual(targetY, 2, accuracy: 0.000_001)
        XCTAssertEqual(targetZ, 3, accuracy: 0.000_001)
        let offsetX = try XCTUnwrap((restoredPosition["x"] as? NSNumber)?.doubleValue) - targetX
        let offsetY = try XCTUnwrap((restoredPosition["y"] as? NSNumber)?.doubleValue) - targetY
        let offsetZ = try XCTUnwrap((restoredPosition["z"] as? NSNumber)?.doubleValue) - targetZ
        let distance = sqrt(offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ)
        let requestedDistance = sqrt(11.0 * 11.0 + 32.0 * 32.0 + 53.0 * 53.0)
        XCTAssertTrue(distance.isFinite)
        XCTAssertGreaterThanOrEqual(distance, 90)
        XCTAssertEqual(distance, 90, accuracy: 0.000_001)
        XCTAssertEqual(offsetX / distance, 11 / requestedDistance, accuracy: 0.000_001)
        XCTAssertEqual(offsetY / distance, 32 / requestedDistance, accuracy: 0.000_001)
        XCTAssertEqual(offsetZ / distance, 53 / requestedDistance, accuracy: 0.000_001)
        let restoredPath = try XCTUnwrap(restoredSession["path"] as? [String: Any])
        XCTAssertEqual(restoredPath["sourceNodeID"] as? String, "node-a")
        XCTAssertEqual(restoredPath["targetNodeID"] as? String, "node-d")
        XCTAssertEqual(restoredPath["variant"] as? String, "shortest")

        let actionDeadline = Date().addingTimeInterval(2)
        while openRequests.isEmpty && Date() < actionDeadline {
            await Task.yield()
        }
        XCTAssertEqual(openRequests.count, 1)
        XCTAssertEqual(openRequests.first?.action, "openNode")
        XCTAssertEqual(openRequests.first?.nodeId, "node-a")
        XCTAssertEqual(openRequests.first?.sourceFile, "Notes/Northstar.md")
        await quiesceRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
    }

    @MainActor
    func testGraph3DProductionPipelinePreservesExactQueryableIdentities() async throws {
        let root = try temporaryDirectory()
        defer { removeTemporaryDirectory(root) }
        let graphDirectory = root.appendingPathComponent("graphify-out", isDirectory: true)
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        let graphData = Data(
            """
            {
              "nodes": [
                { "id": " a ", "label": "Alpha", "community": "One" },
                { "id": "b", "label": "Beta", "community": "One" },
                { "id": "c", "label": "Gamma", "community": "Two" }
              ],
              "links": [
                { "id": "explicit-1", "from": " a ", "to": "b", "relation": "obsidian_wikilink" },
                { "source": { "id": "b" }, "target": "c", "relation": "semantic_similarity", "weight": 0.5 },
                { "source": { "id": "b" }, "target": "c", "relation": "semantic_similarity", "weight": 0.5 }
              ]
            }
            """.utf8
        )
        try graphData.write(to: graphDirectory.appendingPathComponent("graph.json"), options: .atomic)

        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }
        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)

        var components = try XCTUnwrap(
            URLComponents(url: try XCTUnwrap(threeD.coordinator.indexURL), resolvingAgainstBaseURL: false)
        )
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "identity-test", value: "1"))
        queryItems.append(URLQueryItem(name: "renderer-test", value: "1"))
        components.queryItems = queryItems
        let identityIndexURL = try XCTUnwrap(components.url)
        threeD.webView.load(URLRequest(url: identityIndexURL))

        try await waitForRendererFunction(
            "__brainBarGraphIdentitySnapshot",
            in: threeD.webView,
            phase: "3D exact identity test API"
        )
        let serialized = try await callAsyncJavaScriptString(
            """
            const response = await fetch(\(Graph3DWebView.jsStringLiteral(try graphSchemeURL(for: threeD.coordinator))));
            const graph = await response.json();
            const loaded = await window.brainBarLoadGraph(graph, 'all', 601);
            return JSON.stringify({
              loaded,
              identity: window.__brainBarGraphIdentitySnapshot(),
              diagnostics: window.brainBarRendererDiagnostics()
            });
            """,
            in: threeD.webView
        )
        let value = try XCTUnwrap(serialized)
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(value.utf8)) as? [String: Any]
        )
        XCTAssertEqual(result["loaded"] as? Bool, true)
        let identity = try XCTUnwrap(result["identity"] as? [String: Any])
        XCTAssertEqual(Set(try XCTUnwrap(identity["nodeIDs"] as? [String])), Set([" a ", "b", "c"]))

        let semanticKey = #"{"source":"b","target":"c","relation":"semantic_similarity","attributes":{"relation":"semantic_similarity","weight":0.5}}"#
        let expectedEdges = [
            ["explicit-1", " a ", "b", "obsidian_wikilink"],
            ["edge:\(semanticKey):0", "b", "c", "semantic_similarity"],
            ["edge:\(semanticKey):1", "b", "c", "semantic_similarity"]
        ].map { $0.joined(separator: "\u{1F}") }.sorted()
        let actualEdges = try XCTUnwrap(identity["edgeIdentities"] as? [[String]])
            .map { $0.joined(separator: "\u{1F}") }
            .sorted()
        XCTAssertEqual(actualEdges, expectedEdges)

        let diagnostics = try XCTUnwrap(result["diagnostics"] as? [String: Any])
        XCTAssertEqual(diagnosticString(diagnostics, "layoutState"), "committed")
        XCTAssertEqual(diagnosticCount(diagnostics, "queryableNodes"), 3)
        XCTAssertEqual(diagnosticCount(diagnostics, "queryableEdges"), 3)
        assertRendererDiagnosticsAreContentFree(diagnostics)

        _ = try await callAsyncJavaScriptString(
            """
            window.brainBarRevealNode3D('b');
            return true;
            """,
            in: threeD.webView
        )
        let nodeText = try await waitForThreeDNodeInfoText(
            in: threeD.webView,
            phase: "3D exact identity node evidence",
            requiring: ["Incoming links (1)", "Outgoing links (2)", "b → c"]
        )
        XCTAssertTrue(nodeText.contains("Incoming links (1)"), nodeText)
        XCTAssertTrue(nodeText.contains("Outgoing links (2)"), nodeText)
        XCTAssertTrue(nodeText.contains("b → c"), nodeText)
        XCTAssertTrue(nodeText.contains("Wikilink"), nodeText)
        XCTAssertTrue(nodeText.contains("semantic_similarity"), nodeText)
        let inspected = try await awaitThreeDBooleanResult(
            "window.__brainBarGraphIdentityInspectEdge(\(Graph3DWebView.jsStringLiteral("edge:\(semanticKey):0")))",
            in: threeD.webView
        )
        XCTAssertTrue(inspected)
        let edgeText = try await waitForThreeDNodeInfoText(
            in: threeD.webView,
            phase: "3D exact identity edge evidence",
            requiring: ["Connection evidence", "Relationship", "b → c"]
        )
        XCTAssertTrue(edgeText.contains("Connection evidence"), edgeText)
        XCTAssertTrue(edgeText.contains("Relationship"), edgeText)
        XCTAssertTrue(edgeText.contains("b → c"), edgeText)
        await quiesceRendererWebView(
            threeD.webView,
            messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]
        )
    }

    @MainActor
    func testProductionTwoDRendererRetainsFixtureCountParityAndPrivateDiagnostics() async throws {
        let counts = try await exerciseTwoDRendererPhase()

        XCTAssertEqual(counts.nodes, 4)
        XCTAssertEqual(counts.edges, 3)
    }

    @MainActor
    func testOptInRendererMeasurementHarness() async throws {
        guard let request = try takeRendererMeasurementRequest() else {
            return
        }
        guard request.measurementKind == nil || request.measurementKind == "renderer" else {
            throw BrainBarError.processFailed("Renderer measurement request has an unsupported kind.")
        }
        let fixturePath = request.fixturePath
        let outputPath = request.outputPath
        let fixtureURL = URL(fileURLWithPath: fixturePath)
        let fixtureData = try Data(contentsOf: fixtureURL)
        let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
        let nodes = try XCTUnwrap(fixture["nodes"] as? [[String: Any]])
        let edges = try XCTUnwrap(fixture["edges"] as? [[String: Any]])
        let fixtureName = request.fixtureName
        let query = "Fixture \(fixtureName) node 0"
        let expected = RendererCounts(nodes: nodes.count, edges: edges.count)
        XCTAssertEqual(fixtureURL.deletingPathExtension().lastPathComponent, fixtureName)
        XCTAssertEqual(expected, reviewedMeasurementFixtureCounts[fixtureName])
        let directories = try measurementGraphDirectories(fixtureData: fixtureData)
        defer { removeTemporaryDirectory(directories.root) }

        await clearRendererLayoutCache()
        let cold = try await collectRendererMeasurement(payloadDirectory: directories.payload, threeDDirectory: directories.threeD, twoDHTMLURL: directories.twoDHTML, expected: expected, query: query, requiresLayoutCacheStored: true)
        for _ in 0..<2 {
            _ = try await collectRendererMeasurement(payloadDirectory: directories.payload, threeDDirectory: directories.threeD, twoDHTMLURL: directories.twoDHTML, expected: expected, query: query, requiresLayoutCacheHit: true)
        }
        var measured: [RendererMeasurementSample] = []
        for _ in 0..<9 {
            measured.append(try await collectRendererMeasurement(payloadDirectory: directories.payload, threeDDirectory: directories.threeD, twoDHTMLURL: directories.twoDHTML, expected: expected, query: query, requiresLayoutCacheHit: true))
        }

        let coldMetrics = summarizeMeasurementSamples([cold])
        let measuredMetrics = summarizeMeasurementSamples(measured)
        let final = try XCTUnwrap(measured.last)
        let report = RendererMeasurementReport(
            fixture: .init(name: fixtureName, nodeCount: expected.nodes, edgeCount: expected.edges),
            environment: .init(
                processIdentifier: ProcessInfo.processInfo.processIdentifier,
                operatingSystemVersion: ProcessInfo.processInfo.operatingSystemVersionString,
                physicalMemoryBytes: ProcessInfo.processInfo.physicalMemory
            ),
            cold: coldMetrics,
            measured: measuredMetrics,
            parity: .init(
                threeDQueryableNodes: final.threeDQueryableNodes,
                threeDQueryableEdges: final.threeDQueryableEdges,
                twoDQueryableNodes: final.twoDQueryableNodes,
                twoDQueryableEdges: final.twoDQueryableEdges,
                matchesFixture: final.threeDQueryableNodes == expected.nodes &&
                    final.threeDQueryableEdges == expected.edges &&
                    final.twoDQueryableNodes == expected.nodes &&
                    final.twoDQueryableEdges == expected.edges
            )
        )
        XCTAssertTrue(report.parity.matchesFixture)
        let outputURL = URL(fileURLWithPath: outputPath)
        try FileManager.default.createDirectory(at: outputURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(report).write(to: outputURL, options: .atomic)
    }

    @MainActor
    func testOptInGraph3DVisualCapture() async throws {
        guard let request = try takeGraph3DVisualCaptureRequest() else {
            return
        }
        let outputRoot = URL(fileURLWithPath: request.outputRoot, isDirectory: true)
        try FileManager.default.createDirectory(at: outputRoot, withIntermediateDirectories: true)
        var captures: [Graph3DVisualCaptureManifest.Capture] = []
        var coordinateFingerprints: [String: String] = [:]
        for (index, scenario) in request.scenarios.enumerated() {
            let fixtureURL = URL(fileURLWithPath: try XCTUnwrap(request.fixturePaths[scenario.fixtureName]))
            let fixtureData = try Data(contentsOf: fixtureURL)
            let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
            let nodes = try XCTUnwrap(fixture["nodes"] as? [[String: Any]])
            let edges = try XCTUnwrap(fixture["edges"] as? [[String: Any]])
            let expected = try XCTUnwrap(reviewedMeasurementFixtureCounts[scenario.fixtureName])
            XCTAssertEqual(RendererCounts(nodes: nodes.count, edges: edges.count), expected)
            XCTAssertEqual(
                visualCaptureFixtureDigest(fixtureData),
                try XCTUnwrap(request.fixtureDigests[scenario.fixtureName]),
                "Visual capture fixture identity changed: \(scenario.fixtureName)"
            )

            let graphDirectory = try visualCaptureGraphDirectory(
                request: request,
                scenario: scenario,
                fixtureData: fixtureData
            )
            let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
            let host = RendererWebViewHost(webView: threeD.webView)
            do {
                host.window.setContentSize(NSSize(width: scenario.width, height: scenario.height))
                try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
                try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "visual capture API")
                let graphURL = try graphSchemeURL(for: threeD.coordinator)
                let metadataURL = graphURL.replacingOccurrences(of: "/graph.json?", with: "/graph-metadata.json?")
                let loaded = try await awaitThreeDGraphOperation(
                    "window.brainBarLoadGraphFromURL(\(Graph3DWebView.jsStringLiteral(graphURL)), \(Graph3DWebView.jsStringLiteral(metadataURL)), 'all', \(9000 + index))",
                    action: "load public visual capture fixture",
                    in: threeD.webView
                )
                XCTAssertTrue(loaded)
                _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "visual capture initial paint") {
                    diagnosticString($0, "layoutState") == "committed" &&
                    diagnosticCount($0, "queryableNodes") == expected.nodes &&
                    diagnosticCount($0, "queryableEdges") == expected.edges &&
                    diagnosticBool($0, "paintedCountsSettled") == true
                }

                let scenarioApplied = try await awaitThreeDBooleanResult(
                    visualCaptureScenarioScript(scenario, fixtureName: scenario.fixtureName),
                    in: threeD.webView
                )
                XCTAssertTrue(scenarioApplied)
                let diagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "visual capture \(scenario.name)") {
                    diagnosticString($0, "layoutState") == "committed" &&
                    diagnosticCount($0, "queryableNodes") == expected.nodes &&
                    diagnosticCount($0, "queryableEdges") == expected.edges &&
                    diagnosticBool($0, "paintedCountsSettled") == true
                }
                assertRendererDiagnosticsAreContentFree(diagnostics)
                let presentation = try await visualCapturePresentationState(in: threeD.webView)
                XCTAssertLessThanOrEqual((presentation["persistentLabelMaxOverlapArea"] as? NSNumber)?.doubleValue ?? .infinity, 12)
                let coordinateFingerprint = try XCTUnwrap(presentation["coordinateFingerprint"] as? String)
                if let expectedFingerprint = coordinateFingerprints[scenario.fixtureName] {
                    XCTAssertEqual(coordinateFingerprint, expectedFingerprint, "Visual capture changed coordinates for \(scenario.name)")
                } else {
                    coordinateFingerprints[scenario.fixtureName] = coordinateFingerprint
                }
                try assertVisualCaptureScenario(scenario, diagnostics: diagnostics, presentation: presentation)
                let snapshotURL = outputRoot.appendingPathComponent(scenario.outputName)
                try await writeVisualCaptureSnapshot(of: threeD.webView, to: snapshotURL)
                captures.append(try visualCaptureManifestEntry(
                    scenario: scenario,
                    expected: expected,
                    diagnostics: diagnostics,
                    presentation: presentation
                ))
                try await closeThreeDRendererTestHost(
                    host,
                    messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]
                )
            } catch {
                host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
                throw error
            }
        }
        try assertVisualCaptureMatchedCoreParity(captures)
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        try encoder.encode(Graph3DVisualCaptureManifest(captures: captures))
            .write(to: outputRoot.appendingPathComponent("manifest.json"), options: .atomic)
    }

    @MainActor
    func testOptIn3DTransportPreparationBenchmark() throws {
        guard let request = try takeRendererMeasurementRequest() else {
            return
        }
        guard request.measurementKind == "transport-legacy" || request.measurementKind == "transport-current" else {
            throw BrainBarError.processFailed("3D transport benchmark request is missing its kind.")
        }
        let fixtureData = try Data(contentsOf: URL(fileURLWithPath: request.fixturePath))
        let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
        let nodes = try XCTUnwrap(fixture["nodes"] as? [[String: Any]])
        let edges = try XCTUnwrap(fixture["edges"] as? [[String: Any]])
        XCTAssertEqual(RendererCounts(nodes: nodes.count, edges: edges.count), reviewedMeasurementFixtureCounts[request.fixtureName])

        let measurementDirectory = try temporaryDirectory()
        defer { removeTemporaryDirectory(measurementDirectory) }
        var graphDirectories: [URL] = []
        for index in 0..<12 {
            let graphDirectory = measurementDirectory
                .appendingPathComponent("run-\(index)", isDirectory: true)
                .appendingPathComponent("graphify-out", isDirectory: true)
            try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
            try FileManager.default.linkItem(
                at: URL(fileURLWithPath: request.fixturePath),
                to: graphDirectory.appendingPathComponent("graph.json")
            )
            graphDirectories.append(graphDirectory)
        }

        let prepareTransport: (URL) -> Void = request.measurementKind == "transport-legacy"
            ? { _ = GraphMetadataPayloadCache.payload(readAccessURL: $0) }
            : { _ = Graph3DWebView.graphResourceVersion(readAccessURL: $0) }

        let coldStartedAt = Date()
        prepareTransport(graphDirectories[0])
        let cold = measurementSummary([milliseconds(since: coldStartedAt)])
        for graphDirectory in graphDirectories[1...2] {
            prepareTransport(graphDirectory)
        }
        var samples: [Double] = []
        for graphDirectory in graphDirectories[3...11] {
            let startedAt = Date()
            prepareTransport(graphDirectory)
            samples.append(milliseconds(since: startedAt))
        }
        let summary = measurementSummary(samples)
        let report: [String: Any] = [
            "schemaVersion": 1,
            "kind": "3d-main-actor-transport-preparation-\(request.measurementKind == "transport-legacy" ? "legacy" : "current")",
            "fixture": ["name": request.fixtureName, "nodeCount": nodes.count, "edgeCount": edges.count],
            "protocol": ["coldRuns": 1, "warmupRuns": 2, "measuredRuns": 9, "cacheMode": "distinct graph paths"],
            "cold": ["samples": cold.samples, "p50": cold.p50, "p95": cold.p95, "cvPercent": cold.cvPercent],
            "measured": ["samples": summary.samples, "p50": summary.p50, "p95": summary.p95, "cvPercent": summary.cvPercent]
        ]
        let data = try JSONSerialization.data(withJSONObject: report, options: [.sortedKeys])
        try data.write(to: URL(fileURLWithPath: request.outputPath), options: .atomic)
    }

    @MainActor
    func testGraph2DMetadataPayloadIsStableForUnchangedGraph() throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let noteURL = vault.appendingPathComponent("Notes/Recent.md")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: noteURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "recent".write(to: noteURL, atomically: true, encoding: .utf8)
        try """
        {
          "nodes": [
            { "id": "recent", "label": "Recent", "source_file": "Notes/Recent.md" }
          ],
          "edges": []
        }
        """.write(to: graphDirectory.appendingPathComponent("graph.json"), atomically: true, encoding: .utf8)

        let first = GraphMetadataPayloadCache.payload(readAccessURL: graphDirectory)
        let second = GraphMetadataPayloadCache.payload(readAccessURL: graphDirectory)

        XCTAssertEqual(first.version, second.version)
        XCTAssertEqual(first.script, second.script)
        XCTAssertTrue(first.script.contains("window.__brainBarNodeFileMetadata ="))
        XCTAssertTrue(first.script.contains(#""recent""#))
        XCTAssertTrue(first.script.contains(#""mtime""#))
    }

    @MainActor
    func testGraph2DMetadataPayloadVersionChangesWhenGraphJSONChanges() throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        let graphJSONURL = graphDirectory.appendingPathComponent("graph.json")
        try #"{"nodes":[],"edges":[]}"#.write(to: graphJSONURL, atomically: true, encoding: .utf8)
        let first = GraphMetadataPayloadCache.payload(readAccessURL: graphDirectory)

        try """
        {
          "nodes": [
            { "id": "changed", "label": "Changed" }
          ],
          "edges": []
        }
        """.write(to: graphJSONURL, atomically: true, encoding: .utf8)
        let second = GraphMetadataPayloadCache.payload(readAccessURL: graphDirectory)

        XCTAssertNotEqual(first.version, second.version)
        XCTAssertTrue(second.script.contains(#""changed""#))
    }

    @MainActor
    func testGraph2DMetadataPayloadMissingGraphIsSafe() throws {
        let graphDirectory = try temporaryDirectory().appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)

        let payload = GraphMetadataPayloadCache.payload(readAccessURL: graphDirectory)

        XCTAssertTrue(payload.version.hasSuffix(":missing"))
        XCTAssertTrue(payload.script.contains("window.__brainBarGraphJSON = null;"))
        XCTAssertTrue(payload.script.contains("window.__brainBarNodeFileMetadata = { byNodeId: {}, bySourceFile: {} };"))
    }

    @MainActor
    func testGraph2DCoordinatorPublishesReadyAfterBootstrapAndIgnoresStaleNavigationFailure() async throws {
        let twoD = try makeTwoDRendererWebView()
        defer { removeTemporaryDirectory(twoD.directory) }
        let host = RendererWebViewHost(webView: twoD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction"]) }
        var loadEvents: [GraphRendererLoadEvent] = []
        let coordinator = GraphWebView.Coordinator(
            onLoadEvent: { event, attempt in
                guard attempt == 17 else {
                    return
                }
                loadEvents.append(event)
            },
            onOpenNode: { _ in }
        )
        coordinator.loadedURL = twoD.htmlURL
        coordinator.beginGraphLoad(attempt: 17)
        twoD.webView.navigationDelegate = coordinator
        coordinator.activeNavigation = twoD.webView.loadFileURL(
            twoD.htmlURL,
            allowingReadAccessTo: twoD.htmlURL.deletingLastPathComponent()
        )

        let deadline = Date().addingTimeInterval(5)
        while loadEvents != [.loading, .ready] && Date() < deadline {
            await Task.yield()
        }
        XCTAssertEqual(loadEvents, [.loading, .ready])
        let diagnostics = try await waitForRendererDiagnostics(
            in: twoD.webView,
            functionName: "brainBarRendererDiagnostics2D",
            phase: "2D coordinator ready diagnostics"
        ) {
            diagnosticBool($0, "networkAvailable") == true
        }
        XCTAssertTrue(diagnosticBool(diagnostics, "networkAvailable") == true)

        let staleURL = twoD.directory.appendingPathComponent("stale.html")
        try "<html><body>stale</body></html>".write(to: staleURL, atomically: true, encoding: .utf8)
        twoD.webView.loadFileURL(staleURL, allowingReadAccessTo: twoD.directory)
        let staleDeadline = Date().addingTimeInterval(5)
        while twoD.webView.url != staleURL && Date() < staleDeadline {
            await Task.yield()
        }
        await Task.yield()

        XCTAssertEqual(loadEvents, [.loading, .ready])
    }

    @MainActor
    func testGraph2DCoordinatorFailsWhenBootstrapDoesNotCreateNetwork() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let htmlURL = directory.appendingPathComponent("missing-network.html")
        try "<html><body><div id=\"graph\"></div></body></html>".write(to: htmlURL, atomically: true, encoding: .utf8)
        let webView = try makeTwoDRendererWebViewForExistingHTML()
        let host = RendererWebViewHost(webView: webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction"]) }
        var loadEvents: [GraphRendererLoadEvent] = []
        let coordinator = GraphWebView.Coordinator(
            onLoadEvent: { event, attempt in
                guard attempt == 18 else {
                    return
                }
                loadEvents.append(event)
            },
            onOpenNode: { _ in }
        )
        coordinator.loadedURL = htmlURL
        coordinator.beginGraphLoad(attempt: 18)
        webView.navigationDelegate = coordinator
        coordinator.activeNavigation = webView.loadFileURL(htmlURL, allowingReadAccessTo: directory)

        let deadline = Date().addingTimeInterval(5)
        while loadEvents != [.loading, .failed(.twoDRuntimeUnavailable)] && Date() < deadline {
            await Task.yield()
        }

        XCTAssertEqual(loadEvents, [.loading, .failed(.twoDRuntimeUnavailable)])
    }

    @MainActor
    func testGraph2DCoordinatorRapidReloadAcceptsOnlyCurrentNavigationEvents() async throws {
        let twoD = try makeTwoDRendererWebView()
        defer { removeTemporaryDirectory(twoD.directory) }
        let host = RendererWebViewHost(webView: twoD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction"]) }
        var loadEvents: [(GraphRendererLoadEvent, Int)] = []
        let coordinator = GraphWebView.Coordinator(
            onLoadEvent: { event, attempt in
                loadEvents.append((event, attempt))
            },
            onOpenNode: { _ in }
        )
        twoD.webView.navigationDelegate = coordinator

        coordinator.loadedURL = twoD.htmlURL
        coordinator.beginGraphLoad(attempt: 31)
        coordinator.activeNavigation = twoD.webView.loadFileURL(twoD.htmlURL, allowingReadAccessTo: twoD.directory)
        coordinator.beginGraphLoad(attempt: 32)
        XCTAssertFalse(coordinator.graphReady)
        coordinator.activeNavigation = twoD.webView.loadFileURL(twoD.htmlURL, allowingReadAccessTo: twoD.directory)

        let deadline = Date().addingTimeInterval(5)
        while !loadEvents.contains(where: { $0.0 == .ready && $0.1 == 32 }) && Date() < deadline {
            await Task.yield()
        }

        XCTAssertEqual(loadEvents.filter { $0.0 == .failed(.rendererFailed) }.count, 0)
        XCTAssertEqual(loadEvents.filter { $0.0 == .ready && $0.1 == 31 }.count, 0)
        XCTAssertEqual(loadEvents.filter { $0.0 == .ready && $0.1 == 32 }.count, 1)
        XCTAssertTrue(coordinator.graphReady)
    }

    @MainActor
    func testGraph2DWorkflowFixtureCoversLensesViewsReviewAndHealth() async throws {
        let privacySentinel = "GRAPH_2D_WORKFLOW_PRIVACY_SENTINEL"
        let twoD = try makeTwoDRendererWebView(graphData: try twoDWorkflowFixtureData(privacySentinel: privacySentinel))
        defer { removeTemporaryDirectory(twoD.directory) }
        let host = RendererWebViewHost(webView: twoD.webView)
        var didCloseHost = false
        defer {
            if !didCloseHost {
                host.close()
            }
        }

        twoD.webView.loadFileURL(twoD.htmlURL, allowingReadAccessTo: twoD.directory)
        let initialDiagnostics = try await waitForRendererDiagnostics(
            in: twoD.webView,
            functionName: "brainBarRendererDiagnostics2D",
            phase: "2D workflow fixture bootstrap"
        ) {
            diagnosticBool($0, "networkAvailable") == true &&
            diagnosticCount($0, "visibleNodes") == 10 &&
            diagnosticCount($0, "visibleEdges") == 8
        }
        assert2DDiagnosticShape(initialDiagnostics)
        let initialDiagnosticData = try JSONSerialization.data(withJSONObject: initialDiagnostics, options: [.sortedKeys])
        XCTAssertFalse(String(decoding: initialDiagnosticData, as: UTF8.self).contains(privacySentinel))
        try await waitForTwoDWorkflowRuntime(in: twoD.webView)
        XCTContext.runActivity(named: "2D workflow bootstrap") { _ in }

        func assertVisibleGraph(
            nodes expectedNodes: [String],
            edges expectedEdges: [String],
            mode expectedMode: String,
            lens expectedLens: String
        ) async throws {
            let serializedValue = try await evaluateJavaScriptString("""
            (() => {
              const diagnostics = window.brainBarRendererDiagnostics2D();
              return JSON.stringify({
                nodes: window.nodesDS.get().filter((node) => !node.hidden).map((node) => String(node.id)).sort(),
                edges: window.edgesDS.get().filter((edge) => !edge.hidden).map((edge) => String(edge.id)).sort(),
                mode: diagnostics.activeMode,
                lens: diagnostics.lens
              });
            })()
            """, in: twoD.webView)
            let serialized = try XCTUnwrap(serializedValue)
            let state = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any]
            )
            XCTAssertEqual(state["nodes"] as? [String], expectedNodes)
            XCTAssertEqual(state["edges"] as? [String], expectedEdges)
            XCTAssertEqual(state["mode"] as? String, expectedMode)
            XCTAssertEqual(state["lens"] as? String, expectedLens)
        }

        try await assertVisibleGraph(
            nodes: ["g3", "g4", "g5", "g6", "g7", "hub", "orphan", "review-id", "review-source", "wiki"],
            edges: ["edge-g3", "edge-g4", "edge-g5", "edge-g6", "edge-g7", "edge-review-id", "edge-review-source", "edge-wiki"],
            mode: "global",
            lens: "all"
        )

        try await evaluateJavaScript("document.querySelector('button[data-lens=\"obsidian\"]').click();", in: twoD.webView)
        try await assertVisibleGraph(nodes: ["hub", "wiki"], edges: ["edge-wiki"], mode: "global", lens: "obsidian")

        try await evaluateJavaScript("document.querySelector('button[data-lens=\"graphify\"]').click();", in: twoD.webView)
        try await assertVisibleGraph(
            nodes: ["g3", "g4", "g5", "g6", "g7", "hub", "review-id", "review-source"],
            edges: ["edge-g3", "edge-g4", "edge-g5", "edge-g6", "edge-g7", "edge-review-id", "edge-review-source"],
            mode: "global",
            lens: "graphify"
        )

        try await evaluateJavaScript("document.querySelector('button[data-lens=\"all\"]').click();", in: twoD.webView)
        try await evaluateJavaScript("""
        window.network.selectNodes(['hub']);
        window.network.emit('selectNode', { nodes: ['hub'] });
        document.querySelector('button[data-view="focus"]').click();
        """, in: twoD.webView)
        try await assertVisibleGraph(
            nodes: ["g3", "g4", "g5", "g6", "g7", "hub", "review-id", "review-source", "wiki"],
            edges: ["edge-g3", "edge-g4", "edge-g5", "edge-g6", "edge-g7", "edge-review-id", "edge-review-source", "edge-wiki"],
            mode: "focus",
            lens: "all"
        )
        XCTContext.runActivity(named: "2D lenses and focus") { _ in }

        try await evaluateJavaScript("document.querySelector('button[data-view=\"recent\"]').click();", in: twoD.webView)
        try await assertVisibleGraph(nodes: ["hub", "wiki"], edges: ["edge-wiki"], mode: "recent", lens: "all")

        try await evaluateJavaScript("document.querySelector('button[data-view=\"groups\"]').click();", in: twoD.webView)
        let groupsTitle = try await evaluateJavaScriptString(
            "document.querySelector('#brainbar-workflow-panel h2')?.textContent || null",
            in: twoD.webView
        )
        XCTAssertEqual(groupsTitle, "Groups")
        try await assertVisibleGraph(nodes: ["hub", "wiki"], edges: ["edge-wiki"], mode: "groups", lens: "all")
        try await evaluateJavaScript("document.querySelector('#brainbar-workflow-panel .group-row').click();", in: twoD.webView)
        let communityTitle = try await evaluateJavaScriptString(
            "document.querySelector('#brainbar-workflow-panel h2')?.textContent || null",
            in: twoD.webView
        )
        XCTAssertEqual(communityTitle, "Community Core")
        try await evaluateJavaScript(
            "Array.from(document.querySelectorAll('#brainbar-workflow-panel .workflow-actions button')).find((button) => button.textContent === 'Focus community').click();",
            in: twoD.webView
        )
        try await assertVisibleGraph(
            nodes: ["g3", "g4", "g5", "g6", "hub", "review-id", "review-source", "wiki"],
            edges: ["edge-g3", "edge-g4", "edge-g5", "edge-g6", "edge-review-id", "edge-review-source", "edge-wiki"],
            mode: "groups",
            lens: "all"
        )
        XCTContext.runActivity(named: "2D recent and community views") { _ in }

        try await evaluateJavaScript("document.querySelector('button[data-view=\"orphans\"]').click();", in: twoD.webView)
        try await assertVisibleGraph(nodes: ["orphan"], edges: [], mode: "orphans", lens: "all")

        let searchStateJSON = try await evaluateJavaScriptString(
            """
            (() => {
              const search = document.getElementById('search');
              search.value = 'type:decision tag:memory status:active source:notes date:2026-08 agent:codex';
              search.dispatchEvent(new Event('input', { bubbles: true }));
              const result = document.querySelector('#brainbar-search-results button[data-node-id="hub"]');
              const reason = result?.querySelector('small')?.textContent || '';
              result?.click();
              const revealedNodes = window.nodesDS.get().filter((node) => !node.hidden).map((node) => String(node.id)).sort();
              const returnButton = Array.from(document.querySelectorAll('#brainbar-workflow-panel .workflow-actions button'))
                .find((button) => button.textContent === 'Return to filters');
              returnButton?.click();
              const restoredNodes = window.nodesDS.get().filter((node) => !node.hidden).map((node) => String(node.id)).sort();
              return JSON.stringify({ reason, revealedNodes, restoredNodes });
            })()
            """,
            in: twoD.webView
        )
        let searchState = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(searchStateJSON).utf8)) as? [String: Any]
        )
        XCTAssertTrue((searchState["reason"] as? String)?.contains("Hidden by orphans view") == true)
        XCTAssertEqual(searchState["revealedNodes"] as? [String], ["hub", "orphan"])
        XCTAssertEqual(searchState["restoredNodes"] as? [String], ["orphan"])
        XCTContext.runActivity(named: "2D global filtered search and temporary reveal") { _ in }

        try await evaluateJavaScript("document.querySelector('button[data-view=\"hubs\"]').click();", in: twoD.webView)
        try await assertVisibleGraph(nodes: ["hub"], edges: [], mode: "hubs", lens: "all")

        try await evaluateJavaScript("""
        window.__brainBarActiveGraphView = 'review';
        window.brainBarApplyReviewQueueTargets([
          { node_id: 'review-id' },
          { source_file: 'Notes/ReviewSource.md' }
        ]);
        """, in: twoD.webView)
        try await assertVisibleGraph(nodes: ["review-id", "review-source"], edges: [], mode: "review", lens: "all")
        XCTContext.runActivity(named: "2D workflow node-set views and review targets") { _ in }

        try await evaluateJavaScript("document.querySelector('button[data-view=\"health\"]').click();", in: twoD.webView)
        let healthTextValue = try await evaluateJavaScriptString("document.querySelector('#brainbar-health-panel')?.textContent || null", in: twoD.webView)
        let healthText = try XCTUnwrap(healthTextValue)
        let evidenceAPI = try await evaluateJavaScriptString("typeof window.BrainBarGraphEvidence?.build", in: twoD.webView)
        XCTAssertEqual(evidenceAPI, "function")
        let evidenceSmoke = try await evaluateJavaScriptString(
            """
            (() => {
              try {
                return String(window.BrainBarGraphEvidence.build({
                  nodes: [{ id: 'a' }, { id: 'b' }],
                  edges: [{ id: 'ab', from: 'a', to: 'b' }]
                }, { now: Date.now() }).proposals.length);
              } catch (error) {
                return `error: ${String(error?.message || error)}`;
              }
            })()
            """,
            in: twoD.webView
        )
        XCTAssertEqual(evidenceSmoke, "0")
        let evidenceError = try await evaluateJavaScriptString("window.__brainBarGraphEvidenceError || null", in: twoD.webView)
        XCTAssertNil(evidenceError, "2D evidence build failed: \(evidenceError ?? "unknown")")
        XCTAssertTrue(healthText.contains("Graph Check"))
        XCTAssertTrue(healthText.contains("Needs Links"), healthText)
        XCTAssertTrue(healthText.contains("Key Notes"))
        XCTAssertTrue(healthText.contains("Disconnected Groups"))
        XCTAssertTrue(healthText.contains("Deterministic proposals"))
        XCTAssertTrue(healthText.contains("Rule orphan-node v1"))
        XCTAssertTrue(healthText.contains("Rule weak-bridge v1"))
        XCTAssertTrue(healthText.contains("Caveat:"))
        XCTAssertTrue(healthText.contains("Sources (1): Notes/Orphan.md"))
        XCTAssertFalse(healthText.contains("[object Object]"))
        XCTAssertFalse(healthText.contains(privacySentinel))
        XCTContext.runActivity(named: "2D Graph Check sections") { _ in }

        let restoredSessionJSON = try await evaluateJavaScriptString(
            """
            (() => {
              const session = {
                schemaVersion: 1,
                graphVersion: 'fixture-v1',
                selectedNodeID: 'hub',
                sourceLens: 'all',
                focusDepth: 2,
                path: { sourceNodeID: 'hub', targetNodeID: 'orphan', variant: 'shortest' },
                communityID: 'Core',
                searchQuery: 'Hub',
                cameraState: {
                  position: { x: 12, y: 34, z: 56 },
                  target: { x: 1, y: 2, z: 3 },
                  zoom: 1.5,
                  preset: 'Saved test'
                }
              };
              const applied = window.brainBarApplyGraphSessionState(session);
              return JSON.stringify({ applied, session: window.brainBarGraphSessionSnapshot() });
            })()
            """,
            in: twoD.webView
        )
        let restoredSessionEnvelope = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(restoredSessionJSON).utf8)) as? [String: Any]
        )
        XCTAssertEqual(restoredSessionEnvelope["applied"] as? Bool, true)
        let restoredSession = try XCTUnwrap(restoredSessionEnvelope["session"] as? [String: Any])
        XCTAssertEqual(restoredSession["schemaVersion"] as? Int, 1)
        XCTAssertEqual(restoredSession["graphVersion"] as? String, "fixture-v1")
        XCTAssertEqual(restoredSession["selectedNodeID"] as? String, "hub")
        XCTAssertEqual(restoredSession["sourceLens"] as? String, "all")
        XCTAssertEqual(restoredSession["focusDepth"] as? Int, 2)
        XCTAssertEqual(restoredSession["communityID"] as? String, "Core")
        XCTAssertEqual(restoredSession["searchQuery"] as? String, "Hub")
        let restoredCamera = try XCTUnwrap(restoredSession["cameraState"] as? [String: Any])
        XCTAssertEqual((restoredCamera["zoom"] as? NSNumber)?.doubleValue, 1.5)
        XCTAssertEqual(restoredCamera["preset"] as? String, "Saved test")
        let restoredPath = try XCTUnwrap(restoredSession["path"] as? [String: Any])
        XCTAssertEqual(restoredPath["sourceNodeID"] as? String, "hub")
        XCTAssertEqual(restoredPath["targetNodeID"] as? String, "orphan")
        XCTAssertEqual(restoredPath["variant"] as? String, "shortest")
        XCTContext.runActivity(named: "2D complete session restoration") { _ in }
        try await closeTwoDRendererTestHost(host, messageHandlerNames: [])
        didCloseHost = true
    }

    @MainActor
    func testGraph2DWorkflowFixtureCoversEdgeInspectorAndOpenNoteAction() async throws {
        let privacySentinel = "GRAPH_2D_WORKFLOW_PRIVACY_SENTINEL"
        let recorder = GraphNodeActionRecorder()
        let twoD = try makeTwoDRendererWebView(
            graphData: try twoDWorkflowFixtureData(privacySentinel: privacySentinel),
            nodeActionRecorder: recorder
        )
        defer { removeTemporaryDirectory(twoD.directory) }
        let fixtureNote = twoD.directory.appendingPathComponent("Notes/Hub.md")
        let fixtureNestedNote = twoD.directory.appendingPathComponent("Notes/Archive/Orphan.md")
        try FileManager.default.createDirectory(at: fixtureNote.deletingLastPathComponent(), withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: fixtureNestedNote.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "fixture hub".write(to: fixtureNote, atomically: true, encoding: .utf8)
        try "fixture orphan".write(to: fixtureNestedNote, atomically: true, encoding: .utf8)
        let vaultContentHashBeforeInteraction = try vaultContentHash(twoD.directory)
        let host = RendererWebViewHost(webView: twoD.webView)
        var didCloseHost = false
        defer {
            if !didCloseHost {
                host.close(messageHandlerNames: ["brainBarNodeAction"])
            }
        }

        twoD.webView.loadFileURL(twoD.htmlURL, allowingReadAccessTo: twoD.directory)
        let diagnostics = try await waitForRendererDiagnostics(
            in: twoD.webView,
            functionName: "brainBarRendererDiagnostics2D",
            phase: "2D edge action fixture bootstrap"
        ) {
            diagnosticBool($0, "networkAvailable") == true &&
            diagnosticCount($0, "visibleNodes") == 10 &&
            diagnosticCount($0, "visibleEdges") == 8
        }
        assert2DDiagnosticShape(diagnostics)
        let diagnosticData = try JSONSerialization.data(withJSONObject: diagnostics, options: [.sortedKeys])
        XCTAssertFalse(String(decoding: diagnosticData, as: UTF8.self).contains(privacySentinel))
        try await waitForTwoDWorkflowRuntime(in: twoD.webView)
        XCTContext.runActivity(named: "2D edge action bootstrap") { _ in }

        try await evaluateJavaScript("""
        window.network.emit('selectEdge', { edges: ['edge-review-id'] });
        """, in: twoD.webView)
        let edgeInspectorTextValue = try await evaluateJavaScriptString("document.querySelector('#brainbar-edge-inspector')?.textContent || null", in: twoD.webView)
        let edgeInspectorText = try XCTUnwrap(edgeInspectorTextValue)
        XCTAssertTrue(edgeInspectorText.contains("Relationship"))
        XCTAssertTrue(edgeInspectorText.contains("Source"))
        XCTAssertTrue(edgeInspectorText.contains("Graphify"))
        XCTAssertTrue(edgeInspectorText.contains("Notes/Hub.md"))
        XCTContext.runActivity(named: "2D edge provenance inspector") { _ in }

        try await evaluateJavaScript("""
        window.network.emit('selectNode', { nodes: ['hub'] });
        """, in: twoD.webView)
        let evidenceAPI = try await evaluateJavaScriptString("typeof window.BrainBarGraphEvidence?.build", in: twoD.webView)
        XCTAssertEqual(evidenceAPI, "function")
        let nodeInspectorTextValue = try await evaluateJavaScriptString("document.querySelector('.brainbar-evidence-inspector')?.textContent || window.__brainBarGraphEvidenceError || null", in: twoD.webView)
        let nodeInspectorText = try XCTUnwrap(nodeInspectorTextValue)
        XCTAssertTrue(nodeInspectorText.contains("Incoming links"))
        XCTAssertTrue(nodeInspectorText.contains("Outgoing links"))
        XCTAssertTrue(nodeInspectorText.contains("hub → wiki"))
        XCTAssertTrue(nodeInspectorText.contains("Wikilink"))
        try await evaluateJavaScript("""
        document.querySelector('#brainbar-open-note').click();
        document.querySelector('button[data-view="health"]').click();
        document.querySelector('#brainbar-health-panel [type="button"]:not(.close)')?.click();
        """, in: twoD.webView)
        let graphCheckTextValue = try await evaluateJavaScriptString("document.querySelector('#brainbar-health-panel')?.textContent || null", in: twoD.webView)
        let graphCheckText = try XCTUnwrap(graphCheckTextValue)
        XCTAssertTrue(graphCheckText.contains("Graph Check"))
        XCTAssertTrue(graphCheckText.contains("Copy instruction"))
        let actionDeadline = Date().addingTimeInterval(2)
        while recorder.actions.isEmpty && Date() < actionDeadline {
            await Task.yield()
        }
        let action = try XCTUnwrap(recorder.actions.last)
        XCTAssertEqual(action["action"] as? String, "openNode")
        XCTAssertEqual(action["nodeId"] as? String, "hub")
        XCTAssertEqual(action["label"] as? String, "Hub")
        XCTAssertEqual(action["sourceFile"] as? String, "Notes/Hub.md")
        XCTAssertFalse(action.values.map(String.init(describing:)).joined(separator: "|").contains(privacySentinel))
        XCTAssertEqual(try vaultContentHash(twoD.directory), vaultContentHashBeforeInteraction)
        XCTContext.runActivity(named: "2D Open Note action envelope") { _ in }
        try await closeTwoDRendererTestHost(host, messageHandlerNames: ["brainBarNodeAction"])
        didCloseHost = true
    }

    func testGraphNodeOpenURLUsesObsidianForMarkdownWhenEnabled() throws {
        let vault = try temporaryDirectory()
        let noteURL = vault.appendingPathComponent("Note.md")
        try "note".write(to: noteURL, atomically: true, encoding: .utf8)
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.useObsidianURLScheme = true

        let openURL = try VaultStatusService().graphNodeOpenURL(for: "Note.md", config: config)

        XCTAssertEqual(openURL.scheme, "obsidian")
        XCTAssertEqual(openURL.host, "open")
        XCTAssertTrue(openURL.absoluteString.contains("path="))
    }

    func testGraphNodeOpenURLUsesFileURLForNonMarkdownEvenWhenObsidianEnabled() throws {
        let vault = try temporaryDirectory()
        let sourceURL = vault.appendingPathComponent("script.py")
        try "print('ok')".write(to: sourceURL, atomically: true, encoding: .utf8)
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.useObsidianURLScheme = true

        let openURL = try VaultStatusService().graphNodeOpenURL(for: "script.py", config: config)

        XCTAssertEqual(openURL, sourceURL.standardizedFileURL)
    }

    func testGraphSourceLensLabelsAndRawValuesAreStable() {
        XCTAssertEqual(GraphSourceLens.all.rawValue, "all")
        XCTAssertEqual(GraphSourceLens.all.label, "All")
        XCTAssertEqual(GraphSourceLens.graphify.rawValue, "graphify")
        XCTAssertEqual(GraphSourceLens.graphify.label, "Graphify")
        XCTAssertEqual(GraphSourceLens.obsidian.rawValue, "obsidian")
        XCTAssertEqual(GraphSourceLens.obsidian.label, "Wikilinks")
    }

    func testGraphViewModeLabelsAndRawValuesAreStable() {
        XCTAssertEqual(GraphViewMode.allCases, [.threeD, .twoD])
        XCTAssertEqual(GraphViewMode.twoD.rawValue, "twoD")
        XCTAssertEqual(GraphViewMode.twoD.label, "2D")
        XCTAssertEqual(GraphViewMode.threeD.rawValue, "threeD")
        XCTAssertEqual(GraphViewMode.threeD.label, "3D")
    }

    func testGraphViewportCommandRawValuesAreStable() {
        XCTAssertEqual(GraphViewportCommandKind.fit.rawValue, "fit")
        XCTAssertEqual(GraphViewportCommandKind.zoomIn.rawValue, "zoomIn")
        XCTAssertEqual(GraphViewportCommandKind.zoomOut.rawValue, "zoomOut")
        XCTAssertEqual(GraphViewportCommandKind.topView.rawValue, "topView")
        XCTAssertEqual(GraphViewportCommandKind.resetTilt.rawValue, "resetTilt")
        XCTAssertEqual(GraphViewportCommandKind.graphHealth.rawValue, "graphHealth")
    }

    func testReviewQueueWatcherIsOffByDefault() {
        XCTAssertFalse(BrainBarConfig.default.reviewQueue.isEnabled)
        XCTAssertFalse(BrainBarConfig.default.reviewQueue.backgroundWatcherEnabled)
        XCTAssertNil(BrainBarConfig.default.reviewQueue.manualCommand)
    }

    func testAgentActivityDefaultsAreConservative() {
        XCTAssertFalse(BrainBarConfig.default.agentActivity.eventTracingEnabled)
        XCTAssertTrue(BrainBarConfig.default.agentActivity.fileActivityEnabled)
    }

    @MainActor
    func testWorkflowSelectionIsAdditiveAndClearable() throws {
        let timestamp = Date(timeIntervalSince1970: 1_700_000_000)
        let workflow = AgentActivityWorkflow(
            id: "workflow:render-proof",
            workflowId: "render-proof",
            sessionId: "session-42",
            title: "Render proof",
            status: "completed",
            trail: [],
            sourcePaths: ["Notes/Input.md"],
            outputPaths: ["Notes/Output.md"],
            touchedPaths: ["Notes/Touched.md"],
            nodeIds: ["node-a"],
            pendingPaths: ["Notes/Pending.md"],
            firstEventAt: timestamp,
            lastEventAt: timestamp
        )
        let model = AppModel()
        model.agentActivitySnapshot = AgentActivitySnapshot(
            events: [],
            nodeIds: ["node-a"],
            pendingPaths: ["Notes/Pending.md"],
            lastEventAt: timestamp,
            eventLogPath: "",
            codexIntegrationInstalled: false,
            claudeIntegrationInstalled: false,
            claudeIntegrationPartial: false,
            tracingEnabled: true,
            workflows: [workflow]
        )
        model.graphSessionState = GraphSessionState(
            selectedNodeID: "node-b",
            sourceLens: .obsidian,
            focusDepth: 2,
            path: GraphPathContext(sourceNodeID: "node-b", targetNodeID: "node-c", variant: "shortest"),
            communityID: "Community One",
            searchQuery: "Beacon"
        )
        let sessionBeforeSelection = model.graphSessionState

        model.selectAgentActivityWorkflow(workflow)
        XCTAssertEqual(model.selectedAgentActivityWorkflowID, workflow.id)
        XCTAssertEqual(model.graphSessionState, sessionBeforeSelection)

        model.selectAgentActivityWorkflow(nil)
        XCTAssertNil(model.selectedAgentActivityWorkflowID)
        XCTAssertEqual(model.graphSessionState, sessionBeforeSelection)
    }

    @MainActor
    func testWorkflowMetadataSurvivesWebRendererSnapshotEncoding() throws {
        let event = AgentActivityEvent(
            id: "workflow-event",
            agent: "codex",
            action: .write,
            path: "Notes/Output.md",
            timestamp: Date(timeIntervalSince1970: 1_700_000_000),
            sessionId: "session-42",
            project: "BrainBar",
            source: "agent",
            reason: "render proof",
            nodeId: "node-a",
            status: "completed",
            workflowId: "workflow-42",
            workflowTitle: "Render proof",
            pathRole: .output
        )
        let snapshot = AgentActivitySnapshot(
            events: [AgentActivityMappedEvent(event: event, node: AgentActivityGraphNode(id: "node-a", label: "Output", sourceFile: "Notes/Output.md"))],
            nodeIds: ["node-a"],
            pendingPaths: [],
            lastEventAt: event.timestamp,
            eventLogPath: "",
            codexIntegrationInstalled: true,
            claudeIntegrationInstalled: false,
            claudeIntegrationPartial: false,
            tracingEnabled: true
        )
        let payload = Graph3DWebView.agentActivityJSON(snapshot)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let decoded = try decoder.decode(AgentActivitySnapshot.self, from: XCTUnwrap(payload.data(using: .utf8)))
        let mapped = try XCTUnwrap(decoded.events.first)
        XCTAssertEqual(mapped.version, 2)
        XCTAssertEqual(mapped.sessionId, "session-42")
        XCTAssertEqual(mapped.project, "BrainBar")
        XCTAssertEqual(mapped.source, "agent")
        XCTAssertEqual(mapped.reason, "render proof")
        XCTAssertEqual(mapped.status, "completed")
        XCTAssertEqual(mapped.workflowId, "workflow-42")
        XCTAssertEqual(mapped.workflowTitle, "Render proof")
        XCTAssertEqual(mapped.pathRole, .output)
    }

    func testSettingsExplainsSharedWorkflowRetentionAndClearDeletion() throws {
        let projectRoot = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
        let settingsURL = projectRoot.appendingPathComponent("BrainBar/Views/SettingsView.swift")
        let settings = try String(contentsOf: settingsURL, encoding: .utf8)
        XCTAssertTrue(settings.contains("Completed workflows share this Agent Activity retention"))
        XCTAssertTrue(settings.contains("Clear deletes Agent Activity and workflow-derived history"))
    }

    func testReviewQueueNormalizationUsesConservativeWatcherMinimum() {
        var reviewQueue = ReviewQueueConfiguration.default
        reviewQueue.isEnabled = true
        reviewQueue.backgroundWatcherEnabled = true
        reviewQueue.watcherIntervalSeconds = 60

        let normalized = reviewQueue.normalized

        XCTAssertEqual(normalized.watcherIntervalSeconds, 300)
        XCTAssertTrue(normalized.backgroundWatcherEnabled)
    }

    func testReviewQueueNormalizationDisablesWatcherWhenFeatureIsDisabled() {
        var reviewQueue = ReviewQueueConfiguration.default
        reviewQueue.isEnabled = false
        reviewQueue.backgroundWatcherEnabled = true

        let normalized = reviewQueue.normalized

        XCTAssertFalse(normalized.backgroundWatcherEnabled)
        XCTAssertEqual(normalized.watcherIntervalSeconds, 300)
    }

    func testReviewQueueParsesValidJSONWithItems() throws {
        let json = """
        {
          "pending_count": 2,
          "items": [
            { "title": "Draft item", "detail": "Needs manual review" },
            "Loose queue item"
          ]
        }
        """

        let status = try ReviewQueueService.parse(json)

        XCTAssertEqual(status.pendingCount, 2)
        XCTAssertEqual(status.items.count, 2)
        XCTAssertEqual(status.items[0].title, "Draft item")
        XCTAssertEqual(status.items[0].detail, "Needs manual review")
        XCTAssertEqual(status.items[1].title, "Loose queue item")
        XCTAssertNil(status.errorMessage)
    }

    func testReviewQueueParsesOptionalGraphTargets() throws {
        let json = """
        {
          "pending_count": 1,
          "items": [
            { "title": "Review graph item", "source_file": "Notes/Alpha.md", "node_id": "alpha" }
          ]
        }
        """

        let status = try ReviewQueueService.parse(json)

        XCTAssertEqual(status.items.first?.sourceFile, "Notes/Alpha.md")
        XCTAssertEqual(status.items.first?.nodeId, "alpha")
    }

    func testReviewQueueRejectsMalformedJSON() {
        XCTAssertThrowsError(try ReviewQueueService.parse("{")) { error in
            XCTAssertEqual(error as? BrainBarError, .processFailed("Review Queue returned invalid JSON."))
        }
    }

    func testReviewQueuePendingZeroIsQuietStatus() throws {
        let status = try ReviewQueueService.parse(#"{ "pending_count": 0 }"#)

        XCTAssertEqual(status.pendingCount, 0)
        XCTAssertTrue(status.items.isEmpty)
        XCTAssertNil(status.errorMessage)
        XCTAssertEqual(status.summary, "Review Queue clear")
    }

    func testReviewQueuePendingGreaterThanZero() throws {
        let status = try ReviewQueueService.parse(#"{ "pending_count": 3 }"#)

        XCTAssertEqual(status.pendingCount, 3)
        XCTAssertEqual(status.summary, "3 pending items")
    }

    func testReviewQueueCommandTimeoutIsCompact() async throws {
        var reviewQueue = ReviewQueueConfiguration.default
        reviewQueue.isEnabled = true
        reviewQueue.timeoutSeconds = 1
        reviewQueue.preflightCommand = CommandSpec(executable: "/bin/sleep", arguments: ["2"], workingDirectory: nil)

        let status = await ReviewQueueService().check(config: reviewQueue, vaultURL: nil)

        XCTAssertEqual(status.errorMessage, "Review Queue timed out after 1s.")
        XCTAssertNil(status.pendingCount)
        XCTAssertTrue(status.items.isEmpty)
    }

    func testGraphServerStartsAndStops() async throws {
        let vault = try temporaryDirectory()
        try FileManager.default.createDirectory(at: vault.appendingPathComponent("graphify-out"), withIntermediateDirectories: true)
        try "ok".write(to: vault.appendingPathComponent("graphify-out/graph.html"), atomically: true, encoding: .utf8)
        let port = try freePort()
        let controller = GraphServerController()

        try await controller.start(vaultURL: vault, port: port)
        let running = await controller.isRunning
        await controller.stop()
        let stopped = await controller.isRunning

        XCTAssertTrue(running)
        XCTAssertFalse(stopped)
    }

    @MainActor
    func testGraphServerDiscardsRepeatedRequestLogs() async throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try "ok".write(to: graphDirectory.appendingPathComponent("graph.html"), atomically: true, encoding: .utf8)
        let port = try freePort()
        let controller = GraphServerController()
        try await controller.start(vaultURL: vault, port: port)
        defer { controller.stop() }

        let baseURL = try XCTUnwrap(URL(string: "http://127.0.0.1:\(port)/graphify-out/graph.html"))
        _ = try await graphServerData(from: baseURL)

        let requestCount = 48
        let queryLength = 3_072
        let requestLinePrefix = "GET /graphify-out/graph.html?"
        let requestLineSuffix = " HTTP/1.1\n"
        let aggregateStressBytes = (requestLinePrefix.utf8.count + queryLength + requestLineSuffix.utf8.count) * requestCount
        XCTAssertGreaterThan(aggregateStressBytes, 128 * 1_024)
        let startedAt = Date()
        for index in 0..<requestCount {
            let queryPrefix = "request=\(index)&payload="
            let query = queryPrefix + String(repeating: "x", count: queryLength - queryPrefix.utf8.count)
            let url = try XCTUnwrap(URL(string: "\(baseURL.absoluteString)?\(query)"))
            let (data, response) = try await graphServerDataOnce(from: url, timeout: 1)
            XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
            XCTAssertEqual(String(data: data, encoding: .utf8), "ok")
        }
        XCTAssertLessThan(Date().timeIntervalSince(startedAt), 6)
    }

    @MainActor
    func testAppModelSavesConfigToOverridePath() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        var config = model.config
        config.vaultPath = "/tmp/example-vault"
        model.saveConfig(config)

        let saved = try manager.load()
        XCTAssertEqual(saved.vaultPath, "/tmp/example-vault")
    }

    @MainActor
    func testAppModelDoesNotReloadUnchangedGraphDuringStatusRefresh() async throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try #"{"nodes":[],"edges":[]}"#.write(
            to: graphDirectory.appendingPathComponent("graph.json"),
            atomically: true,
            encoding: .utf8
        )
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        try manager.save(config)
        let model = AppModel(configurationManager: manager)

        await model.refreshStatus()
        let firstReloadToken = model.graphReloadToken
        await model.refreshStatus()

        XCTAssertTrue(model.status.graphJSONExists)
        XCTAssertEqual(model.graphReloadToken, firstReloadToken)
    }

    @MainActor
    func testChangeRadarRefreshAppendsValidatedSnapshotsAndProjectsOnlySafeIntervalMetadata() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let activity = AgentActivityService(eventLogURL: vault.appendingPathComponent("events.jsonl"))
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let model = AppModel(configurationManager: manager, agentActivityService: activity, graphChangeRadarService: radar)
        activity.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: vault)

        await model.refreshGraph()
        activity.ingestForTesting(AgentActivityEvent(
            id: "radar-safe-event",
            agent: "codex",
            action: .write,
            path: vault.appendingPathComponent("Notes/One.md").path,
            timestamp: Date(),
            sessionId: "private-session",
            project: "private-project",
            source: "private-source",
            reason: "private-reason",
            nodeId: "one",
            status: "private-status"
        ))
        await model.refreshGraph()

        XCTAssertEqual(model.graphChangeRadarSnapshots.count, 2)
        let record = try XCTUnwrap(model.graphChangeRadarSnapshots.last?.activityRecords.first)
        XCTAssertEqual(record.id, "radar-safe-event")
        XCTAssertEqual(record.relativePath, "Notes/One.md")
        XCTAssertEqual(record.nodeID, "one")
        XCTAssertEqual(record.status, "active")
        XCTAssertEqual(record.category, "note")
        XCTAssertTrue(model.graphChangeRadarSnapshots.last?.pendingRelativePaths.isEmpty == true)
        XCTAssertTrue(FileManager.default.fileExists(atPath: graphURL.path))
    }

    @MainActor
    func testChangeRadarRefreshDoesNotAppendForFailedOrInvalidGraph() async throws {
        let failedVault = try temporaryDirectory()
        defer { removeTemporaryDirectory(failedVault) }
        _ = try writeRadarGraph(to: failedVault, nodeStatus: "active")
        let failedManager = try radarConfigurationManager(vault: failedVault, command: "/usr/bin/false")
        let failedRadar = GraphChangeRadarService(applicationSupportDirectory: failedVault.appendingPathComponent("radar"))
        let failedModel = AppModel(configurationManager: failedManager, graphChangeRadarService: failedRadar)

        await failedModel.refreshGraph()
        XCTAssertTrue(failedModel.graphChangeRadarSnapshots.isEmpty)
        let failedSnapshots = await failedRadar.snapshots()
        XCTAssertTrue(failedSnapshots.isEmpty)

        let invalidVault = try temporaryDirectory()
        defer { removeTemporaryDirectory(invalidVault) }
        let invalidGraphURL = invalidVault.appendingPathComponent("graphify-out/graph.json")
        try FileManager.default.createDirectory(at: invalidGraphURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try "not-json".write(to: invalidGraphURL, atomically: true, encoding: .utf8)
        let invalidManager = try radarConfigurationManager(vault: invalidVault, command: "/usr/bin/true")
        let invalidRadar = GraphChangeRadarService(applicationSupportDirectory: invalidVault.appendingPathComponent("radar"))
        let invalidModel = AppModel(configurationManager: invalidManager, graphChangeRadarService: invalidRadar)

        await invalidModel.refreshGraph()
        XCTAssertTrue(invalidModel.graphChangeRadarSnapshots.isEmpty)
        XCTAssertTrue(invalidModel.status.graphJSONExists)
        let invalidSnapshots = await invalidRadar.snapshots()
        XCTAssertTrue(invalidSnapshots.isEmpty)
    }

    @MainActor
    func testChangeRadarThrownRefreshUpdatesStatusWithoutAppendingAndKeepsError() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        _ = try writeRadarGraph(to: vault, nodeStatus: "active")
        let manager = try radarConfigurationManager(vault: vault, command: "/definitely-missing-brainbar-refresh")
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let model = AppModel(configurationManager: manager, graphChangeRadarService: radar)

        await model.refreshGraph()

        XCTAssertTrue(model.status.graphJSONExists)
        XCTAssertFalse(model.errorMessage?.isEmpty ?? true)
        XCTAssertTrue(model.graphChangeRadarSnapshots.isEmpty)
        let snapshots = await radar.snapshots()
        XCTAssertTrue(snapshots.isEmpty)
    }

    @MainActor
    func testChangeRadarOverlappingRefreshesAppendOnlyLatestValidatedAttempt() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let graphData = try Data(contentsOf: graphURL)
        let gate = GraphDataLoaderGate()
        let store = GraphDataStore(dataLoader: { url in await gate.load(url) })
        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let model = AppModel(
            configurationManager: manager,
            radarGraphDataStore: store,
            graphChangeRadarService: radar
        )

        let first = Task { @MainActor in await model.refreshGraph() }
        let firstGateOpened = await waitForRadarGate(gate, count: 1)
        XCTAssertTrue(firstGateOpened)
        let second = Task { @MainActor in await model.refreshGraph() }
        let secondGateOpened = await waitForRadarGate(gate, count: 2)
        XCTAssertTrue(secondGateOpened)
        await gate.resumeLast(with: graphData)
        await gate.resumeFirst(with: graphData)
        await first.value
        await second.value

        XCTAssertEqual(model.graphChangeRadarSnapshots.count, 1)
        let snapshots = await radar.snapshots()
        XCTAssertEqual(snapshots.count, 1)
    }

    @MainActor
    func testChangeRadarPreflightFailureSupersedesHeldOlderRefresh() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let graphData = try Data(contentsOf: graphURL)
        let gate = GraphDataLoaderGate()
        let radarStore = GraphDataStore(dataLoader: { url in await gate.load(url) })
        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let model = AppModel(
            configurationManager: manager,
            radarGraphDataStore: radarStore,
            graphChangeRadarService: radar
        )

        let olderRefresh = Task { @MainActor in await model.refreshGraph() }
        let olderPrepareIsHeld = await waitForRadarGate(gate, count: 1)
        XCTAssertTrue(olderPrepareIsHeld)

        model.config.vaultPath = ""
        await model.refreshGraph()
        XCTAssertFalse(model.errorMessage?.isEmpty ?? true)
        XCTAssertFalse(model.isRefreshingGraph)
        await gate.resumeFirst(with: graphData)
        await olderRefresh.value

        XCTAssertTrue(model.graphChangeRadarSnapshots.isEmpty)
        let snapshots = await radar.snapshots()
        XCTAssertTrue(snapshots.isEmpty)
    }

    @MainActor
    func testChangeRadarRefreshUsesDedicatedStoreWithoutSupersedingRendererPreparation() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let graphData = try Data(contentsOf: graphURL)
        let rendererGate = GraphDataLoaderGate()
        let rendererStore = GraphDataStore(dataLoader: { url in await rendererGate.load(url) })
        let radarStore = GraphDataStore()
        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let model = AppModel(
            configurationManager: manager,
            graphDataStore: rendererStore,
            radarGraphDataStore: radarStore,
            graphChangeRadarService: radar
        )

        let rendererPreparation = Task {
            await rendererStore.prepare(url: graphURL, policy: .retry)
        }
        let rendererIsHeld = await waitForRadarGate(rendererGate, count: 1)
        XCTAssertTrue(rendererIsHeld)

        await model.refreshGraph()

        XCTAssertEqual(model.graphChangeRadarSnapshots.count, 1)
        await rendererGate.resumeFirst(with: graphData)
        let rendererResult = await rendererPreparation.value
        XCTAssertNotNil(rendererResult.readyHandle)
    }

    @MainActor
    func testChangeRadarAppendIfCurrentRejectsStaleAttemptAtActorCommit() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let store = GraphDataStore()
        let preparation = await store.prepare(url: graphURL, policy: .retry)
        let handle = try XCTUnwrap(preparation.readyHandle)
        let seedValue = await store.radarSeed(for: handle)
        let seed = try XCTUnwrap(seedValue)
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let gate = GraphChangeRadarCommitGate()
        let attemptGate = GraphChangeRadarAttemptGate()
        let firstAttempt = attemptGate.begin()

        let append = Task { @MainActor in
            try await radar.appendIfCurrent(
                validatedHandle: handle,
                seed: seed,
                beforeCurrentClaim: {
                    await gate.waitForFirstClaim()
                },
                currentAttemptIsCurrent: {
                    attemptGate.claimIfCurrent(firstAttempt)
                }
            )
        }
        let appendIsHeld = await waitForRadarCommitGate(gate)
        XCTAssertTrue(appendIsHeld)
        _ = attemptGate.begin()
        await gate.resume()

        let appendResult = try await append.value
        XCTAssertNil(appendResult)
        let snapshots = await radar.snapshots()
        XCTAssertTrue(snapshots.isEmpty)
    }

    @MainActor
    func testChangeRadarRefreshRejectsOlderAppendWhenNewerAttemptStartsBeforeClaim() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        _ = try writeRadarGraph(to: vault, nodeStatus: "active")
        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let claimGate = GraphChangeRadarCommitGate()
        let model = AppModel(
            configurationManager: manager,
            graphChangeRadarService: radar,
            graphChangeRadarPreClaimHook: {
                await claimGate.waitForFirstClaim()
            }
        )

        let first = Task { @MainActor in await model.refreshGraph() }
        let firstClaimIsHeld = await waitForRadarCommitGate(claimGate)
        XCTAssertTrue(firstClaimIsHeld)
        let second = Task { @MainActor in await model.refreshGraph() }
        let secondClaimWasReached = await waitForRadarCommitGate(claimGate, count: 2)
        XCTAssertTrue(secondClaimWasReached)
        await claimGate.resume()
        await first.value
        await second.value

        XCTAssertEqual(model.graphChangeRadarSnapshots.count, 1)
        let snapshots = await radar.snapshots()
        XCTAssertEqual(snapshots.count, 1)
    }

    @MainActor
    func testChangeRadarLoadClearAndInboxActionsStaySessionLocal() async throws {
        let vault = try temporaryDirectory()
        defer { removeTemporaryDirectory(vault) }
        let graphURL = try writeRadarGraph(to: vault, nodeStatus: "active")
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("radar"))
        let firstPreparation = await store.prepare(url: graphURL, policy: .retry)
        let firstHandle = try XCTUnwrap(firstPreparation.readyHandle)
        let firstSeedValue = await store.radarSeed(for: firstHandle)
        let firstSeed = try XCTUnwrap(firstSeedValue)
        _ = try await radar.append(validatedHandle: firstHandle, seed: firstSeed)
        _ = try writeRadarGraph(to: vault, nodeStatus: "review")
        let secondPreparation = await store.prepare(url: graphURL, policy: .retry)
        let secondHandle = try XCTUnwrap(secondPreparation.readyHandle)
        let secondSeedValue = await store.radarSeed(for: secondHandle)
        let secondSeed = try XCTUnwrap(secondSeedValue)
        _ = try await radar.append(
            validatedHandle: secondHandle,
            seed: secondSeed,
            activityWindow: .init(
                records: [
                    .init(id: "persisted-touch", action: .write, agent: "codex", timestamp: Date(), relativePath: "Notes/One.md", nodeID: "one", status: "review", category: "note"),
                    .init(id: "persisted-pending", action: .write, agent: "codex", timestamp: Date(), relativePath: "Notes/Pending.md")
                ],
                pendingRelativePaths: ["Notes/Pending.md"]
            )
        )

        let manager = try radarConfigurationManager(vault: vault, command: "/usr/bin/true")
        let model = AppModel(configurationManager: manager, graphDataStore: store, graphChangeRadarService: radar)
        await model.loadGraphChangeRadar()
        let item = try XCTUnwrap(model.graphChangeRadarInbox.first(where: { $0.nodeID == "one" }))
        XCTAssertTrue(model.graphChangeRadarInbox.contains(where: { $0.title == "Touched during interval" }))
        XCTAssertTrue(model.graphChangeRadarInbox.contains(where: { $0.title == "Pending path touched during interval" }))

        model.revealGraphChangeRadarInboxItem(item)
        XCTAssertEqual(model.graphSessionState.selectedNodeID, "one")
        XCTAssertEqual(model.graphViewportCommand?.kind, .revealNode3D)
        model.focusGraphChangeRadarInboxItem(item)
        XCTAssertEqual(model.graphSessionState.focusDepth, 1)
        model.compareGraphChangeRadarInboxItem(item)
        XCTAssertTrue(model.expandedGraphChangeRadarInboxItemIDs.contains(item.id))
        model.dismissGraphChangeRadarInboxItem(item)
        XCTAssertFalse(model.graphChangeRadarInbox.contains(item))
        for remainingItem in model.graphChangeRadarInbox {
            model.dismissGraphChangeRadarInboxItem(remainingItem)
        }
        XCTAssertTrue(model.graphChangeRadarInbox.isEmpty)
        XCTAssertEqual(model.graphChangeRadarSummary, "All changes dismissed")
        XCTAssertEqual(model.graphChangeRadarEmptyStateMessage, "All latest items were dismissed.")

        let zeroRadar = GraphChangeRadarService(applicationSupportDirectory: vault.appendingPathComponent("zero-radar"))
        _ = try await zeroRadar.append(validatedHandle: firstHandle, seed: firstSeed)
        _ = try await zeroRadar.append(validatedHandle: firstHandle, seed: firstSeed)
        let zeroModel = AppModel(configurationManager: manager, graphChangeRadarService: zeroRadar)
        await zeroModel.loadGraphChangeRadar()
        XCTAssertTrue(zeroModel.graphChangeRadarInbox.isEmpty)
        XCTAssertEqual(zeroModel.graphChangeRadarEmptyStateMessage, "No changes detected in the latest refresh.")

        await model.clearGraphChangeRadar()
        XCTAssertTrue(model.graphChangeRadarSnapshots.isEmpty)
        XCTAssertEqual(model.graphChangeRadarEmptyStateMessage, "Refresh Graph to capture a validated before/after snapshot.")
        let clearedSnapshots = await radar.snapshots()
        XCTAssertTrue(clearedSnapshots.isEmpty)
    }

    @MainActor
    func testAppModelGraphSourceLensIsSessionOnly() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        let initialConfig = model.config

        model.setGraphSourceLens(.obsidian)

        XCTAssertEqual(model.graphSourceLens, .obsidian)
        XCTAssertEqual(model.config, initialConfig)
    }

    @MainActor
    func testAppModelGraphViewModeIsSessionOnly() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        let initialConfig = model.config

        XCTAssertEqual(model.graphViewMode, .threeD)

        model.setGraphViewMode(.twoD)

        XCTAssertEqual(model.graphViewMode, .twoD)
        XCTAssertEqual(model.graphSourceLens, .all)
        XCTAssertEqual(model.config, initialConfig)
    }

    @MainActor
    func testAppModelGraphSessionStateSurvivesRendererRoundTrip() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        let expected = GraphSessionState(
            graphVersion: "digest-v1",
            selectedNodeID: " note-a ",
            sourceLens: .obsidian,
            focusDepth: 2,
            path: GraphPathContext(sourceNodeID: " note-a ", targetNodeID: "note-b", variant: "explain"),
            communityID: "Community 4",
            searchQuery: "decision"
        )

        model.updateGraphSessionState(expected)
        model.setGraphViewMode(.twoD)
        model.setGraphViewMode(.threeD)
        model.setGraphViewMode(.twoD)

        XCTAssertEqual(model.graphSessionState, expected)
        XCTAssertEqual(model.graphSourceLens, .obsidian)
        XCTAssertTrue(model.errorMessage?.contains("kept its endpoints") == true)
    }

    @MainActor
    func testAppModelGraphSessionRejectsUnknownSchemaAndNormalizesDepth() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": directory.appendingPathComponent("config.json").path]
        let model = AppModel(configurationManager: manager)
        var future = GraphSessionState(selectedNodeID: "future")
        future.schemaVersion = 3

        model.updateGraphSessionState(future)
        XCTAssertNil(model.graphSessionState.selectedNodeID)

        model.updateGraphSessionState(GraphSessionState(
            selectedNodeID: "node",
            focusDepth: 99,
            path: GraphPathContext(sourceNodeID: "node", variant: "  ")
        ))
        XCTAssertEqual(model.graphSessionState.focusDepth, 3)
        XCTAssertEqual(model.graphSessionState.path?.variant, "shortest")
    }

    @MainActor
    func testGraphSessionBridgeJSONPreservesCompleteSemanticContext() throws {
        let state = GraphSessionState(
            graphVersion: "digest-v2",
            selectedNodeID: "node-a",
            sourceLens: .graphify,
            focusDepth: 3,
            path: GraphPathContext(sourceNodeID: "node-a", targetNodeID: "node-b", variant: "explain"),
            communityID: "Community 7",
            searchQuery: "status:active",
            cameraState: GraphCameraState(
                position: GraphVector3(x: 10, y: 20, z: 30),
                target: GraphVector3(x: 1, y: 2, z: 3),
                zoom: 1.5,
                preset: "Manual"
            )
        )
        let json = Graph3DWebView.graphSessionJSON(state)
        let data = try XCTUnwrap(json.data(using: .utf8))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])

        XCTAssertEqual(Graph3DWebView.decodeGraphSessionState(object), state)
        XCTAssertEqual(GraphWebView.decodeGraphSessionState(object), state)

        var futureObject = object
        futureObject["schemaVersion"] = 3
        XCTAssertNil(Graph3DWebView.decodeGraphSessionState(futureObject))
        XCTAssertNil(GraphWebView.decodeGraphSessionState(futureObject))
    }

    @MainActor
    func testSavedGraphViewsPersistReferencesAndDisplayStateWithoutNoteContent() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let savedViewsURL = directory.appendingPathComponent("saved-views.json")
        let store = SavedGraphViewStore(fileURL: savedViewsURL)
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": directory.appendingPathComponent("config.json").path]
        let model = AppModel(configurationManager: manager, savedGraphViewStore: store)
        model.graphViewMode = .threeD
        model.updateGraphSessionState(GraphSessionState(
            graphVersion: "digest-v1",
            selectedNodeID: "node-a",
            sourceLens: .graphify,
            focusDepth: 2,
            path: GraphPathContext(sourceNodeID: "node-a", targetNodeID: "node-b", variant: "shortest"),
            communityID: "Research",
            searchQuery: "status:active",
            cameraState: GraphCameraState(
                position: GraphVector3(x: 10, y: 20, z: 30),
                target: GraphVector3(x: 1, y: 2, z: 3),
                zoom: 1.5,
                preset: "Manual"
            )
        ))

        await model.saveCurrentGraphView(named: "Active decisions")

        XCTAssertEqual(model.savedGraphViews.count, 1)
        let saved = try XCTUnwrap(model.savedGraphViews.first)
        XCTAssertEqual(saved.session, model.graphSessionState)
        let serialized = try String(contentsOf: savedViewsURL, encoding: .utf8)
        XCTAssertFalse(serialized.contains("NOTE_CONTENT_SENTINEL"))
        XCTAssertFalse(serialized.contains("source_file"))
        XCTAssertFalse(serialized.contains("label"))

        model.graphViewMode = .twoD
        model.updateGraphSessionState(GraphSessionState())
        model.applySavedGraphView(saved)
        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertEqual(model.graphSessionState, saved.session)

        await model.deleteSavedGraphView(saved)
        XCTAssertTrue(model.savedGraphViews.isEmpty)
        let persistedViews = try await store.load()
        XCTAssertTrue(persistedViews.isEmpty)
    }

    @MainActor
    func testAppModelGraphHealthPreservesActiveRendererWhenWorkbenchExists() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        var status = VaultStatus.empty
        status.graphHtmlExists = true
        status.graphJSONExists = true
        model.status = status

        model.showGraphHealth()

        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertEqual(model.graphViewportCommand?.kind, .graphHealth)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor
    func testAppModelGraphHealthWorksForJSONOnlyGraph() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        var status = VaultStatus.empty
        status.graphJSONExists = true
        model.status = status

        model.showGraphHealth()

        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertEqual(model.graphViewportCommand?.kind, .graphHealth)
        XCTAssertNil(model.errorMessage)
    }

    @MainActor
    func testAppModelGraphHealthReportsMissingGraphOutput() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)

        model.showGraphHealth()

        XCTAssertEqual(model.graphViewMode, .threeD)
        XCTAssertNil(model.graphViewportCommand)
        XCTAssertEqual(
            model.errorMessage,
            "Graph Check requires Graphify output. Generate the graph before opening Graph Check."
        )
    }

    @MainActor
    func testAppModelGraphViewportCommandsAreSessionOnly() throws {
        let directory = try temporaryDirectory()
        let configURL = directory.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        let model = AppModel(configurationManager: manager)
        let initialConfig = model.config

        model.zoomGraphIn()
        let firstCommand = model.graphViewportCommand
        model.fitGraphView()
        let secondCommand = model.graphViewportCommand
        model.resetGraph3DTilt()

        XCTAssertEqual(firstCommand?.kind, .zoomIn)
        XCTAssertEqual(secondCommand?.kind, .fit)
        XCTAssertEqual(model.graphViewportCommand?.kind, .resetTilt)
        XCTAssertNotEqual(firstCommand?.id, secondCommand?.id)
        XCTAssertNotEqual(secondCommand?.id, model.graphViewportCommand?.id)
        XCTAssertEqual(model.config, initialConfig)
    }

    func testAgentActivityParsesValidJSONLEvent() throws {
        let line = #"{"version":1,"agent":"codex","action":"read","path":"Notes/Example.md","timestamp":"2026-06-11T08:00:00.000Z","reason":"context"}"#

        let event = try XCTUnwrap(AgentActivityEventParser.parse(line))

        XCTAssertEqual(event.agent, "codex")
        XCTAssertEqual(event.action, .read)
        XCTAssertEqual(event.path, "Notes/Example.md")
        XCTAssertEqual(event.reason, "context")
    }

    func testAgentActivityRejectsMalformedJSONL() {
        XCTAssertNil(AgentActivityEventParser.parse("{"))
    }

    func testAgentActivityLogRetentionKeepsRecentEventsOnly() throws {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let oldEvent = AgentActivityEvent(agent: "codex", action: .read, path: "Old.md", timestamp: now.addingTimeInterval(-AgentActivityLogRetention.maxAge - 60))
        let recentEvent = AgentActivityEvent(agent: "codex", action: .write, path: "Recent.md", timestamp: now)
        let oldLine = try agentActivityJSONLine(oldEvent)
        let recentLine = try agentActivityJSONLine(recentEvent)
        let retained = AgentActivityLogRetention.retainedLines(
            from: oldLine + "\n" + "{bad json}\n" + recentLine + "\n",
            cutoff: now.addingTimeInterval(-AgentActivityLogRetention.maxAge)
        )

        XCTAssertEqual(retained, [recentLine])
    }

    func testAgentActivityLogRetentionCapsLineCount() throws {
        let now = Date(timeIntervalSince1970: 2_000_000)
        let maxLines = AgentActivityLogRetention.maxLines
        let lines = try (0..<(maxLines + 4)).map { offset in
            try agentActivityJSONLine(
                AgentActivityEvent(
                    agent: "codex",
                    action: .read,
                    path: "Note-\(offset).md",
                    timestamp: now.addingTimeInterval(TimeInterval(offset))
                )
            )
        }
        let retained = AgentActivityLogRetention.retainedLines(
            from: lines.joined(separator: "\n"),
            cutoff: now.addingTimeInterval(-AgentActivityLogRetention.maxAge)
        )

        XCTAssertEqual(retained.count, maxLines)
        XCTAssertFalse(retained.contains(lines[0]))
        XCTAssertTrue(retained.contains(lines.last!))
    }

    func testAgentActivityGraphIndexMapsNodeIdPathAndPending() throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try """
        {
          "nodes": [
            { "id": "alpha", "label": "Alpha", "source_file": "Notes/Alpha.md", "source_location": "L1" },
            { "id": "alpha_links", "label": "Links", "source_file": "Notes/Alpha.md", "source_location": "L40" }
          ],
          "edges": []
        }
        """.write(to: graphDirectory.appendingPathComponent("graph.json"), atomically: true, encoding: .utf8)
        let index = AgentActivityGraphIndex.load(readAccessURL: graphDirectory)
        let timestamp = Date(timeIntervalSince1970: 1)
        let direct = AgentActivityEvent(agent: "codex", action: .read, path: "Notes/Other.md", timestamp: timestamp, nodeId: "alpha")
        let byPath = AgentActivityEvent(agent: "codex", action: .write, path: "Notes/Alpha.md", timestamp: timestamp)
        let missing = AgentActivityEvent(agent: "codex", action: .write, path: "Notes/Missing.md", timestamp: timestamp)

        XCTAssertEqual(index.node(for: direct)?.id, "alpha")
        XCTAssertEqual(index.node(for: byPath)?.id, "alpha")
        XCTAssertNil(index.node(for: missing))
    }

    func testAgentActivityConfigurationMigratesPrivacyDefaults() throws {
        let decoded = try JSONDecoder().decode(
            AgentActivityConfiguration.self,
            from: Data(#"{"eventTracingEnabled":true}"#.utf8)
        )

        XCTAssertTrue(decoded.eventTracingEnabled)
        XCTAssertTrue(decoded.fileActivityEnabled)
        XCTAssertEqual(decoded.retentionDays, 7)
        XCTAssertTrue(decoded.fileActivityExclusions.isEmpty)
        XCTAssertEqual(AgentActivityConfiguration(eventTracingEnabled: false, fileActivityEnabled: true, fileActivityExclusions: [" /Drafts/*/ ", "Drafts/*"], retentionDays: 500).normalized.retentionDays, 90)
    }

    func testAgentActivityExclusionsIncludeDefaultsAndGlobs() {
        XCTAssertFalse(AgentActivityService.shouldTrackFile(".git/config.md"))
        XCTAssertFalse(AgentActivityService.shouldTrackFile("graphify-out/Graph.md"))
        XCTAssertFalse(AgentActivityService.shouldTrackFile("Notes/.private/Plan.md"))
        XCTAssertFalse(AgentActivityService.shouldTrackFile("Drafts/secret.md", exclusions: ["Drafts/*"]))
        XCTAssertTrue(AgentActivityService.shouldTrackFile("Notes/Plan.md", exclusions: ["Drafts/*"]))
    }

    @MainActor
    func testAgentActivityHistoryUsesCursorBoundsAndPathProjection() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: directory)
        let first = AgentActivityEvent(agent: "codex", action: .write, path: directory.appendingPathComponent("Notes/One.md").path, timestamp: Date(), sessionId: "session", project: "BrainBar", source: "test", reason: "reason", nodeId: "node", status: "done")
        service.ingestForTesting(first)
        let upper = service.captureHistoryCursor()
        service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .read, path: directory.appendingPathComponent("Notes/Two.md").path, timestamp: Date().addingTimeInterval(1)))

        let records = service.history(afterExclusive: nil, throughInclusive: upper, matchingNodeIDs: [], matchingRelativePaths: [])
        XCTAssertEqual(records.count, 1)
        XCTAssertEqual(records.first?.relativePath, "Notes/One.md")
        XCTAssertEqual(records.first?.sessionId, "session")
        XCTAssertEqual(records.first?.project, "BrainBar")
        XCTAssertEqual(records.first?.source, "test")
        XCTAssertEqual(records.first?.reason, "reason")
        XCTAssertEqual(records.first?.status, "done")
        XCTAssertEqual(service.currentSnapshot.events.first?.path, directory.appendingPathComponent("Notes/Two.md").path)
    }

    @MainActor
    func testAgentActivityClearResetsGenerationAndPreviewIsContentFree() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: directory)
        service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .write, path: directory.appendingPathComponent("Note.md").path, timestamp: Date()))
        let before = service.captureHistoryCursor()
        service.clearHistory()
        let after = service.captureHistoryCursor()

        XCTAssertNotEqual(before.generation, after.generation)
        XCTAssertTrue(service.history(afterExclusive: nil, throughInclusive: after, matchingNodeIDs: [], matchingRelativePaths: []).isEmpty)
        XCTAssertTrue(AgentActivityPrivacyPreview.retainedFields.contains("relativePath"))
        XCTAssertFalse(AgentActivityPrivacyPreview.retainedFields.contains("contents"))
        XCTAssertTrue(AgentActivityPrivacyPreview.excludedContentDescription.contains("note bodies"))
    }

    @MainActor
    func testAgentActivityTailHandlesPartialRotationTruncationAndRecreation() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: .init(eventTracingEnabled: true, fileActivityEnabled: false), vaultURL: directory)
        let first = AgentActivityEvent(agent: "codex", action: .read, path: "One.md", timestamp: Date())
        let firstLine = try agentActivityJSONLine(first)
        try firstLine.write(to: log, atomically: true, encoding: .utf8)
        await service.tailNowForTesting()
        XCTAssertTrue(service.currentSnapshot.events.isEmpty)

        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\n".utf8))
        try handle.close()
        await service.tailNowForTesting()
        XCTAssertEqual(service.currentSnapshot.events.count, 1)

        let second = AgentActivityEvent(agent: "claude", action: .write, path: "Two.md", timestamp: Date().addingTimeInterval(1))
        try (try agentActivityJSONLine(second) + "\n").write(to: log, atomically: true, encoding: .utf8)
        await service.tailNowForTesting()
        XCTAssertEqual(service.currentSnapshot.events.count, 2)

        try Data().write(to: log, options: .atomic)
        await service.tailNowForTesting()
        try (try agentActivityJSONLine(AgentActivityEvent(agent: "codex", action: .delete, path: "Three.md", timestamp: Date().addingTimeInterval(2))) + "\n").write(to: log, atomically: true, encoding: .utf8)
        await service.tailNowForTesting()
        XCTAssertEqual(service.currentSnapshot.events.count, 3)
    }

    @MainActor
    func testAgentActivityInitialRetentionWithoutRewritePreservesTailDedupBeyondLiveLimit() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: .init(eventTracingEnabled: true, fileActivityEnabled: false), vaultURL: directory)
        let now = Date()
        let initialLines = try (0..<161).map { index in
            try agentActivityJSONLine(
                AgentActivityEvent(agent: "codex", action: .read, path: "Notes/\(index).md", timestamp: now.addingTimeInterval(TimeInterval(index)))
            )
        }
        try Data((initialLines.joined(separator: "\n") + "\n").utf8).write(to: log, options: .atomic)
        await service.tailNowForTesting()
        let before = service.captureHistoryCursor()
        XCTAssertEqual(before.ingestionSequence, 161)

        let appended = AgentActivityEvent(agent: "codex", action: .write, path: "Notes/appended.md", timestamp: now.addingTimeInterval(200))
        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((try agentActivityJSONLine(appended) + "\n").utf8))
        try handle.close()
        await service.tailNowForTesting()

        let after = service.captureHistoryCursor()
        XCTAssertEqual(after.ingestionSequence, 162)
        let records = service.history(afterExclusive: nil, throughInclusive: after, matchingNodeIDs: [], matchingRelativePaths: [])
        XCTAssertEqual(records.count, 162)
        XCTAssertEqual(records.last?.relativePath, "Notes/appended.md")
    }

    @MainActor
    func testAgentActivityRetentionRewriteRebasesTailBeforeAppend() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: .init(eventTracingEnabled: true, fileActivityEnabled: false), vaultURL: directory)
        let now = Date()
        let lines = try (0..<(AgentActivityLogRetention.maxLines + 1)).map { index in
            try agentActivityJSONLine(AgentActivityEvent(agent: "codex", action: .read, path: "Notes/\(index).md", timestamp: now.addingTimeInterval(TimeInterval(index))))
        }
        try Data((lines.joined(separator: "\n") + "\n").utf8).write(to: log, options: .atomic)
        await service.tailNowForTesting()
        let before = service.captureHistoryCursor()

        let appended = AgentActivityEvent(agent: "codex", action: .write, path: "Notes/final.md", timestamp: now.addingTimeInterval(20_000))
        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data((try agentActivityJSONLine(appended) + "\n").utf8))
        try handle.close()
        await service.tailNowForTesting()

        XCTAssertEqual(service.captureHistoryCursor().ingestionSequence, before.ingestionSequence + 1)
        XCTAssertEqual(service.history(afterExclusive: before, throughInclusive: service.captureHistoryCursor(), matchingNodeIDs: [], matchingRelativePaths: []).map(\.relativePath), ["Notes/final.md"])
    }

    @MainActor
    func testAgentActivityStartupPartialLineSurvivesRetentionCheck() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: .init(eventTracingEnabled: true, fileActivityEnabled: false), vaultURL: directory)
        let line = try agentActivityJSONLine(AgentActivityEvent(agent: "codex", action: .write, path: "Notes/partial.md", timestamp: Date()))
        try line.write(to: log, atomically: true, encoding: .utf8)
        await service.tailNowForTesting(initial: true)
        XCTAssertEqual(service.captureHistoryCursor().ingestionSequence, 0)
        let handle = try FileHandle(forWritingTo: log)
        try handle.seekToEnd()
        try handle.write(contentsOf: Data("\n".utf8))
        try handle.close()
        await service.tailNowForTesting()
        XCTAssertEqual(service.captureHistoryCursor().ingestionSequence, 1)
    }

    @MainActor
    func testAgentActivityDirectoryRescanReappliesVaultRelativeExclusions() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphOutput = directory.appendingPathComponent("graphify-out/Sub")
        let hidden = directory.appendingPathComponent(".hidden")
        let excluded = directory.appendingPathComponent("Private")
        let visible = directory.appendingPathComponent("Notes")
        for folder in [graphOutput, hidden, excluded, visible] {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        }
        for url in [graphOutput.appendingPathComponent("Generated.md"), hidden.appendingPathComponent("Hidden.md"), excluded.appendingPathComponent("Secret.md"), visible.appendingPathComponent("Visible.md")] {
            try "metadata only".write(to: url, atomically: true, encoding: .utf8)
        }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: true, fileActivityExclusions: ["Private/*"]), vaultURL: directory)

        let excludedPaths = service.fileActivityPathsForTesting([graphOutput.deletingLastPathComponent().path, hidden.path, excluded.path])
        XCTAssertTrue(excludedPaths.isEmpty)
        XCTAssertEqual(service.fileActivityPathsForTesting([visible.path]), ["Notes/Visible.md"])
    }

    @MainActor
    func testAgentActivityWatcherLifecycleStopsNativeLogSource() throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.start(
            config: .init(eventTracingEnabled: true, fileActivityEnabled: false),
            vaultURL: directory,
            graphReadAccessURL: nil
        ) { _ in }

        XCTAssertTrue(service.monitoringStateForTesting.eventLog)
        service.stop()
        XCTAssertFalse(service.monitoringStateForTesting.eventLog)
        XCTAssertFalse(service.monitoringStateForTesting.vault)
    }

    @MainActor
    func testAgentActivityNativeLogWatcherDeliversFilesystemWrite() async throws {
        let directory = try temporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let service = AgentActivityService(eventLogURL: log)
        let delivered = expectation(description: "filesystem write delivered")
        service.start(
            config: .init(eventTracingEnabled: true, fileActivityEnabled: false),
            vaultURL: directory,
            graphReadAccessURL: nil
        ) { snapshot in
            if snapshot.events.contains(where: { $0.path == "Notes/Callback.md" }) {
                delivered.fulfill()
            }
        }

        try AgentActivityTraceWriter.write(
            AgentActivityEvent(agent: "codex", action: .write, path: "Notes/Callback.md", timestamp: Date()),
            to: log
        )
        await fulfillment(of: [delivered], timeout: 2)
        service.stop()
    }

    func testAgentActivityCodexInstallerIsIdempotentAndProtectsUnmanagedSkill() throws {
        let home = try temporaryDirectory()
        let source = try temporaryDirectory()
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "skill".write(to: source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".codex/skills"), withIntermediateDirectories: true)
        let installer = AgentActivityCodexInstaller(homeURL: home, sourceURL: source)

        XCTAssertEqual(try installer.install(), .installed)
        XCTAssertTrue(installer.isInstalled())
        XCTAssertTrue(installer.agentsInstructionsInstalled())
        let agentsText = try String(contentsOf: installer.agentsURL, encoding: .utf8)
        XCTAssertTrue(agentsText.contains("BEGIN BRAINBAR AGENT TRACE"))
        XCTAssertTrue(agentsText.contains("brainbar-trace read"))
        XCTAssertEqual(try installer.install(), .installed)

        try FileManager.default.removeItem(at: installer.markerURL)
        XCTAssertEqual(try installer.install(), .existingUnmanagedSkill)
    }

    func testAgentActivityCodexInstallerUpdatesManagedAgentsBlockWithoutDuplicating() throws {
        let home = try temporaryDirectory()
        let source = try temporaryDirectory()
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        try "skill".write(to: source.appendingPathComponent("SKILL.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".codex/skills"), withIntermediateDirectories: true)
        let agentsURL = home.appendingPathComponent(".codex/AGENTS.md")
        try """
        # User Instructions

        Keep this line.
        <!-- BEGIN BRAINBAR AGENT TRACE -->
        old managed text
        <!-- END BRAINBAR AGENT TRACE -->

        Keep this footer.
        """.write(to: agentsURL, atomically: true, encoding: .utf8)
        let installer = AgentActivityCodexInstaller(homeURL: home, sourceURL: source)

        XCTAssertEqual(try installer.install(), .installed)
        XCTAssertEqual(try installer.install(), .installed)

        let text = try String(contentsOf: agentsURL, encoding: .utf8)
        XCTAssertTrue(text.contains("Keep this line."))
        XCTAssertTrue(text.contains("Keep this footer."))
        XCTAssertFalse(text.contains("old managed text"))
        XCTAssertEqual(text.components(separatedBy: "BEGIN BRAINBAR AGENT TRACE").count - 1, 1)
        XCTAssertEqual(text.components(separatedBy: "END BRAINBAR AGENT TRACE").count - 1, 1)
    }

    func testAgentActivityClaudeInstallerInstallsFallbackAndSkillSource() throws {
        let home = try temporaryDirectory()
        let source = try temporaryDirectory()
        try FileManager.default.createDirectory(
            at: source.appendingPathComponent(".claude-plugin"),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: source.appendingPathComponent("skills/brainbar-agent-trace"),
            withIntermediateDirectories: true
        )
        try "{}".write(to: source.appendingPathComponent(".claude-plugin/plugin.json"), atomically: true, encoding: .utf8)
        try "skill".write(to: source.appendingPathComponent("skills/brainbar-agent-trace/SKILL.md"), atomically: true, encoding: .utf8)
        try FileManager.default.createDirectory(at: home.appendingPathComponent(".claude/skill-sources"), withIntermediateDirectories: true)
        let installer = AgentActivityClaudeInstaller(homeURL: home, sourceURL: source)

        XCTAssertEqual(try installer.install(), .installed)
        XCTAssertTrue(installer.isInstalled())
        XCTAssertTrue(installer.claudeInstructionsInstalled())
        XCTAssertEqual(try installer.install(), .installed)

        let text = try String(contentsOf: installer.claudeInstructionsURL, encoding: .utf8)
        XCTAssertTrue(text.contains("BEGIN BRAINBAR AGENT TRACE"))
        XCTAssertTrue(text.contains("brainbar-trace read"))
        XCTAssertTrue(text.contains("--agent claude"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: installer.markerURL.path))

        try FileManager.default.removeItem(at: installer.markerURL)
        XCTAssertEqual(try installer.install(), .existingUnmanagedSkill)
    }

    func testAgentActivityClaudeInstallerUpdatesManagedInstructionsWithoutDuplicating() throws {
        let home = try temporaryDirectory()
        let source = try temporaryDirectory()
        try FileManager.default.createDirectory(
            at: source.appendingPathComponent(".claude-plugin"),
            withIntermediateDirectories: true
        )
        try FileManager.default.createDirectory(
            at: source.appendingPathComponent("skills/brainbar-agent-trace"),
            withIntermediateDirectories: true
        )
        try "{}".write(to: source.appendingPathComponent(".claude-plugin/plugin.json"), atomically: true, encoding: .utf8)
        try "skill".write(to: source.appendingPathComponent("skills/brainbar-agent-trace/SKILL.md"), atomically: true, encoding: .utf8)
        let claudeURL = home.appendingPathComponent(".claude/CLAUDE.md")
        try FileManager.default.createDirectory(at: claudeURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try """
        # User Instructions

        Keep this line.
        <!-- BEGIN BRAINBAR AGENT TRACE -->
        old managed text
        <!-- END BRAINBAR AGENT TRACE -->

        Keep this footer.
        """.write(to: claudeURL, atomically: true, encoding: .utf8)
        let installer = AgentActivityClaudeInstaller(homeURL: home, sourceURL: source)

        XCTAssertEqual(try installer.install(), .partial)
        XCTAssertEqual(try installer.install(), .partial)

        let text = try String(contentsOf: claudeURL, encoding: .utf8)
        XCTAssertTrue(text.contains("Keep this line."))
        XCTAssertTrue(text.contains("Keep this footer."))
        XCTAssertFalse(text.contains("old managed text"))
        XCTAssertEqual(text.components(separatedBy: "BEGIN BRAINBAR AGENT TRACE").count - 1, 1)
        XCTAssertEqual(text.components(separatedBy: "END BRAINBAR AGENT TRACE").count - 1, 1)
    }

    func testAgentActivityClaudeInstallerReturnsPartialWithoutSkillSourcesDirectory() throws {
        let home = try temporaryDirectory()
        let source = try temporaryDirectory()
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        let installer = AgentActivityClaudeInstaller(homeURL: home, sourceURL: source)

        XCTAssertEqual(try installer.install(), .partial)
        XCTAssertTrue(installer.claudeInstructionsInstalled())
        XCTAssertTrue(installer.isPartiallyInstalled())
        XCTAssertFalse(installer.isInstalled())
    }

    private func agentActivityJSONLine(_ event: AgentActivityEvent) throws -> String {
        var payload: [String: Any] = [
            "version": event.version,
            "agent": event.agent,
            "action": event.action.rawValue,
            "path": event.path,
            "timestamp": AgentActivityDateCoding.string(from: event.timestamp)
        ]
        payload["node_id"] = event.nodeId
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        return String(data: data, encoding: .utf8)!
    }

    @MainActor
    private func graphServerData(from url: URL) async throws -> (Data, URLResponse) {
        var lastError: Error?
        for _ in 0..<20 {
            do {
                return try await graphServerDataOnce(from: url, timeout: 0.25)
            } catch {
                lastError = error
                try? await Task.sleep(nanoseconds: 50_000_000)
            }
        }
        throw lastError ?? BrainBarError.processFailed("Graph server did not respond.")
    }

    @MainActor
    private func graphServerDataOnce(from url: URL, timeout: TimeInterval) async throws -> (Data, URLResponse) {
        var request = URLRequest(url: url)
        request.timeoutInterval = timeout
        return try await URLSession.shared.data(for: request)
    }

    @MainActor
    private func collectRendererMeasurement(payloadDirectory: URL, threeDDirectory: URL, twoDHTMLURL: URL, expected: RendererCounts, query: String, requiresLayoutCacheHit: Bool = false, requiresLayoutCacheStored: Bool = false) async throws -> RendererMeasurementSample {
        let residentBefore = appProcessResidentBytes()
        let transportPreparationStartedAt = Date()
        _ = Graph3DWebView.graphResourceVersion(readAccessURL: payloadDirectory)
        let transportPreparationMs = milliseconds(since: transportPreparationStartedAt)
        let residentAfterTransportPreparation = appProcessResidentBytes()

        let threeDMeasurement = try await measureThreeDRenderer(graphDirectory: threeDDirectory, expected: expected, query: query, requiresLayoutCacheHit: requiresLayoutCacheHit, requiresLayoutCacheStored: requiresLayoutCacheStored)
        let residentAfterThreeDTeardown = appProcessResidentBytes()
        let twoDMeasurement = try await measureTwoDRuntime(htmlURL: twoDHTMLURL, expected: expected, query: query)
        let residentAfterTwoDTeardown = appProcessResidentBytes()

        return RendererMeasurementSample(
            graphTransportPreparationMs: transportPreparationMs,
            appProcessResidentDeltaAfterTransportPreparationBytes: Double(max(0, residentAfterTransportPreparation - residentBefore)),
            appProcessResidentMaxSampleBytes: Double([residentBefore, residentAfterTransportPreparation, residentAfterThreeDTeardown, residentAfterTwoDTeardown].max() ?? 0),
            threeDLoadToSettledPaintMs: threeDMeasurement.loadToSettledPaintMs,
            threeDNativePrepareToIndexMs: threeDMeasurement.nativePrepareToIndexMs,
            threeDNavigationToAPIReadyMs: threeDMeasurement.navigationToAPIReadyMs,
            threeDGraphFetchMs: threeDMeasurement.graphFetchMs,
            threeDGraphJSONParseMs: threeDMeasurement.graphJSONParseMs,
            threeDEvidenceBuildMs: threeDMeasurement.evidenceBuildMs,
            threeDGraphPreparationMs: threeDMeasurement.graphPreparationMs,
            threeDApplyLensPreLayoutMs: threeDMeasurement.applyLensPreLayoutMs,
            threeDMetadataReplayMs: threeDMeasurement.metadataReplayMs,
            threeDNormalizeGraphMs: threeDMeasurement.normalizeGraphMs,
            threeDPresentationIndexBuildMs: threeDMeasurement.presentationIndexBuildMs,
            threeDLayoutCacheReadMs: threeDMeasurement.layoutCacheReadMs,
            threeDMeshHitGeometryMs: threeDMeasurement.meshHitGeometryMs,
            threeDFirstProjectionStaticPaintMs: threeDMeasurement.firstProjectionStaticPaintMs,
            threeDLayoutEndToEndMs: threeDMeasurement.layoutEndToEndMs,
            threeDLayoutPreparationMs: threeDMeasurement.layoutPreparationMs,
            threeDProbeGraphFetchAndParseMs: threeDMeasurement.probeGraphFetchAndParseMs,
            threeDLayoutCallReturnMs: threeDMeasurement.layoutCallReturnMs,
            threeDLayoutZeroDelayTimerProbeMs: threeDMeasurement.layoutZeroDelayTimerProbeMs,
            threeDLensToSettledMs: threeDMeasurement.lensToSettledMs,
            threeDSearchToSettledMs: threeDMeasurement.searchToSettledMs,
            threeDPanOrbitFrameMs: threeDMeasurement.panOrbitFrameMs,
            threeDHoverToHighlightMs: threeDMeasurement.hoverToHighlightMs,
            threeDSelectionToFirstFeedbackMs: threeDMeasurement.selectionToFirstFeedbackMs,
            threeDSidebarOpenReframeMs: threeDMeasurement.sidebarOpenReframeMs,
            threeDOverviewCommunityTransitionMs: threeDMeasurement.overviewCommunityTransitionMs,
            twoDRuntimeLoadToDiagnosticsMs: twoDMeasurement.loadToDiagnosticsMs,
            twoDRuntimeLensToDiagnosticsMs: twoDMeasurement.lensToDiagnosticsMs,
            twoDRuntimeSearchToDiagnosticsMs: twoDMeasurement.searchToDiagnosticsMs,
            threeDQueryableNodes: threeDMeasurement.counts.nodes,
            threeDQueryableEdges: threeDMeasurement.counts.edges,
            twoDQueryableNodes: twoDMeasurement.counts.nodes,
            twoDQueryableEdges: twoDMeasurement.counts.edges
        )
    }

    @MainActor
    private func measureThreeDRenderer(graphDirectory: URL, expected: RendererCounts, query: String, requiresLayoutCacheHit: Bool = false, requiresLayoutCacheStored: Bool = false) async throws -> ThreeDRendererMeasurement {
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let threeDHost = RendererWebViewHost(webView: threeD.webView)
        do {
            let expectedLayoutCacheStates: Set<String> = requiresLayoutCacheHit
                ? ["hit"]
                : (requiresLayoutCacheStored ? ["stored"] : ["hit", "stored"])
            let threeDLoadStartedAt = Date()
            let nativePrepareStartedAt = Date()
            try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory, rendererTestMode: false)
            let threeDNativePrepareToIndexMs = milliseconds(since: nativePrepareStartedAt)
            let navigationStartedAt = Date()
            try await navigateToTestPage(
                try rendererMeasurementIndexURL(for: threeD.coordinator),
                queryItem: "renderer-measurement",
                value: "1",
                in: threeD.webView
            )
            try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "measurement 3D API installation")
            let threeDNavigationToAPIReadyMs = milliseconds(since: navigationStartedAt)
            let beforeProbe = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "measurement 3D pre-probe") {
                diagnosticString($0, "activeMode") != nil
            }
            XCTAssertEqual(diagnosticCount(beforeProbe, "queryableNodes"), 0)
            XCTAssertEqual(diagnosticCount(beforeProbe, "queryableEdges"), 0)
            let layoutProbe = try await invokeThreeDLayoutResponsivenessProbe(
                graphURL: try graphSchemeURL(for: threeD.coordinator),
                in: threeD.webView
            )
            XCTAssertTrue(layoutProbe.didSucceed)
            let threeDInitial = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "measurement 3D initial load", timeout: 15, flushMeasurementPaint: true) {
                diagnosticCount($0, "queryableNodes") == expected.nodes &&
                diagnosticCount($0, "queryableEdges") == expected.edges &&
                diagnosticBool($0, "paintedCountsSettled") == true &&
                expectedLayoutCacheStates.contains(diagnosticString($0, "layoutCache") ?? "")
            }
            let threeDLayoutCache = try XCTUnwrap(diagnosticString(threeDInitial, "layoutCache"))
            if requiresLayoutCacheHit {
                XCTAssertEqual(threeDLayoutCache, "hit", "Every warm renderer measurement must use the layout cache.")
            }
            if requiresLayoutCacheStored {
                XCTAssertEqual(threeDLayoutCache, "stored", "The cold renderer measurement must populate the layout cache.")
            }
            let threeDLoadToSettledPaintMs = milliseconds(since: threeDLoadStartedAt)
            let threeDGraphFetchMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "graphFetchMs"))
            let threeDGraphJSONParseMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "graphJSONParseMs"))
            let threeDEvidenceBuildMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "evidenceBuildMs"))
            let threeDGraphPreparationMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "graphPreparationMs"))
            let threeDApplyLensPreLayoutMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "applyLensPreLayoutMs"))
            let threeDMetadataReplayMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "metadataReplayMs"))
            let threeDNormalizeGraphMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "normalizeGraphMs"))
            let threeDPresentationIndexBuildMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "presentationIndexBuildMs"))
            let threeDLayoutCacheReadMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "layoutCacheReadMs"))
            let threeDMeshHitGeometryMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "meshHitGeometryMs"))
            let threeDFirstProjectionStaticPaintMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "firstProjectionStaticPaintMs"))
            let threeDLayoutEndToEndMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "layoutEndToEndMs"))
            let threeDLayoutPreparationMs = try XCTUnwrap(diagnosticDouble(threeDInitial, "layoutPreparationMs"))
            let threeDProbeGraphFetchAndParseMs = layoutProbe.graphFetchAndParseMs
            let threeDLensStartedAt = Date()
            let didApplyGraphifyLens = try await awaitThreeDGraphOperation("window.brainBarApplyGraphLens('graphify')", action: "measure Graphify lens", in: threeD.webView)
            XCTAssertTrue(didApplyGraphifyLens)
            let threeDLensDiagnostics = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "measurement 3D lens", timeout: 15, flushMeasurementPaint: true) {
                diagnosticString($0, "lens") == "graphify" &&
                diagnosticBool($0, "paintedCountsSettled") == true &&
                expectedLayoutCacheStates.contains(diagnosticString($0, "layoutCache") ?? "")
            }
            let threeDLensLayoutCache = try XCTUnwrap(diagnosticString(threeDLensDiagnostics, "layoutCache"))
            if requiresLayoutCacheHit {
                XCTAssertEqual(threeDLensLayoutCache, "hit", "Every warm renderer lens measurement must use the layout cache.")
            }
            if requiresLayoutCacheStored {
                XCTAssertEqual(threeDLensLayoutCache, "stored", "The cold renderer lens measurement must populate the layout cache.")
            }
            let threeDLensToSettledMs = milliseconds(since: threeDLensStartedAt)
            let threeDSearchStartedAt = Date()
            try await evaluateThreeDJavaScript(
                "const input = document.getElementById('search'); input.value = \(Graph3DWebView.jsStringLiteral(query)); input.dispatchEvent(new Event('input', { bubbles: true }));",
                action: "measure 3D search",
                in: threeD.webView
            )
            _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "measurement 3D search", timeout: 15, flushMeasurementPaint: true) {
                (diagnosticCount($0, "searchResultCount") ?? 0) > 0 && diagnosticBool($0, "paintedCountsSettled") == true
            }
            let threeDSearchToSettledMs = milliseconds(since: threeDSearchStartedAt)
            let didRestoreAllLens = try await awaitThreeDGraphOperation("window.brainBarApplyGraphLens('all')", action: "restore Overview interaction lens", in: threeD.webView)
            XCTAssertTrue(didRestoreAllLens)
            _ = try await waitForRendererDiagnostics(in: threeD.webView, functionName: "brainBarRendererDiagnostics", phase: "measurement 3D Overview interaction lens", timeout: 15, flushMeasurementPaint: true) {
                diagnosticString($0, "lens") == "all" && diagnosticBool($0, "paintedCountsSettled") == true
            }
            let interactionMetricsSerialized = try await callAsyncJavaScriptString(
                "const metrics = window.brainBarMeasurePresentationInteractions(); return JSON.stringify(metrics);",
                in: threeD.webView
            )
            let interactionMetricsValue = try XCTUnwrap(interactionMetricsSerialized)
            let interactionMetrics = try XCTUnwrap(
                try JSONSerialization.jsonObject(with: Data(interactionMetricsValue.utf8)) as? [String: Any]
            )
            let threeDPanOrbitFrameMs = try XCTUnwrap(diagnosticDouble(interactionMetrics, "panOrbitFrameMs"))
            let threeDHoverToHighlightMs = try XCTUnwrap(diagnosticDouble(interactionMetrics, "hoverToHighlightMs"))
            let threeDSelectionToFirstFeedbackMs = try XCTUnwrap(diagnosticDouble(interactionMetrics, "selectionToFirstFeedbackMs"))
            let threeDSidebarOpenReframeMs = try XCTUnwrap(diagnosticDouble(interactionMetrics, "sidebarOpenReframeMs"))
            let threeDOverviewCommunityTransitionMs = try XCTUnwrap(diagnosticDouble(interactionMetrics, "overviewCommunityTransitionMs"))
            XCTAssertLessThanOrEqual(threeDHoverToHighlightMs, 50)
            XCTAssertLessThanOrEqual(threeDSelectionToFirstFeedbackMs, 50)
            XCTAssertLessThanOrEqual(threeDPanOrbitFrameMs, 33)
            let counts = RendererCounts(
                nodes: try XCTUnwrap(diagnosticCount(threeDInitial, "queryableNodes")),
                edges: try XCTUnwrap(diagnosticCount(threeDInitial, "queryableEdges"))
            )
            try await quiesceThreeDRendererWebView(threeD.webView, messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            let measurement = ThreeDRendererMeasurement(
                loadToSettledPaintMs: threeDLoadToSettledPaintMs,
                nativePrepareToIndexMs: threeDNativePrepareToIndexMs,
                navigationToAPIReadyMs: threeDNavigationToAPIReadyMs,
                graphFetchMs: threeDGraphFetchMs,
                graphJSONParseMs: threeDGraphJSONParseMs,
                evidenceBuildMs: threeDEvidenceBuildMs,
                graphPreparationMs: threeDGraphPreparationMs,
                applyLensPreLayoutMs: threeDApplyLensPreLayoutMs,
                metadataReplayMs: threeDMetadataReplayMs,
                normalizeGraphMs: threeDNormalizeGraphMs,
                presentationIndexBuildMs: threeDPresentationIndexBuildMs,
                layoutCacheReadMs: threeDLayoutCacheReadMs,
                meshHitGeometryMs: threeDMeshHitGeometryMs,
                firstProjectionStaticPaintMs: threeDFirstProjectionStaticPaintMs,
                layoutEndToEndMs: threeDLayoutEndToEndMs,
                layoutPreparationMs: threeDLayoutPreparationMs,
                probeGraphFetchAndParseMs: threeDProbeGraphFetchAndParseMs,
                layoutCallReturnMs: layoutProbe.callReturnMs,
                layoutZeroDelayTimerProbeMs: layoutProbe.zeroDelayTimerProbeMs,
                lensToSettledMs: threeDLensToSettledMs,
                searchToSettledMs: threeDSearchToSettledMs,
                panOrbitFrameMs: threeDPanOrbitFrameMs,
                hoverToHighlightMs: threeDHoverToHighlightMs,
                selectionToFirstFeedbackMs: threeDSelectionToFirstFeedbackMs,
                sidebarOpenReframeMs: threeDSidebarOpenReframeMs,
                overviewCommunityTransitionMs: threeDOverviewCommunityTransitionMs,
                counts: counts,
                layoutCache: threeDLayoutCache
            )
            try await closeThreeDRendererTestHost(
                threeDHost,
                messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]
            )
            return measurement
        } catch {
            threeDHost.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"])
            throw error
        }
    }

    @MainActor
    private func measureTwoDRuntime(htmlURL: URL, expected: RendererCounts, query: String) async throws -> TwoDRuntimeMeasurement {
        let webView = try makeTwoDRendererWebViewForExistingHTML()
        let twoDHost = RendererWebViewHost(webView: webView)
        do {
            let twoDLoadStartedAt = Date()
            webView.loadFileURL(htmlURL, allowingReadAccessTo: htmlURL.deletingLastPathComponent())
            let twoDInitial = try await waitForRendererDiagnostics(in: webView, functionName: "brainBarRendererDiagnostics2D", phase: "measurement 2D initial load", timeout: 15) {
                diagnosticCount($0, "queryableNodes") == expected.nodes &&
                diagnosticCount($0, "queryableEdges") == expected.edges &&
                diagnosticBool($0, "paintedCountsSettled") == true
            }
            let twoDLoadToDiagnosticsMs = milliseconds(since: twoDLoadStartedAt)
            let twoDLensStartedAt = Date()
            try await evaluateJavaScript("window.brainBarApplyGraphLens('graphify')", in: webView)
            _ = try await waitForRendererDiagnostics(in: webView, functionName: "brainBarRendererDiagnostics2D", phase: "measurement 2D lens", timeout: 15) {
                diagnosticString($0, "lens") == "graphify" && diagnosticBool($0, "paintedCountsSettled") == true
            }
            let twoDLensToDiagnosticsMs = milliseconds(since: twoDLensStartedAt)
            let twoDSearchStartedAt = Date()
            try await evaluateJavaScript(
                "const input = document.getElementById('search'); input.value = \(Graph3DWebView.jsStringLiteral(query)); input.dispatchEvent(new Event('input', { bubbles: true }));",
                in: webView
            )
            _ = try await waitForRendererDiagnostics(in: webView, functionName: "brainBarRendererDiagnostics2D", phase: "measurement 2D search", timeout: 15) {
                (diagnosticCount($0, "searchResultCount") ?? 0) > 0 && diagnosticBool($0, "paintedCountsSettled") == true
            }
            let twoDSearchToDiagnosticsMs = milliseconds(since: twoDSearchStartedAt)
            let counts = RendererCounts(
                nodes: try XCTUnwrap(diagnosticCount(twoDInitial, "queryableNodes")),
                edges: try XCTUnwrap(diagnosticCount(twoDInitial, "queryableEdges"))
            )
            await quiesceRendererWebView(webView)
            twoDHost.close()
            return TwoDRuntimeMeasurement(
                loadToDiagnosticsMs: twoDLoadToDiagnosticsMs,
                lensToDiagnosticsMs: twoDLensToDiagnosticsMs,
                searchToDiagnosticsMs: twoDSearchToDiagnosticsMs,
                counts: counts
            )
        } catch {
            twoDHost.close()
            throw error
        }
    }

    @MainActor
    private func measurementGraphDirectories(fixtureData: Data) throws -> MeasurementGraphDirectories {
        let root = try temporaryDirectory()
        let payload = root.appendingPathComponent("payload/graphify-out", isDirectory: true)
        let threeD = root.appendingPathComponent("three-d/graphify-out", isDirectory: true)
        let twoDDirectory = root.appendingPathComponent("two-d", isDirectory: true)
        let twoDHTML = twoDDirectory.appendingPathComponent("graph.html")
        try FileManager.default.createDirectory(at: payload, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: threeD, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: twoDDirectory, withIntermediateDirectories: true)
        try fixtureData.write(to: payload.appendingPathComponent("graph.json"), options: .atomic)
        try fixtureData.write(to: threeD.appendingPathComponent("graph.json"), options: .atomic)
        try writeTwoDRendererHTML(graphData: fixtureData, to: twoDHTML)
        return MeasurementGraphDirectories(root: root, payload: payload, threeD: threeD, twoDHTML: twoDHTML)
    }

    private func takeGraph3DVisualCaptureRequest() throws -> Graph3DVisualCaptureRequest? {
        let requestURL = URL(fileURLWithPath: "/private/tmp/brainbar-graph3d-visual-capture-request.json")
        guard FileManager.default.fileExists(atPath: requestURL.path) else {
            return nil
        }
        let requestData = try Data(contentsOf: requestURL)
        try FileManager.default.removeItem(at: requestURL)
        let request = try JSONDecoder().decode(Graph3DVisualCaptureRequest.self, from: requestData)
        return try validatedGraph3DVisualCaptureRequest(request, now: Date().timeIntervalSince1970)
    }

    private func validatedGraph3DVisualCaptureRequest(
        _ request: Graph3DVisualCaptureRequest,
        now: TimeInterval
    ) throws -> Graph3DVisualCaptureRequest {
        let rawPathPrefix = "/private/tmp/brainbar-graph3d-visual-capture-"
        let expectedScenarios: [Graph3DVisualCaptureScenario] = [
            .init(name: "1k-overview-collapsed", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-overview-collapsed.png"),
            .init(name: "1k-overview-docked", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-overview-docked.png"),
            .init(name: "inspected-overview-collapsed", fixtureName: "inspected-shape", width: 1000, height: 720, outputName: "inspected-overview-collapsed.png"),
            .init(name: "inspected-overview-docked", fixtureName: "inspected-shape", width: 1000, height: 720, outputName: "inspected-overview-docked.png"),
            .init(name: "1k-community", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-community.png"),
            .init(name: "1k-node-focus", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-node-focus.png"),
            .init(name: "1k-selected-hub", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-selected-hub.png"),
            .init(name: "1k-selected-peripheral", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-selected-peripheral.png"),
            .init(name: "1k-active-path", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-active-path.png"),
            .init(name: "1k-recent-orbit", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-recent-orbit.png"),
            .init(name: "1k-agent-activity", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-agent-activity.png"),
            .init(name: "1k-workflow-highlight", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-workflow-highlight.png"),
            .init(name: "1k-graph-check", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-graph-check.png"),
            .init(name: "1k-narrow-overlay", fixtureName: "1k", width: 620, height: 720, outputName: "1k-narrow-overlay.png"),
            .init(name: "1k-reduce-motion", fixtureName: "1k", width: 1000, height: 720, outputName: "1k-reduce-motion.png")
        ]
        guard
            request.version == 1,
            now >= request.createdAt,
            now - request.createdAt <= 300,
            processIsLive(request.launcherPID),
            request.captureRoot.hasPrefix(rawPathPrefix),
            request.scenarios == expectedScenarios,
            Set(request.fixturePaths.keys) == Set(["1k", "inspected-shape"]),
            request.fixtureDigests == reviewedVisualCaptureFixtureDigests
        else {
            throw BrainBarError.processFailed("Invalid or stale Graph3D visual capture request.")
        }

        let rootURL = URL(fileURLWithPath: request.captureRoot, isDirectory: true)
        guard FileManager.default.fileExists(atPath: rootURL.path) else {
            throw BrainBarError.processFailed("Graph3D visual capture root is missing.")
        }
        let resolvedRoot = rootURL.resolvingSymlinksInPath().standardizedFileURL
        guard isGraph3DVisualCapturePath(resolvedRoot, underTemporaryPrefix: rawPathPrefix) else {
            throw BrainBarError.processFailed("Unsafe Graph3D visual capture root.")
        }
        let rawRoot = rootURL.standardizedFileURL
        let outputRoot = URL(fileURLWithPath: request.outputRoot, isDirectory: true).standardizedFileURL
        guard
            request.outputRoot.hasPrefix("\(request.captureRoot)/"),
            outputRoot.lastPathComponent == "output",
            !FileManager.default.fileExists(atPath: outputRoot.path)
        else {
            throw BrainBarError.processFailed("Graph3D visual capture output escapes the approved root.")
        }

        var resolvedFixtures: [String: String] = [:]
        for fixtureName in ["1k", "inspected-shape"] {
            guard let rawPath = request.fixturePaths[fixtureName] else {
                throw BrainBarError.processFailed("Graph3D visual capture fixture is missing.")
            }
            let fixtureURL = URL(fileURLWithPath: rawPath).standardizedFileURL
            let expectedFixtureURL = rawRoot.appendingPathComponent("fixtures/\(fixtureName).json")
            let resolvedFixture = fixtureURL.resolvingSymlinksInPath().standardizedFileURL
            guard
                fixtureURL == expectedFixtureURL,
                FileManager.default.fileExists(atPath: fixtureURL.path),
                isDescendant(resolvedFixture, of: resolvedRoot)
            else {
                throw BrainBarError.processFailed("Graph3D visual capture fixture escapes the approved root.")
            }
            resolvedFixtures[fixtureName] = resolvedFixture.path
        }

        return Graph3DVisualCaptureRequest(
            version: request.version,
            captureRoot: resolvedRoot.path,
            fixturePaths: resolvedFixtures,
            fixtureDigests: request.fixtureDigests,
            outputRoot: resolvedRoot.appendingPathComponent("output", isDirectory: true).path,
            scenarios: request.scenarios,
            createdAt: request.createdAt,
            launcherPID: request.launcherPID
        )
    }

    private func isGraph3DVisualCapturePath(_ url: URL, underTemporaryPrefix rawPrefix: String) -> Bool {
        let resolvedTemporaryRoot = URL(fileURLWithPath: "/private/tmp", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL.path
        return url.path.hasPrefix(rawPrefix) || url.path.hasPrefix("\(resolvedTemporaryRoot)/brainbar-graph3d-visual-capture-")
    }

    @MainActor
    private func visualCaptureGraphDirectory(
        request: Graph3DVisualCaptureRequest,
        scenario: Graph3DVisualCaptureScenario,
        fixtureData: Data
    ) throws -> URL {
        let graphDirectory = URL(fileURLWithPath: request.captureRoot, isDirectory: true)
            .appendingPathComponent("graphs/\(scenario.name)/graphify-out", isDirectory: true)
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try fixtureData.write(to: graphDirectory.appendingPathComponent("graph.json"), options: .atomic)
        try writePublicVisualCaptureMetadata(for: scenario, fixtureData: fixtureData, graphDirectory: graphDirectory)
        return graphDirectory
    }

    @MainActor
    private func writePublicVisualCaptureMetadata(
        for scenario: Graph3DVisualCaptureScenario,
        fixtureData: Data,
        graphDirectory: URL
    ) throws {
        guard scenario.name == "1k-recent-orbit" else {
            return
        }
        let fixture = try XCTUnwrap(try JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
        let nodes = try XCTUnwrap(fixture["nodes"] as? [[String: Any]])
        let syntheticVault = graphDirectory.deletingLastPathComponent()
        for (index, nodeID) in ["1k-node-000", "1k-node-001", "1k-node-002", "1k-node-003"].enumerated() {
            let node = try XCTUnwrap(nodes.first(where: { $0["id"] as? String == nodeID }))
            let sourceFile = try XCTUnwrap(node["source_file"] as? String)
            let fileURL = syntheticVault.appendingPathComponent(sourceFile)
            try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data().write(to: fileURL, options: .atomic)
            try FileManager.default.setAttributes(
                [.modificationDate: Date(timeIntervalSince1970: 1_700_000_000 + Double(index))],
                ofItemAtPath: fileURL.path
            )
        }
    }

    @MainActor
    private func visualCaptureScenarioScript(_ scenario: Graph3DVisualCaptureScenario, fixtureName: String) -> String {
        let nodePrefix = fixtureName == "1k" ? "1k-node-" : "inspected-shape-node-"
        let nodeA = "\(nodePrefix)000"
        let nodeB = "\(nodePrefix)001"
        let hubNode = "\(nodePrefix)370"
        let peripheralNode = "\(nodePrefix)383"
        let session: String
        switch scenario.name {
        case "1k-overview-collapsed":
            session = "window.brainBarSetSidebarState('collapsed'); window.brainBarApplyCameraPreset('overview');"
        case "1k-overview-docked":
            session = "window.brainBarSetSidebarState('docked', 360); window.brainBarApplyCameraPreset('overview');"
        case "inspected-overview-collapsed":
            session = "window.brainBarSetSidebarState('collapsed'); window.brainBarApplyCameraPreset('overview');"
        case "inspected-overview-docked":
            session = "window.brainBarSetSidebarState('docked', 360); window.brainBarApplyCameraPreset('overview');"
        case "1k-community":
            session = "window.brainBarShowCommunity3D('1'); await new Promise((resolve) => setTimeout(resolve, 420));"
        case "1k-node-focus":
            session = "window.brainBarApplyGraphSessionState({ schemaVersion: 2, selectedNodeID: \(Graph3DWebView.jsStringLiteral(nodeA)), focusDepth: 1, detailLevel: 'overview', detailReason: 'adaptive-default', sidebarState: 'docked', sidebarWidth: 360, reduceMotion: false, cameraHistory: [] });"
        case "1k-selected-hub":
            session = "window.brainBarApplyGraphSessionState({ schemaVersion: 2, selectedNodeID: \(Graph3DWebView.jsStringLiteral(hubNode)), detailLevel: 'overview', detailReason: 'adaptive-default', sidebarState: 'docked', sidebarWidth: 360, reduceMotion: true, cameraHistory: [] }); await new Promise((resolve) => setTimeout(resolve, 120));"
        case "1k-selected-peripheral":
            session = "window.brainBarApplyGraphSessionState({ schemaVersion: 2, selectedNodeID: \(Graph3DWebView.jsStringLiteral(peripheralNode)), detailLevel: 'overview', detailReason: 'adaptive-default', sidebarState: 'docked', sidebarWidth: 360, reduceMotion: true, cameraHistory: [] }); await new Promise((resolve) => setTimeout(resolve, 120));"
        case "1k-active-path":
            session = "window.brainBarStartPathFromNode3D(JSON.stringify({ sourceId: \(Graph3DWebView.jsStringLiteral(nodeA)), targetId: \(Graph3DWebView.jsStringLiteral(nodeB)) }));"
        case "1k-recent-orbit":
            session = "const recentButton = document.getElementById('start-recent-orbit'); if (!recentButton) return false; recentButton.click(); await new Promise((resolve) => setTimeout(resolve, 420));"
        case "1k-agent-activity":
            session = "window.brainBarSetSidebarState('docked', 360); window.brainBarApplyAgentActivity({ events: [{ id: 'public-capture-activity', version: 2, action: 'focus', agent: 'codex', path: 'fixtures/1k/1k-node-370.md', sourceFile: 'fixtures/1k/1k-node-370.md', nodeId: '1k-node-370', label: 'Fixture 1k node 370', pending: false, timestamp: '2024-01-01T00:00:00Z' }], pendingPaths: [], tracingEnabled: true, workflows: [] });"
        case "1k-workflow-highlight":
            session = "window.brainBarSetSidebarState('docked', 360); window.brainBarApplyAgentActivity({ events: [{ id: 'public-capture-workflow', version: 2, action: 'write', agent: 'codex', path: 'fixtures/1k/1k-node-370.md', sourceFile: 'fixtures/1k/1k-node-370.md', nodeId: '1k-node-370', label: 'Fixture 1k node 370', pending: false, workflowId: 'public-capture', workflowTitle: 'Public capture workflow', timestamp: '2024-01-01T00:00:00Z' }], pendingPaths: [], tracingEnabled: true, workflows: [{ id: 'workflow:public-capture', title: 'Public capture workflow', status: 'completed', nodeIds: ['1k-node-370', '1k-node-371', '1k-node-372'], pendingPaths: [] }] }); window.brainBarApplyWorkflowHighlight('workflow:public-capture');"
        case "1k-graph-check":
            session = "window.brainBarSetSidebarState('collapsed'); if (!window.brainBarShowGraphHealth()) return false;"
        case "1k-narrow-overlay":
            session = "window.brainBarSetReduceMotion(true); window.brainBarSetSidebarState('overlay', 360); window.brainBarRevealNode3D(\(Graph3DWebView.jsStringLiteral(nodeA)));"
        case "1k-reduce-motion":
            session = "window.brainBarSetReduceMotion(true); window.brainBarApplyGraphSessionState({ schemaVersion: 2, selectedNodeID: \(Graph3DWebView.jsStringLiteral(nodeA)), detailLevel: 'overview', detailReason: 'adaptive-default', sidebarState: 'overlay', sidebarWidth: 360, reduceMotion: true, cameraHistory: [] });"
        default:
            session = ""
        }
        return "(async () => { \(session) window.brainBarFlushRendererForMeasurement?.(); return true; })()"
    }

    @MainActor
    private func visualCapturePresentationState(in webView: WKWebView) async throws -> [String: Any] {
        let serialized = try await callAsyncJavaScriptString(
            """
            const presentation = window.brainBarPresentationStateForTesting?.() || {};
            const session = window.brainBarGraphSessionSnapshot?.() || {};
            const healthPanel = document.getElementById('graph-health-panel');
            return JSON.stringify({
              ...presentation,
              selectedNodeID: session.selectedNodeID || null,
              graphCheckVisible: Boolean(healthPanel && !healthPanel.hidden),
              graphCheckProposalCount: healthPanel?.querySelectorAll('.evidence-proposal').length || 0
            });
            """,
            in: webView
        )
        guard
            let serialized,
            let data = serialized.data(using: .utf8),
            let state = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            throw BrainBarError.processFailed("Graph3D visual capture state was unavailable.")
        }
        return state
    }

    @MainActor
    private func writeVisualCaptureSnapshot(of webView: WKWebView, to url: URL) async throws {
        let image: NSImage = try await withCheckedThrowingContinuation { continuation in
            webView.takeSnapshot(with: nil) { image, error in
                if let error {
                    continuation.resume(throwing: error)
                } else if let image {
                    continuation.resume(returning: image)
                } else {
                    continuation.resume(throwing: BrainBarError.processFailed("Graph3D visual capture returned no image."))
                }
            }
        }
        guard
            let tiffData = image.tiffRepresentation,
            let bitmap = NSBitmapImageRep(data: tiffData),
            let pngData = bitmap.representation(using: .png, properties: [:])
        else {
            throw BrainBarError.processFailed("Graph3D visual capture could not encode PNG.")
        }
        try pngData.write(to: url, options: .atomic)
    }

    private func visualCaptureManifestEntry(
        scenario: Graph3DVisualCaptureScenario,
        expected: RendererCounts,
        diagnostics: [String: Any],
        presentation: [String: Any]
    ) throws -> Graph3DVisualCaptureManifest.Capture {
        let coverage = try XCTUnwrap(presentation["paintedProjectedCoverage"] as? [String: Any])
        let diagnostic = Graph3DVisualCaptureManifest.Diagnostics(
            layoutSchemaVersion: try XCTUnwrap(diagnosticCount(diagnostics, "layoutSchemaVersion")),
            layoutProfile: try XCTUnwrap(diagnosticString(diagnostics, "layoutProfile")),
            detailLevel: try XCTUnwrap(diagnosticString(diagnostics, "detailLevel")),
            detailReason: try XCTUnwrap(diagnosticString(diagnostics, "detailReason")),
            paintedNodeCount: try XCTUnwrap(diagnosticCount(diagnostics, "paintedNodeCount")),
            paintedEdgeCount: try XCTUnwrap(diagnosticCount(diagnostics, "paintedEdgeCount")),
            communityAnchorCount: try XCTUnwrap(diagnosticCount(diagnostics, "communityAnchorCount")),
            persistentLabelCount: try XCTUnwrap(diagnosticCount(diagnostics, "persistentLabelCount")),
            persistentLabelMaxOverlapArea: try XCTUnwrap(diagnosticDouble(presentation, "persistentLabelMaxOverlapArea")),
            activeMode: try XCTUnwrap(diagnosticString(diagnostics, "activeMode")),
            selectedNodeCount: try XCTUnwrap(diagnosticCount(diagnostics, "selectedNodeCount")),
            agentActivityEventCount: try XCTUnwrap(diagnosticCount(diagnostics, "agentActivityEventCount")),
            agentActivityRenderableCount: try XCTUnwrap(diagnosticCount(diagnostics, "agentActivityRenderableCount")),
            workflowHighlightNodeCount: try XCTUnwrap(diagnosticCount(diagnostics, "workflowHighlightNodeCount")),
            workflowHighlightPendingPathCount: try XCTUnwrap(diagnosticCount(diagnostics, "workflowHighlightPendingPathCount")),
            graphCheckVisible: try XCTUnwrap(presentation["graphCheckVisible"] as? Bool),
            sidebarState: try XCTUnwrap(diagnosticString(diagnostics, "sidebarState")),
            cameraPreset: try XCTUnwrap(diagnosticString(diagnostics, "cameraPreset")),
            staticLayerRebuildMs: try XCTUnwrap(diagnosticDouble(diagnostics, "staticLayerRebuildMs")),
            labelAllocationMs: try XCTUnwrap(diagnosticDouble(diagnostics, "labelAllocationMs")),
            frameQuality: try XCTUnwrap(diagnosticString(diagnostics, "frameQuality")),
            paintedProjectedCoverageX: try XCTUnwrap(diagnosticDouble(coverage, "x")),
            paintedProjectedCoverageY: try XCTUnwrap(diagnosticDouble(coverage, "y")),
            paintedProjectedCoverageWidth: try XCTUnwrap(diagnosticDouble(coverage, "width")),
            paintedProjectedCoverageHeight: try XCTUnwrap(diagnosticDouble(coverage, "height")),
            visualPixelRatio: try XCTUnwrap(diagnosticDouble(diagnostics, "visualPixelRatio")),
            baseStateHubGlowEnabled: try XCTUnwrap(diagnosticBool(diagnostics, "baseStateHubGlowEnabled")),
            balancedDiscMinimumAlpha: try XCTUnwrap(diagnosticDouble(diagnostics, "balancedDiscMinimumAlpha")),
            darkSeparationRimWidth: try XCTUnwrap(diagnosticDouble(diagnostics, "darkSeparationRimWidth")),
            balancedEdgeAlpha: try XCTUnwrap(diagnosticDouble(diagnostics, "balancedEdgeAlpha")),
            staticRebuildP95Ms: try XCTUnwrap(diagnosticDouble(diagnostics, "staticRebuildP95Ms")),
            visualBackingWidth: try XCTUnwrap(diagnosticCount(diagnostics, "visualBackingWidth")),
            visualBackingHeight: try XCTUnwrap(diagnosticCount(diagnostics, "visualBackingHeight"))
        )
        return .init(
            scenario: scenario.name,
            fixture: .init(
                name: scenario.fixtureName,
                sha256: try XCTUnwrap(reviewedVisualCaptureFixtureDigests[scenario.fixtureName]),
                nodeCount: expected.nodes,
                edgeCount: expected.edges
            ),
            viewport: .init(width: scenario.width, height: scenario.height),
            snapshot: scenario.outputName,
            coordinateFingerprint: try XCTUnwrap(presentation["coordinateFingerprint"] as? String),
            diagnostics: diagnostic
        )
    }

    private func visualCaptureFixtureDigest(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func assertVisualCaptureScenario(
        _ scenario: Graph3DVisualCaptureScenario,
        diagnostics: [String: Any],
        presentation: [String: Any]
    ) throws {
        XCTAssertEqual(diagnosticCount(diagnostics, "selectedNodeCount"), presentation["selectedNodeID"] is String ? 1 : 0)
        XCTAssertEqual(diagnosticCount(diagnostics, "workflowHighlightPendingPathCount"), 0)
        XCTAssertEqual(presentation["graphCheckVisible"] as? Bool, scenario.name == "1k-graph-check")
        XCTAssertEqual((presentation["activePrimaryPersistentLabelCollisionCount"] as? NSNumber)?.intValue, 0)
        try assertVisualCaptureLabelRectsAreUnobscured(presentation)

        switch scenario.name {
        case "1k-overview-collapsed":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "collapsed")
            let coverage = try XCTUnwrap(presentation["paintedProjectedCoverage"] as? [String: Any])
            XCTAssertGreaterThanOrEqual(
                try XCTUnwrap(diagnosticDouble(coverage, "width")),
                0.60,
                "The 1k overview must use the useful viewport width."
            )
        case "1k-overview-docked":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "docked")
        case "inspected-overview-collapsed":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "collapsed")
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "visualPixelRatio")), 2)
            XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "staticRebuildP95Ms")), 33)
            XCTAssertEqual(diagnosticBool(diagnostics, "baseStateHubGlowEnabled"), false)
            XCTAssertEqual(diagnosticCount(diagnostics, "staticHubGlowCount"), 0)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "balancedDiscMinimumAlpha")), 0.72)
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "darkSeparationRimWidth")), 0.8)
            XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "balancedEdgeAlpha")), 0.18)
            XCTAssertLessThanOrEqual(
                try XCTUnwrap(diagnosticCount(diagnostics, "visualBackingWidth")),
                try XCTUnwrap(diagnosticCount(diagnostics, "stageWidth")) * 2
            )
            XCTAssertLessThanOrEqual(
                try XCTUnwrap(diagnosticCount(diagnostics, "visualBackingHeight")),
                try XCTUnwrap(diagnosticCount(diagnostics, "stageHeight")) * 2
            )
            let coverage = try XCTUnwrap(presentation["paintedProjectedCoverage"] as? [String: Any])
            let x = try XCTUnwrap((coverage["x"] as? NSNumber)?.doubleValue)
            let y = try XCTUnwrap((coverage["y"] as? NSNumber)?.doubleValue)
            let width = try XCTUnwrap((coverage["width"] as? NSNumber)?.doubleValue)
            let height = try XCTUnwrap((coverage["height"] as? NSNumber)?.doubleValue)
            XCTAssertGreaterThanOrEqual(x, 0.06, "The overview must not crop the left graph edge.")
            XCTAssertGreaterThanOrEqual(y, 0.06, "The overview must not crop the top graph edge.")
            XCTAssertLessThanOrEqual(x + width, 0.94, "The overview must not crop the right graph edge.")
            XCTAssertLessThanOrEqual(y + height, 0.94, "The overview must not crop the lower graph edge.")
            XCTAssertGreaterThanOrEqual(width, 0.60, "The overview must use the useful viewport width.")
            XCTAssertGreaterThanOrEqual(height, 0.55, "The overview must use the useful viewport height.")
            XCTAssertLessThanOrEqual(width, 0.90)
            XCTAssertLessThanOrEqual(height, 0.85)
        case "inspected-overview-docked":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "docked")
        case "1k-community":
            assertVisualCaptureState(diagnostics, mode: "community", camera: "community", sidebar: "docked")
            XCTAssertEqual(diagnosticString(diagnostics, "detailLevel"), "overview")
            XCTAssertLessThanOrEqual(diagnosticCount(diagnostics, "paintedEdgeCount") ?? .max, 12_000)
            XCTAssertLessThanOrEqual(diagnosticDouble(diagnostics, "cameraZoom") ?? .infinity, 1.0)
        case "1k-node-focus":
            assertVisualCaptureState(diagnostics, mode: "focus", camera: "node-focus", sidebar: "docked")
            XCTAssertEqual(presentation["selectedNodeID"] as? String, "1k-node-000")
        case "1k-selected-hub":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "node-focus", sidebar: "docked")
            XCTAssertEqual(presentation["selectedNodeID"] as? String, "1k-node-370")
            XCTAssertEqual(diagnosticString(diagnostics, "detailLevel"), "balanced")
            XCTAssertLessThanOrEqual(diagnosticCount(diagnostics, "paintedEdgeCount") ?? .max, 12_000)
            try assertSelectedVisualCaptureTargetIsUnobscured(presentation)
        case "1k-selected-peripheral":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "node-focus", sidebar: "docked")
            XCTAssertEqual(presentation["selectedNodeID"] as? String, "1k-node-383")
            XCTAssertEqual(diagnosticString(diagnostics, "detailLevel"), "balanced")
            XCTAssertLessThanOrEqual(diagnosticCount(diagnostics, "paintedEdgeCount") ?? .max, 12_000)
            try assertSelectedVisualCaptureTargetIsUnobscured(presentation)
        case "1k-active-path":
            assertVisualCaptureState(diagnostics, mode: "path", camera: "active-path", sidebar: "docked")
        case "1k-recent-orbit":
            assertVisualCaptureState(diagnostics, mode: "recent", camera: "recent-orbit", sidebar: "collapsed")
        case "1k-agent-activity":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "docked")
            XCTAssertEqual(diagnosticCount(diagnostics, "agentActivityEventCount"), 1)
            XCTAssertEqual(diagnosticCount(diagnostics, "agentActivityRenderableCount"), 1)
        case "1k-workflow-highlight":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "docked")
            XCTAssertEqual(diagnosticCount(diagnostics, "agentActivityEventCount"), 1)
            XCTAssertEqual(diagnosticCount(diagnostics, "agentActivityRenderableCount"), 1)
            XCTAssertEqual(diagnosticCount(diagnostics, "workflowHighlightNodeCount"), 3)
        case "1k-graph-check":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "overview", sidebar: "collapsed")
        case "1k-narrow-overlay":
            assertVisualCaptureState(diagnostics, mode: "search", camera: "node-focus", sidebar: "overlay")
            try assertSelectedVisualCaptureTargetIsUnobscured(presentation)
        case "1k-reduce-motion":
            assertVisualCaptureState(diagnostics, mode: "none", camera: "node-focus", sidebar: "overlay")
            XCTAssertEqual(diagnosticBool(diagnostics, "reduceMotion"), true)
        default:
            XCTFail("Unhandled visual capture scenario: \(scenario.name)")
        }
    }

    private func assertVisualCaptureMatchedCoreParity(_ captures: [Graph3DVisualCaptureManifest.Capture]) throws {
        let matchedNames = Set(matchedCoreVisualCaptureScenarioNames)
        let matchedCaptures = captures.filter { matchedNames.contains($0.scenario) }
        XCTAssertEqual(matchedCaptures.count, matchedCoreVisualCaptureScenarioNames.count)
        let first = try XCTUnwrap(matchedCaptures.first)
        for capture in matchedCaptures {
            XCTAssertEqual(capture.fixture.name, "1k")
            XCTAssertEqual(capture.fixture.sha256, reviewedVisualCaptureFixtureDigests["1k"])
            XCTAssertEqual(capture.fixture.nodeCount, 1_000)
            XCTAssertEqual(capture.fixture.edgeCount, 2_380)
            XCTAssertEqual(capture.viewport.width, 1_000)
            XCTAssertEqual(capture.viewport.height, 720)
            XCTAssertEqual(capture.coordinateFingerprint, first.coordinateFingerprint)
        }
    }

    private func assertVisualCaptureState(
        _ diagnostics: [String: Any],
        mode: String,
        camera: String,
        sidebar: String
    ) {
        XCTAssertEqual(diagnosticString(diagnostics, "activeMode"), mode)
        XCTAssertEqual(diagnosticString(diagnostics, "cameraPreset"), camera)
        XCTAssertEqual(diagnosticString(diagnostics, "sidebarState"), sidebar)
    }

    private func assertSelectedVisualCaptureTargetIsUnobscured(_ presentation: [String: Any]) throws {
        XCTAssertEqual(presentation["cameraTransitionActive"] as? Bool, false)
        XCTAssertGreaterThanOrEqual((presentation["selectedContextProjectedCount"] as? NSNumber)?.intValue ?? 0, 8)
        let projection = try XCTUnwrap(presentation["selectedNodeProjection"] as? [String: Any])
        let label = try XCTUnwrap(presentation["selectedNodeLabelRect"] as? [String: Any])
        let safeStage = try XCTUnwrap(presentation["unobscuredStage"] as? [String: Any])
        let pointX = try XCTUnwrap((projection["x"] as? NSNumber)?.doubleValue)
        let pointY = try XCTUnwrap((projection["y"] as? NSNumber)?.doubleValue)
        let labelX = try XCTUnwrap((label["x"] as? NSNumber)?.doubleValue)
        let labelY = try XCTUnwrap((label["y"] as? NSNumber)?.doubleValue)
        let labelWidth = try XCTUnwrap((label["width"] as? NSNumber)?.doubleValue)
        let labelHeight = try XCTUnwrap((label["height"] as? NSNumber)?.doubleValue)
        let stageWidth = try XCTUnwrap((safeStage["width"] as? NSNumber)?.doubleValue)
        let stageHeight = try XCTUnwrap((safeStage["height"] as? NSNumber)?.doubleValue)
        let inset = 8.0

        XCTAssertGreaterThanOrEqual(pointX, inset)
        XCTAssertLessThanOrEqual(pointX, stageWidth - inset)
        XCTAssertGreaterThanOrEqual(pointY, inset)
        XCTAssertLessThanOrEqual(pointY, stageHeight - inset)
        XCTAssertGreaterThanOrEqual(labelX, inset)
        XCTAssertGreaterThanOrEqual(labelY, inset)
        XCTAssertLessThanOrEqual(labelX + labelWidth, stageWidth - inset)
        XCTAssertLessThanOrEqual(labelY + labelHeight, stageHeight - inset)

        let obstructions = safeStage["obscuredRegions"] as? [[String: Any]] ?? []
        for obstruction in obstructions {
            let x = try XCTUnwrap((obstruction["x"] as? NSNumber)?.doubleValue)
            let y = try XCTUnwrap((obstruction["y"] as? NSNumber)?.doubleValue)
            let width = try XCTUnwrap((obstruction["width"] as? NSNumber)?.doubleValue)
            let height = try XCTUnwrap((obstruction["height"] as? NSNumber)?.doubleValue)
            XCTAssertFalse(pointX >= x && pointX <= x + width && pointY >= y && pointY <= y + height)
            XCTAssertFalse(labelX < x + width && labelX + labelWidth > x && labelY < y + height && labelY + labelHeight > y)
        }
    }

    private func assertVisualCaptureLabelRectsAreUnobscured(_ presentation: [String: Any]) throws {
        let safeStage = try XCTUnwrap(presentation["unobscuredStage"] as? [String: Any])
        let stageWidth = try XCTUnwrap((safeStage["width"] as? NSNumber)?.doubleValue)
        let stageHeight = try XCTUnwrap((safeStage["height"] as? NSNumber)?.doubleValue)
        let persistent = try XCTUnwrap(presentation["persistentLabelRects"] as? [[String: Any]])
        let active = try XCTUnwrap(presentation["activeLabelRects"] as? [[String: Any]])
        let obstructions = safeStage["obscuredRegions"] as? [[String: Any]] ?? []
        let inset = 10.0

        for label in persistent + active {
            let x = try XCTUnwrap((label["x"] as? NSNumber)?.doubleValue)
            let y = try XCTUnwrap((label["y"] as? NSNumber)?.doubleValue)
            let width = try XCTUnwrap((label["width"] as? NSNumber)?.doubleValue)
            let height = try XCTUnwrap((label["height"] as? NSNumber)?.doubleValue)
            XCTAssertGreaterThanOrEqual(x, inset)
            XCTAssertGreaterThanOrEqual(y, inset)
            XCTAssertLessThanOrEqual(x + width, stageWidth - inset)
            XCTAssertLessThanOrEqual(y + height, stageHeight - inset)

            for obstruction in obstructions {
                let obstructionX = try XCTUnwrap((obstruction["x"] as? NSNumber)?.doubleValue)
                let obstructionY = try XCTUnwrap((obstruction["y"] as? NSNumber)?.doubleValue)
                let obstructionWidth = try XCTUnwrap((obstruction["width"] as? NSNumber)?.doubleValue)
                let obstructionHeight = try XCTUnwrap((obstruction["height"] as? NSNumber)?.doubleValue)
                XCTAssertFalse(x < obstructionX + obstructionWidth && x + width > obstructionX && y < obstructionY + obstructionHeight && y + height > obstructionY)
            }
        }
    }

    private func takeRendererMeasurementRequest() throws -> RendererMeasurementRequest? {
        let requestURL = URL(fileURLWithPath: "/private/tmp/brainbar-renderer-measurements-request.json")
        guard FileManager.default.fileExists(atPath: requestURL.path) else {
            return nil
        }
        let requestData = try Data(contentsOf: requestURL)
        try FileManager.default.removeItem(at: requestURL)
        let request = try JSONDecoder().decode(RendererMeasurementRequest.self, from: requestData)
        return try validatedRendererMeasurementRequest(request, now: Date().timeIntervalSince1970)
    }

    private func validatedRendererMeasurementRequest(_ request: RendererMeasurementRequest, now: TimeInterval) throws -> RendererMeasurementRequest {
        let rawPathPrefix = "/private/tmp/brainbar-renderer-measurements-"
        guard
            request.version == 2,
            reviewedMeasurementFixtureCounts[request.fixtureName] != nil,
            now >= request.createdAt,
            now - request.createdAt <= 300,
            processIsLive(request.launcherPID),
            request.measurementRoot.hasPrefix(rawPathPrefix),
            request.fixturePath.hasPrefix("\(request.measurementRoot)/"),
            request.outputPath.hasPrefix("\(request.measurementRoot)/")
        else {
            throw BrainBarError.processFailed("Invalid or stale renderer measurement request.")
        }
        let rootURL = URL(fileURLWithPath: request.measurementRoot, isDirectory: true)
        guard FileManager.default.fileExists(atPath: rootURL.path) else {
            throw BrainBarError.processFailed("Renderer measurement root is missing.")
        }
        let resolvedRoot = rootURL.resolvingSymlinksInPath().standardizedFileURL
        guard isRendererMeasurementPath(resolvedRoot, underTemporaryPrefix: rawPathPrefix) else {
            throw BrainBarError.processFailed("Unsafe renderer measurement root.")
        }
        let fixtureURL = URL(fileURLWithPath: request.fixturePath).standardizedFileURL
        let outputURL = URL(fileURLWithPath: request.outputPath).standardizedFileURL
        guard fixtureURL.lastPathComponent == "\(request.fixtureName).json", outputURL.lastPathComponent == "report.json" else {
            throw BrainBarError.processFailed("Unsafe renderer measurement filenames.")
        }
        let resolvedFixture = fixtureURL.resolvingSymlinksInPath().standardizedFileURL
        let resolvedOutputParent = outputURL.deletingLastPathComponent().resolvingSymlinksInPath().standardizedFileURL
        guard
            FileManager.default.fileExists(atPath: fixtureURL.path),
            !FileManager.default.fileExists(atPath: outputURL.path),
            isDescendant(resolvedFixture, of: resolvedRoot),
            isDescendant(resolvedOutputParent, of: resolvedRoot)
        else {
            throw BrainBarError.processFailed("Renderer measurement paths escape the approved root.")
        }
        return RendererMeasurementRequest(
            version: request.version,
            fixtureName: request.fixtureName,
            measurementRoot: resolvedRoot.path,
            fixturePath: resolvedFixture.path,
            outputPath: resolvedOutputParent.appendingPathComponent("report.json").path,
            measurementKind: request.measurementKind,
            createdAt: request.createdAt,
            launcherPID: request.launcherPID
        )
    }

    private func isRendererMeasurementPath(_ url: URL, underTemporaryPrefix rawPrefix: String) -> Bool {
        let resolvedTemporaryRoot = URL(fileURLWithPath: "/private/tmp", isDirectory: true).resolvingSymlinksInPath().standardizedFileURL.path
        return url.path.hasPrefix(rawPrefix) || url.path.hasPrefix("\(resolvedTemporaryRoot)/brainbar-renderer-measurements-")
    }

    private func isDescendant(_ url: URL, of root: URL) -> Bool {
        url.path == root.path || url.path.hasPrefix("\(root.path)/")
    }

    private func summarizeMeasurementSamples(_ samples: [RendererMeasurementSample]) -> [String: RendererMeasurementSummary] {
        let metricSamples = samples.reduce(into: [String: [Double]]()) { result, sample in
            for (name, value) in sample.metrics {
                result[name, default: []].append(value)
            }
        }
        return metricSamples.mapValues(measurementSummary)
    }

    private func measurementSummary(_ samples: [Double]) -> RendererMeasurementSummary {
        let sorted = samples.sorted()
        let mean = sorted.reduce(0, +) / Double(sorted.count)
        let variance = sorted.reduce(0) { $0 + pow($1 - mean, 2) } / Double(sorted.count)
        return RendererMeasurementSummary(
            samples: samples,
            p50: interpolatedPercentile(sorted, percentile: 0.5),
            p95: interpolatedPercentile(sorted, percentile: 0.95),
            cvPercent: mean == 0 ? 0 : (sqrt(variance) / mean) * 100
        )
    }

    private func interpolatedPercentile(_ sorted: [Double], percentile: Double) -> Double {
        let position = Double(sorted.count - 1) * percentile
        let lower = Int(floor(position))
        let upper = Int(ceil(position))
        return sorted[lower] + ((sorted[upper] - sorted[lower]) * (position - Double(lower)))
    }

    private func milliseconds(since startedAt: Date) -> Double {
        Date().timeIntervalSince(startedAt) * 1_000
    }

    private func appProcessResidentBytes() -> Int64 {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        return result == KERN_SUCCESS ? Int64(info.resident_size) : 0
    }

    @MainActor
    private func exerciseTwoDRendererPhase() async throws -> RendererCounts {
        let twoD = try makeTwoDRendererWebView()
        let host = RendererWebViewHost(webView: twoD.webView)
        var didCloseHost = false
        defer {
            if !didCloseHost {
                host.close()
            }
            removeTemporaryDirectory(twoD.directory)
        }
        twoD.webView.loadFileURL(twoD.htmlURL, allowingReadAccessTo: twoD.htmlURL.deletingLastPathComponent())
        let initial = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D initial load") {
            diagnosticCount($0, "queryableNodes") == 4 &&
            diagnosticCount($0, "queryableEdges") == 3 &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        assertRendererDiagnosticsAreContentFree(initial)
        assert2DDiagnosticShape(initial)
        XCTAssertEqual(diagnosticString(initial, "lens"), "all")
        XCTAssertEqual(diagnosticString(initial, "activeMode"), "global")
        assertDiagnosticCounts(initial, visibleNodes: 4, visibleEdges: 3, paintedNodes: 4, paintedEdges: 3)

        try await evaluateJavaScript("window.brainBarApplyGraphLens('obsidian')", in: twoD.webView)
        let obsidian = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D Obsidian lens") {
            diagnosticString($0, "lens") == "obsidian" && diagnosticBool($0, "paintedCountsSettled") == true
        }
        assertDiagnosticCounts(obsidian, visibleNodes: 2, visibleEdges: 1, paintedNodes: 2, paintedEdges: 1)

        try await evaluateJavaScript("window.brainBarApplyGraphLens('graphify')", in: twoD.webView)
        let graphify = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D Graphify lens") {
            diagnosticString($0, "lens") == "graphify" && diagnosticBool($0, "paintedCountsSettled") == true
        }
        assertDiagnosticCounts(graphify, visibleNodes: 3, visibleEdges: 2, paintedNodes: 3, paintedEdges: 2)

        try await evaluateJavaScript("window.brainBarApplyGraphLens('all'); window.network.selectNodes(['node-a'])", in: twoD.webView)
        let selection = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D selected node") {
            diagnosticCount($0, "selectedNodeCount") == 1
        }
        assertRendererDiagnosticsAreContentFree(selection)

        try await evaluateJavaScript("const input = document.getElementById('search'); input.value = 'Beacon'; input.dispatchEvent(new Event('input', { bubbles: true }));", in: twoD.webView)
        let search = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D search results") {
            diagnosticCount($0, "searchResultCount") == 1
        }
        assertRendererDiagnosticsAreContentFree(search)

        try await evaluateJavaScript("window.brainBarApplyGraphLens('obsidian')", in: twoD.webView)
        let retainedSearch = try await waitForRendererDiagnostics(in: twoD.webView, functionName: "brainBarRendererDiagnostics2D", phase: "2D global search after Obsidian lens") {
            diagnosticString($0, "lens") == "obsidian" && diagnosticCount($0, "searchResultCount") == 1
        }
        assertRendererDiagnosticsAreContentFree(retainedSearch)
        let counts = RendererCounts(nodes: try XCTUnwrap(diagnosticCount(initial, "queryableNodes")), edges: try XCTUnwrap(diagnosticCount(initial, "queryableEdges")))
        try await closeTwoDRendererTestHost(host, messageHandlerNames: [])
        didCloseHost = true
        return counts
    }

    private func assertDiagnosticCounts(_ diagnostics: [String: Any], visibleNodes: Int, visibleEdges: Int, paintedNodes: Int, paintedEdges: Int) {
        XCTAssertEqual(diagnosticCount(diagnostics, "visibleNodes"), visibleNodes)
        XCTAssertEqual(diagnosticCount(diagnostics, "visibleEdges"), visibleEdges)
        XCTAssertEqual(diagnosticCount(diagnostics, "paintedNodes"), paintedNodes)
        XCTAssertEqual(diagnosticCount(diagnostics, "paintedEdges"), paintedEdges)
    }

    @MainActor
    func testGraph3DMeasurementFlushHookIsQueryGated() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory, rendererTestMode: false)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "measurement hook production gate")
        let productionHook = try await evaluateJavaScriptString(
            "typeof window.brainBarFlushRendererForMeasurement",
            in: threeD.webView
        )
        let productionInteractionHook = try await evaluateJavaScriptString(
            "typeof window.brainBarMeasurePresentationInteractions",
            in: threeD.webView
        )
        let productionProjectionHook = try await evaluateJavaScriptString(
            "typeof window.__brainBarResetProjectionForInteractionProbe",
            in: threeD.webView
        )
        XCTAssertEqual(productionHook, "undefined")
        XCTAssertEqual(productionInteractionHook, "undefined")
        XCTAssertEqual(productionProjectionHook, "undefined")

        try await navigateToTestPage(
            try rendererMeasurementIndexURL(for: threeD.coordinator),
            queryItem: "renderer-measurement",
            value: "1",
            in: threeD.webView
        )
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "measurement hook test gate")
        let graphURL = try graphSchemeURL(for: threeD.coordinator)
        let serialized = try await callAsyncJavaScriptString(
            """
            const response = await fetch(\(Graph3DWebView.jsStringLiteral(graphURL)));
            const graph = await response.json();
            var flushCount = 0;
            const flush = () => {
              flushCount += 1;
              return window.brainBarFlushRendererForMeasurement();
            };
            const loaded = await window.brainBarLoadGraph(graph, 'all', 9201);
            const initialBefore = window.brainBarRendererDiagnostics();
            const initialFlushed = flush();
            const initialAfter = window.brainBarRendererDiagnostics();
            const lensLoaded = await window.brainBarApplyGraphLens('graphify');
            const lensBefore = window.brainBarRendererDiagnostics();
            const lensFlushed = flush();
            const lensAfter = window.brainBarRendererDiagnostics();
            return JSON.stringify({ loaded, lensLoaded, initialBefore, initialFlushed, initialAfter, lensBefore, lensFlushed, lensAfter, flushCount, hook: typeof window.brainBarFlushRendererForMeasurement, interactionHook: typeof window.brainBarMeasurePresentationInteractions, projectionHook: typeof window.__brainBarResetProjectionForInteractionProbe });
            """,
            in: threeD.webView
        )
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(serialized).utf8)) as? [String: Any]
        )
        let initialBefore = try XCTUnwrap(result["initialBefore"] as? [String: Any])
        let initialAfter = try XCTUnwrap(result["initialAfter"] as? [String: Any])
        let lensBefore = try XCTUnwrap(result["lensBefore"] as? [String: Any])
        let lensAfter = try XCTUnwrap(result["lensAfter"] as? [String: Any])
        XCTAssertEqual(result["loaded"] as? Bool, true)
        XCTAssertEqual(result["lensLoaded"] as? Bool, true)
        XCTAssertEqual(result["hook"] as? String, "function")
        XCTAssertEqual(result["interactionHook"] as? String, "function")
        XCTAssertEqual(result["projectionHook"] as? String, "function")
        XCTAssertEqual(diagnosticString(initialBefore, "layoutState"), "committed")
        XCTAssertEqual(result["initialFlushed"] as? Bool, true)
        XCTAssertEqual(diagnosticBool(initialAfter, "paintedCountsSettled"), true)
        XCTAssertEqual(diagnosticString(lensBefore, "layoutState"), "committed")
        XCTAssertEqual(result["lensFlushed"] as? Bool, true)
        XCTAssertEqual(diagnosticBool(lensAfter, "paintedCountsSettled"), true)
        XCTAssertEqual(result["flushCount"] as? Int, 2)
        assertRendererDiagnosticsAreContentFree(lensAfter)
    }

    @MainActor
    func testGraph3DPresentationControlsKeepCoordinatesAndMigrateSessionV1() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "3D presentation controls API")
        let serialized = try await callAsyncJavaScriptString(
            """
            const response = await fetch(\(Graph3DWebView.jsStringLiteral(try graphSchemeURL(for: threeD.coordinator))));
            const graph = await response.json();
            await window.brainBarLoadGraph(graph, 'all', 811);
            const initial = window.brainBarPresentationStateForTesting();
            const initialDiagnostics = window.brainBarRendererDiagnostics();
            const api = ['brainBarApplyCameraPreset', 'brainBarSetReduceMotion', 'brainBarCameraBack']
              .map((name) => typeof window[name] === 'function');
            window.brainBarSetSidebarState('docked', 99999);
            const docked = window.brainBarPresentationStateForTesting();
            const resizer = document.getElementById('sidebar-resizer');
            resizer.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 71, clientX: window.innerWidth - 360 }));
            resizer.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 71, clientX: -1000 }));
            resizer.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 71, clientX: -1000 }));
            const pointerResized = window.brainBarPresentationStateForTesting();
            resizer.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' }));
            const keyboardResized = window.brainBarPresentationStateForTesting();
            const resizerAccessibility = {
              role: resizer.getAttribute('role'),
              min: resizer.getAttribute('aria-valuemin'),
              max: resizer.getAttribute('aria-valuemax'),
              now: resizer.getAttribute('aria-valuenow')
            };
            window.brainBarSetDetailLevel('full');
            const full = window.brainBarRendererDiagnostics();
            window.brainBarApplyGraphSessionState({ schemaVersion: 1, selectedNodeID: 'node-a', sourceLens: 'all', searchQuery: '' });
            window.brainBarShowCommunity3D('Research');
            const backed = window.brainBarCameraBack();
            const afterBack = window.brainBarGraphSessionSnapshot();
            window.brainBarSetReduceMotion(true);
            const reduced = window.brainBarRendererDiagnostics();
            const overviewApplied = window.brainBarApplyCameraPreset('overview');
            const overview = window.brainBarRendererDiagnostics();
            window.brainBarApplyCameraPreset('manual');
            const beforeResize = window.brainBarGraphSessionSnapshot().cameraState;
            window.dispatchEvent(new Event('resize'));
            const afterResize = window.brainBarGraphSessionSnapshot().cameraState;
            const manualResizePreserved = JSON.stringify(beforeResize) === JSON.stringify(afterResize);
            const migrated = window.brainBarApplyGraphSessionState({
              schemaVersion: 1,
              selectedNodeID: 'node-a',
              sourceLens: 'all',
              searchQuery: ''
            });
            const session = window.brainBarGraphSessionSnapshot();
            const resetInteractionProjection = window.__brainBarResetProjectionForInteractionProbe();
            const interactionMetrics = await window.brainBarMeasurePresentationInteractions();
            return JSON.stringify({ initial, initialDiagnostics, api, docked, pointerResized, keyboardResized, resizerAccessibility, full, backed, afterBack, reduced, overviewApplied, overview, manualResizePreserved, migrated, session, resetInteractionProjection, interactionMetrics });
            """,
            in: threeD.webView
        )
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(serialized).utf8)) as? [String: Any]
        )
        let initial = try XCTUnwrap(result["initial"] as? [String: Any])
        let docked = try XCTUnwrap(result["docked"] as? [String: Any])
        let pointerResized = try XCTUnwrap(result["pointerResized"] as? [String: Any])
        let keyboardResized = try XCTUnwrap(result["keyboardResized"] as? [String: Any])
        let resizerAccessibility = try XCTUnwrap(result["resizerAccessibility"] as? [String: Any])
        let full = try XCTUnwrap(result["full"] as? [String: Any])
        let initialDiagnostics = try XCTUnwrap(result["initialDiagnostics"] as? [String: Any])
        let reduced = try XCTUnwrap(result["reduced"] as? [String: Any])
        let overview = try XCTUnwrap(result["overview"] as? [String: Any])
        let afterBack = try XCTUnwrap(result["afterBack"] as? [String: Any])
        let session = try XCTUnwrap(result["session"] as? [String: Any])
        let interactionMetrics = try XCTUnwrap(result["interactionMetrics"] as? [String: Any])

        XCTAssertEqual(initial["coordinateFingerprint"] as? String, docked["coordinateFingerprint"] as? String)
        XCTAssertEqual(initial["coordinateFingerprint"] as? String, pointerResized["coordinateFingerprint"] as? String)
        XCTAssertEqual(initial["coordinateFingerprint"] as? String, keyboardResized["coordinateFingerprint"] as? String)
        XCTAssertEqual(docked["sidebarState"] as? String, "docked")
        XCTAssertEqual(resizerAccessibility["role"] as? String, "separator")
        XCTAssertEqual(resizerAccessibility["min"] as? String, "300")
        XCTAssertNotNil(Int(resizerAccessibility["max"] as? String ?? ""))
        XCTAssertNotNil(Int(resizerAccessibility["now"] as? String ?? ""))
        XCTAssertGreaterThanOrEqual((pointerResized["sidebarWidth"] as? NSNumber)?.doubleValue ?? 0, 300)
        XCTAssertGreaterThanOrEqual((keyboardResized["sidebarWidth"] as? NSNumber)?.doubleValue ?? 0, 300)
        XCTAssertEqual(diagnosticString(full, "detailLevel"), "full")
        XCTAssertEqual(diagnosticCount(full, "queryableNodeCount"), diagnosticCount(full, "paintedNodeCount"))
        XCTAssertEqual(diagnosticString(initialDiagnostics, "detailLevel"), "balanced")
        XCTAssertEqual(result["api"] as? [Bool], [true, true, true])
        XCTAssertEqual(result["backed"] as? Bool, true)
        XCTAssertEqual(afterBack["selectedNodeID"] as? String, "node-a")
        XCTAssertEqual(diagnosticBool(reduced, "reduceMotion"), true)
        XCTAssertEqual(result["overviewApplied"] as? Bool, true)
        XCTAssertEqual(diagnosticString(overview, "cameraPreset"), "overview")
        XCTAssertEqual(result["manualResizePreserved"] as? Bool, true)
        XCTAssertEqual(result["migrated"] as? Bool, true)
        XCTAssertEqual(result["resetInteractionProjection"] as? Bool, true)
        XCTAssertEqual(session["schemaVersion"] as? Int, 2)
        XCTAssertEqual(session["sidebarState"] as? String, "overlay")
        XCTAssertEqual(session["detailLevel"] as? String, "overview")
        for key in ["panOrbitFrameMs", "hoverToHighlightMs", "selectionToFirstFeedbackMs", "sidebarOpenReframeMs", "overviewCommunityTransitionMs"] {
            XCTAssertNotNil(diagnosticDouble(interactionMetrics, key))
        }
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(interactionMetrics, "panOrbitFrameMs")), 33)
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(interactionMetrics, "hoverToHighlightMs")), 50)
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(interactionMetrics, "selectionToFirstFeedbackMs")), 50)
        assertRendererDiagnosticsAreContentFree(full)
    }

    @MainActor
    func testGraph3DAccessibilityAuditUsesPublicFixture() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "Graph3D accessibility audit API")
        let serialized = try await callAsyncJavaScriptString(
            """
            const response = await fetch(\(Graph3DWebView.jsStringLiteral(try graphSchemeURL(for: threeD.coordinator))));
            const graph = await response.json();
            await window.brainBarLoadGraph(graph, 'all', 812);
            window.brainBarSetSidebarState('docked', 360);
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            const status = document.getElementById('graph-status');
            window.brainBarSetDetailLevel('full');
            const detailAnnouncement = status.textContent;
            window.brainBarSetSidebarState('collapsed');
            const panelAnnouncement = status.textContent;
            window.brainBarSetSidebarState('docked', 360);
            const nameFor = (element) => element.getAttribute('aria-label') || element.labels?.[0]?.textContent?.trim() || element.textContent?.trim() || '';
            const visible = (element) => {
              const style = getComputedStyle(element);
              const rect = element.getBoundingClientRect();
              return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
            };
            const targets = [...document.querySelectorAll('#graph-controls select, #graph-controls button, #sidebar input, #sidebar button, #sidebar-resizer')]
              .filter(visible)
              .map((element) => {
                const rect = element.getBoundingClientRect();
                return { tag: element.tagName.toLowerCase(), id: element.id || '', role: element.getAttribute('role') || '', name: nameFor(element), width: rect.width, height: rect.height };
              });
            const focusProbe = (selector) => {
              const element = document.querySelector(selector);
              element.focus();
              return {
                active: document.activeElement === element
              };
            };
            const parseColor = (value) => value.match(/[\\d.]+/g).map(Number);
            const blend = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * (foreground[3] ?? 1) + background[index] * (1 - (foreground[3] ?? 1)));
            const linear = (channel) => {
              const value = channel / 255;
              return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
            };
            const luminance = (channels) => 0.2126 * linear(channels[0]) + 0.7152 * linear(channels[1]) + 0.0722 * linear(channels[2]);
            const ratio = (foreground, background) => {
              const [light, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
              return (light + 0.05) / (dark + 0.05);
            };
            const sidebarColor = parseColor(getComputedStyle(document.getElementById('sidebar')).backgroundColor);
            const contrast = ['h2', '#stats', '#node-info'].map((selector) => {
              const element = document.querySelector(selector);
              const foreground = blend(parseColor(getComputedStyle(element).color), sidebarColor);
              return { selector, ratio: ratio(foreground, sidebarColor) };
            });
            return JSON.stringify({
              status: { live: status.getAttribute('aria-live'), detailAnnouncement, panelAnnouncement },
              targets,
              focus: { detail: focusProbe('#detail-level'), search: focusProbe('#search') },
              contrast,
              resizer: {
                role: document.getElementById('sidebar-resizer').getAttribute('role'),
                name: nameFor(document.getElementById('sidebar-resizer')),
                tabIndex: document.getElementById('sidebar-resizer').tabIndex
              }
            });
            """,
            in: threeD.webView
        )
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(serialized).utf8)) as? [String: Any]
        )
        let status = try XCTUnwrap(result["status"] as? [String: Any])
        let targets = try XCTUnwrap(result["targets"] as? [[String: Any]])
        let focus = try XCTUnwrap(result["focus"] as? [String: Any])
        let detailFocus = try XCTUnwrap(focus["detail"] as? [String: Any])
        let searchFocus = try XCTUnwrap(focus["search"] as? [String: Any])
        let contrast = try XCTUnwrap(result["contrast"] as? [[String: Any]])
        let resizer = try XCTUnwrap(result["resizer"] as? [String: Any])

        XCTAssertEqual(status["live"] as? String, "polite")
        XCTAssertTrue((status["detailAnnouncement"] as? String ?? "").hasPrefix("Detail full."))
        XCTAssertEqual(status["panelAnnouncement"] as? String, "Context panel collapsed.")
        XCTAssertEqual(resizer["role"] as? String, "separator")
        XCTAssertEqual(resizer["name"] as? String, "Docked context panel width")
        XCTAssertEqual(resizer["tabIndex"] as? Int, 0)
        XCTAssertFalse(targets.isEmpty)
        for target in targets {
            XCTAssertFalse((target["name"] as? String ?? "").isEmpty, "Visible control lacks an accessible name: \(target)")
            XCTAssertGreaterThanOrEqual((target["width"] as? NSNumber)?.doubleValue ?? 0, 24, "Control is narrower than 24px: \(target)")
            XCTAssertGreaterThanOrEqual((target["height"] as? NSNumber)?.doubleValue ?? 0, 24, "Control is shorter than 24px: \(target)")
        }
        for probe in [detailFocus, searchFocus] {
            XCTAssertEqual(probe["active"] as? Bool, true)
        }
        for entry in contrast {
            XCTAssertGreaterThanOrEqual((entry["ratio"] as? NSNumber)?.doubleValue ?? 0, 4.5, "Computed contrast failed: \(entry)")
        }
    }

    @MainActor
    func testGraph3DOverviewFitKeepsReviewedSpatialFixturesVisibleInCompactViewport() async throws {
        let graphDirectory = try rendererFixtureGraphDirectory()
        defer { removeTemporaryDirectory(graphDirectory.deletingLastPathComponent()) }
        let threeD = try makeThreeDLayoutResponsivenessWebView(graphDirectory: graphDirectory)
        threeD.webView.setFrameSize(NSSize(width: 320, height: 240))
        let host = RendererWebViewHost(webView: threeD.webView)
        defer { host.close(messageHandlerNames: ["brainBarNodeAction", "brainBarGraphDiagnostic"]) }

        try await prepareThreeDGraph(threeD, graphDirectory: graphDirectory)
        try await waitForRendererFunction("brainBarLoadGraph", in: threeD.webView, phase: "25k compact Overview API")
        let serialized = try await callAsyncJavaScriptString(
            """
            const fixtures = [
              { name: '1k', nodeCount: 1000, edgeCount: 2380, communities: 10 },
              { name: 'inspected', nodeCount: 12547, edgeCount: 29868, communities: 64 },
              { name: '25k', nodeCount: 25000, edgeCount: 59512, communities: 100 }
            ];
            const summaries = [];
            for (const fixture of fixtures) {
              const nodes = Array.from({ length: fixture.nodeCount }, (_, index) => ({
                id: `${fixture.name}-node-${index}`,
                label: `${fixture.name} node ${index}`,
                community: `Community ${(index % fixture.communities) + 1}`,
                source_file: `fixtures/${fixture.name}/${index}.md`
              }));
              const edges = Array.from({ length: fixture.edgeCount }, (_, index) => ({
                id: `${fixture.name}-edge-${index}`,
                from: nodes[index % fixture.nodeCount].id,
                to: nodes[(index + 1 + Math.floor(index / fixture.nodeCount)) % fixture.nodeCount].id,
                relation: 'related_to'
              }));
              const loaded = await window.brainBarLoadGraph({ nodes, edges }, 'all', 250_001 + summaries.length);
              const defaultDiagnostics = window.brainBarRendererDiagnostics();
              const defaultDetailControlValue = document.getElementById('detail-level')?.value || null;
              window.brainBarApplyCameraPreset('overview');
              window.brainBarFlushRendererForMeasurement();
              summaries.push({ name: fixture.name, loaded, defaultDiagnostics, defaultDetailControlValue, diagnostics: window.brainBarRendererDiagnostics(), state: window.brainBarPresentationStateForTesting() });
            }
            const initial = summaries[summaries.length - 1].state;
            window.brainBarSetSidebarState('docked', 360);
            window.brainBarFlushRendererForMeasurement();
            const docked = window.brainBarPresentationStateForTesting();
            window.brainBarSetSidebarState('overlay', 360);
            window.brainBarFlushRendererForMeasurement();
            const overlay = window.brainBarPresentationStateForTesting();
            window.brainBarApplyCameraPreset('manual');
            const beforeResize = window.brainBarGraphSessionSnapshot().cameraState;
            window.dispatchEvent(new Event('resize'));
            window.brainBarFlushRendererForMeasurement();
            const afterResize = window.brainBarGraphSessionSnapshot().cameraState;
            return JSON.stringify({ summaries, initial, docked, overlay, manualPreserved: JSON.stringify(beforeResize) === JSON.stringify(afterResize) });
            """,
            in: threeD.webView
        )
        let result = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(try XCTUnwrap(serialized).utf8)) as? [String: Any]
        )
        let summaries = try XCTUnwrap(result["summaries"] as? [[String: Any]])
        let initial = try XCTUnwrap(result["initial"] as? [String: Any])
        let docked = try XCTUnwrap(result["docked"] as? [String: Any])
        let overlay = try XCTUnwrap(result["overlay"] as? [String: Any])
        XCTAssertEqual(summaries.map { $0["loaded"] as? Bool }, [true, true, true])
        for summary in summaries {
            let diagnostics = try XCTUnwrap(summary["diagnostics"] as? [String: Any])
            XCTAssertGreaterThan(diagnosticCount(diagnostics, "visibleProjectedNodeCount") ?? 0, 0, "\(diagnostics)")
            XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(diagnostics, "cameraZoom")), 0.0001)
            XCTAssertEqual(diagnosticString(diagnostics, "cameraProjection"), "perspective")
            XCTAssertGreaterThan(try XCTUnwrap(diagnosticDouble(diagnostics, "cameraDistance")), 0)
            assertRendererDiagnosticsAreContentFree(diagnostics)
        }
        let inspectedDefault = try XCTUnwrap(summaries.first(where: { $0["name"] as? String == "inspected" })?["defaultDiagnostics"] as? [String: Any])
        let oneKDefault = try XCTUnwrap(summaries.first(where: { $0["name"] as? String == "1k" })?["defaultDiagnostics"] as? [String: Any])
        let twentyFiveKDefault = try XCTUnwrap(summaries.first(where: { $0["name"] as? String == "25k" })?["defaultDiagnostics"] as? [String: Any])
        let inspectedDiagnostics = try XCTUnwrap(summaries.first(where: { $0["name"] as? String == "inspected" })?["diagnostics"] as? [String: Any])
        let twentyFiveKDiagnostics = try XCTUnwrap(summaries.first(where: { $0["name"] as? String == "25k" })?["diagnostics"] as? [String: Any])
        XCTAssertEqual(diagnosticString(oneKDefault, "detailLevel"), "balanced")
        XCTAssertEqual(diagnosticString(inspectedDefault, "detailLevel"), "balanced")
        XCTAssertEqual(diagnosticString(twentyFiveKDefault, "detailLevel"), "overview")
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(inspectedDiagnostics, "visualPixelRatio")), 2)
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(inspectedDiagnostics, "staticRebuildP95Ms")), 33)
        XCTAssertEqual(diagnosticBool(inspectedDiagnostics, "baseStateHubGlowEnabled"), false)
        XCTAssertEqual(diagnosticCount(inspectedDiagnostics, "staticHubGlowCount"), 0)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(inspectedDiagnostics, "balancedDiscMinimumAlpha")), 0.72)
        XCTAssertGreaterThanOrEqual(try XCTUnwrap(diagnosticDouble(inspectedDiagnostics, "darkSeparationRimWidth")), 0.8)
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(inspectedDiagnostics, "balancedEdgeAlpha")), 0.18)
        XCTAssertLessThanOrEqual(try XCTUnwrap(diagnosticDouble(twentyFiveKDiagnostics, "visualPixelRatio")), 1)
        XCTAssertEqual(
            summaries.first(where: { $0["name"] as? String == "inspected" })?["defaultDetailControlValue"] as? String,
            diagnosticString(inspectedDefault, "detailLevel"),
            "The Detail control must reflect the adaptive level rather than its static HTML default."
        )
        XCTAssertGreaterThanOrEqual(
            Double(diagnosticCount(inspectedDefault, "paintedNodeCount") ?? 0) / 12_547,
            0.65,
            "The inspected-like default must show a meaningful majority without Full."
        )
        let overview = try XCTUnwrap(summaries.last?["diagnostics"] as? [String: Any])
        XCTAssertEqual(diagnosticString(overview, "detailLevel"), "overview")
        XCTAssertEqual(initial["coordinateFingerprint"] as? String, docked["coordinateFingerprint"] as? String)
        XCTAssertEqual(initial["coordinateFingerprint"] as? String, overlay["coordinateFingerprint"] as? String)
        XCTAssertEqual(result["manualPreserved"] as? Bool, true)
    }

    @MainActor
    private func rendererFixtureGraphDirectory() throws -> URL {
        let graphDirectory = try temporaryDirectory().appendingPathComponent("graphify-out")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        try """
        {
          "nodes": [
            { "id": "node-a", "label": "Northstar", "community": "Research", "source_file": "Notes/Northstar.md", "modified_at": "2026-08-07T12:00:00Z", "type": "decision", "tags": ["memory"], "status": "active", "agent": "codex" },
            { "id": "node-b", "label": "Orbit", "community": "Research", "source_file": "Notes/Orbit.md" },
            { "id": "node-c", "label": "Beacon", "community": "Archive", "source_file": "Notes/Beacon.md" },
            { "id": "node-d", "label": "Harbor", "community": "Archive", "source_file": "Notes/Harbor.md" }
          ],
          "edges": [
            { "id": "edge-ab", "from": "node-a", "to": "node-b", "relation": "obsidian_wikilink" },
            { "id": "edge-bc", "from": "node-b", "to": "node-c", "relation": "semantic_similarity" },
            { "id": "edge-cd", "from": "node-c", "to": "node-d", "relation": "graphify_inferred" }
          ]
        }
        """.write(to: graphDirectory.appendingPathComponent("graph.json"), atomically: true, encoding: .utf8)
        return graphDirectory
    }

    @MainActor
    private func makeThreeDRendererWebView(
        graphDirectory: URL,
        graphDataStore: GraphDataStore = GraphDataStore()
    ) throws -> ThreeDRendererHarness {
        let coordinator = Graph3DWebView.Coordinator(
            graphDataStore: graphDataStore,
            onDiagnostic: { _ in },
            onOpenNode: { _ in }
        )
        coordinator.graphResourceVersion = Graph3DWebView.graphResourceVersion(readAccessURL: graphDirectory)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(coordinator, forURLScheme: "brainbar3d")
        configuration.userContentController.add(coordinator, name: "brainBarNodeAction")
        configuration.userContentController.add(coordinator, name: "brainBarGraphDiagnostic")
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 640), configuration: configuration)
        webView.navigationDelegate = coordinator
        return (webView, coordinator, graphDataStore)
    }

    @MainActor
    private func makeThreeDLayoutResponsivenessWebView(
        graphDirectory: URL,
        graphDataStore: GraphDataStore = GraphDataStore(),
        onOpenNode: @escaping @MainActor (GraphNodeOpenRequest) -> Void = { _ in }
    ) throws -> ThreeDRendererHarness {
        let coordinator = Graph3DWebView.Coordinator(
            graphDataStore: graphDataStore,
            onDiagnostic: { _ in },
            onOpenNode: onOpenNode
        )
        coordinator.graphResourceVersion = Graph3DWebView.graphResourceVersion(readAccessURL: graphDirectory)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(coordinator, forURLScheme: "brainbar3d")
        configuration.userContentController.add(coordinator, name: "brainBarNodeAction")
        configuration.userContentController.add(coordinator, name: "brainBarGraphDiagnostic")
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 640), configuration: configuration)
        // Intentionally no navigation delegate: the benchmark must invoke brainBarLoadGraph itself.
        return (webView, coordinator, graphDataStore)
    }

    @MainActor
    private func makeThreeDWorkerTestWebView(
        graphDirectory: URL,
        graphReadyRecorder: GraphReadyEventRecorder,
        graphDataStore: GraphDataStore = GraphDataStore()
    ) throws -> ThreeDRendererHarness {
        let coordinator = Graph3DWebView.Coordinator(
            graphDataStore: graphDataStore,
            onDiagnostic: { _ in },
            onOpenNode: { _ in }
        )
        coordinator.graphResourceVersion = Graph3DWebView.graphResourceVersion(readAccessURL: graphDirectory)
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(coordinator, forURLScheme: "brainbar3d")
        configuration.userContentController.add(coordinator, name: "brainBarNodeAction")
        configuration.userContentController.add(graphReadyRecorder, name: "brainBarGraphDiagnostic")
        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 640), configuration: configuration)
        // Intentionally no navigation delegate: this test records only JavaScript graphReady events.
        return (webView, coordinator, graphDataStore)
    }

    @MainActor
    private func clearRendererLayoutCache() async {
        await withCheckedContinuation { continuation in
            WKWebsiteDataStore.default().removeData(
                ofTypes: [WKWebsiteDataTypeIndexedDBDatabases],
                modifiedSince: .distantPast
            ) {
                continuation.resume()
            }
        }
    }

    @MainActor
    private func prepareThreeDGraph(
        _ threeD: ThreeDRendererHarness,
        graphDirectory: URL,
        policy: GraphDataPreparePolicy = .normal,
        attempt: Int = 1,
        rendererTestMode: Bool = true
    ) async throws {
        threeD.coordinator.prepareGraph(
            url: graphDirectory.appendingPathComponent("graph.json"),
            policy: policy,
            attempt: attempt,
            in: threeD.webView
        )
        let deadline = Date().addingTimeInterval(15)
        while threeD.coordinator.indexURL == nil && Date() < deadline {
            await Task.yield()
        }
        guard threeD.coordinator.indexURL != nil else {
            throw BrainBarError.processFailed("3D graph preparation did not produce a digest-bound navigation.")
        }
        if rendererTestMode {
            threeD.coordinator.reloadIndexForTesting(
                try rendererTestIndexURL(for: threeD.coordinator),
                in: threeD.webView
            )
        }
    }

    @MainActor
    private func graphSchemeURL(for coordinator: Graph3DWebView.Coordinator) throws -> String {
        guard
            let indexURL = coordinator.indexURL,
            let digest = URLComponents(url: indexURL, resolvingAgainstBaseURL: false)?
                .queryItems?
                .first(where: { $0.name == "digest" })?
                .value,
            let graphURL = URL(string: "brainbar3d://resources/graph.json?digest=\(digest)")
        else {
            throw BrainBarError.processFailed("3D graph digest was unavailable for scheme loading.")
        }
        return graphURL.absoluteString
    }

    @MainActor
    private func layoutCacheTestIndexURL(for coordinator: Graph3DWebView.Coordinator, mode: String) throws -> URL {
        guard let indexURL = coordinator.indexURL else {
            throw BrainBarError.processFailed("3D graph index URL was unavailable for the layout cache test.")
        }
        var components = try XCTUnwrap(
            URLComponents(url: indexURL, resolvingAgainstBaseURL: false)
        )
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "layout-cache-test", value: mode))
        queryItems.append(URLQueryItem(name: "renderer-test", value: "1"))
        components.queryItems = queryItems
        return try XCTUnwrap(components.url)
    }

    @MainActor
    private func rendererMeasurementIndexURL(for coordinator: Graph3DWebView.Coordinator) throws -> URL {
        guard let indexURL = coordinator.indexURL else {
            throw BrainBarError.processFailed("3D graph index URL was unavailable for the renderer measurement.")
        }
        var components = try XCTUnwrap(
            URLComponents(url: indexURL, resolvingAgainstBaseURL: false)
        )
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "renderer-measurement", value: "1"))
        components.queryItems = queryItems
        return try XCTUnwrap(components.url)
    }

    @MainActor
    private func rendererTestIndexURL(for coordinator: Graph3DWebView.Coordinator) throws -> URL {
        guard let indexURL = coordinator.indexURL else {
            throw BrainBarError.processFailed("3D graph index URL was unavailable for the renderer test.")
        }
        var components = try XCTUnwrap(URLComponents(url: indexURL, resolvingAgainstBaseURL: false))
        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "renderer-test", value: "1"))
        components.queryItems = queryItems
        return try XCTUnwrap(components.url)
    }

    private func workerTestIndexURL(mode: String) throws -> URL {
        try XCTUnwrap(URL(string: "brainbar3d://resources/index.html?layout-worker-test=1&layout-worker-mode=\(mode)&renderer-test=1"))
    }

    private func vaultContentHash(_ directory: URL) throws -> String {
        let keys: Set<URLResourceKey> = [.isRegularFileKey, .isSymbolicLinkKey]
        let enumerator = FileManager.default.enumerator(
            at: directory,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles]
        )
        let files = (enumerator?.allObjects as? [URL] ?? []).filter { url in
            let values = try? url.resourceValues(forKeys: keys)
            return values?.isRegularFile == true && values?.isSymbolicLink != true
        }.sorted { $0.path < $1.path }
        XCTAssertFalse(files.isEmpty, "Vault hash fixture must include files.")
        var hash = SHA256()
        for file in files {
            let relativePath = file.path.replacingOccurrences(of: directory.path + "/", with: "")
            hash.update(data: Data(relativePath.utf8))
            hash.update(data: try Data(contentsOf: file))
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    @MainActor
    private func layoutCacheSnapshot(in webView: WKWebView) async throws -> LayoutCacheSnapshot {
        let serializedValue = try await callAsyncJavaScriptString(
            "return JSON.stringify(window.__brainBarLayoutCacheTest.snapshot());",
            in: webView
        )
        let serialized = try XCTUnwrap(serializedValue)
        let value = try XCTUnwrap(
            try JSONSerialization.jsonObject(with: Data(serialized.utf8)) as? [String: Any]
        )
        return LayoutCacheSnapshot(
            count: try XCTUnwrap(diagnosticCount(value, "count")),
            fingerprint: try XCTUnwrap(diagnosticString(value, "fingerprint"))
        )
    }

    private func twoDWorkflowFixtureData(privacySentinel: String) throws -> Data {
        let fixture = """
        {
          "nodes": [
            { "id": "hub", "label": "Hub", "community": "Core", "source_file": "Notes/Hub.md", "modified_at": "2026-08-07T12:00:00Z", "type": "decision", "tags": ["memory"], "status": "active", "agent": "codex" },
            { "id": "wiki", "label": "Wiki", "community": "Core", "source_file": "Notes/Wiki.md", "modified_at": "2026-08-06T12:00:00Z" },
            { "id": "review-id", "label": "Review ID", "community": "Core", "source_file": "Notes/ReviewID.md" },
            { "id": "review-source", "label": "Review Source", "community": "Core", "source_file": "Notes/ReviewSource.md" },
            { "id": "g3", "label": "Graph Three", "community": "Core", "source_file": "Notes/G3.md" },
            { "id": "g4", "label": "Graph Four", "community": "Core", "source_file": "Notes/G4.md" },
            { "id": "g5", "label": "Graph Five", "community": "Core", "source_file": "Notes/G5.md" },
            { "id": "g6", "label": "Graph Six", "community": "Core", "source_file": "Notes/G6.md" },
            { "id": "g7", "label": "\(privacySentinel)", "community": "Research", "source_file": "Notes/G7.md" },
            { "id": "orphan", "label": "Orphan", "community": "Archive", "source_file": "Notes/Orphan.md" }
          ],
          "edges": [
            { "id": "edge-wiki", "from": "hub", "to": "wiki", "relation": "obsidian_wikilink", "source_file": "Notes/Hub.md" },
            { "id": "edge-review-id", "from": "hub", "to": "review-id", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" },
            { "id": "edge-review-source", "from": "hub", "to": "review-source", "relation": "graphify_inferred", "source_file": "Notes/Hub.md" },
            { "id": "edge-g3", "from": "hub", "to": "g3", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" },
            { "id": "edge-g4", "from": "hub", "to": "g4", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" },
            { "id": "edge-g5", "from": "hub", "to": "g5", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" },
            { "id": "edge-g6", "from": "hub", "to": "g6", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" },
            { "id": "edge-g7", "from": "hub", "to": "g7", "relation": "semantic_similarity", "source_file": "Notes/Hub.md" }
          ]
        }
        """
        return try XCTUnwrap(fixture.data(using: .utf8))
    }

    @MainActor
    private func makeTwoDRendererWebView(
        graphData: Data? = nil,
        nodeActionRecorder: GraphNodeActionRecorder? = nil
    ) throws -> (webView: WKWebView, htmlURL: URL, directory: URL) {
        let directory = try temporaryDirectory()
        let htmlURL = directory.appendingPathComponent("graph.html")
        try writeTwoDRendererHTML(graphData: graphData, to: htmlURL)
        return (try makeTwoDRendererWebViewForExistingHTML(nodeActionRecorder: nodeActionRecorder), htmlURL, directory)
    }

    @MainActor
    private func makeTwoDRendererWebViewForExistingHTML(nodeActionRecorder: GraphNodeActionRecorder? = nil) throws -> WKWebView {
        guard let runtimeURL = Bundle.main.url(forResource: "brainbar-graph-runtime", withExtension: "js", subdirectory: "Graph2D") else {
            throw BrainBarError.fileMissing("Graph2D/brainbar-graph-runtime.js")
        }
        let runtime = try String(contentsOf: runtimeURL, encoding: .utf8)
        guard let evidenceURL = Bundle.main.url(forResource: "brainbar-graph-evidence", withExtension: "js", subdirectory: "GraphEvidence") else {
            throw BrainBarError.fileMissing("GraphEvidence/brainbar-graph-evidence.js")
        }
        let evidence = try String(contentsOf: evidenceURL, encoding: .utf8)
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.addUserScript(
            WKUserScript(source: evidence, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        )
        configuration.userContentController.addUserScript(
            WKUserScript(source: runtime, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        if let nodeActionRecorder {
            configuration.userContentController.add(nodeActionRecorder, name: "brainBarNodeAction")
        }
        return WKWebView(frame: NSRect(x: 0, y: 0, width: 960, height: 640), configuration: configuration)
    }

    private func writeTwoDRendererHTML(graphData: Data?, to htmlURL: URL) throws {
        let rawNodes: String
        let rawEdges: String
        if
            let graphData,
            let graph = try JSONSerialization.jsonObject(with: graphData) as? [String: Any],
            let nodes = graph["nodes"],
            let edges = graph["edges"],
            let nodesData = try? JSONSerialization.data(withJSONObject: nodes),
            let edgesData = try? JSONSerialization.data(withJSONObject: edges),
            let nodesString = String(data: nodesData, encoding: .utf8),
            let edgesString = String(data: edgesData, encoding: .utf8)
        {
            rawNodes = nodesString
            rawEdges = edgesString
        } else {
            rawNodes = """
            [
              { id: 'node-a', label: 'Northstar', community: 'Research', source_file: 'Notes/Northstar.md' },
              { id: 'node-b', label: 'Orbit', community: 'Research', source_file: 'Notes/Orbit.md' },
              { id: 'node-c', label: 'Beacon', community: 'Archive', source_file: 'Notes/Beacon.md' },
              { id: 'node-d', label: 'Harbor', community: 'Archive', source_file: 'Notes/Harbor.md' }
            ]
            """
            rawEdges = """
            [
              { id: 'edge-ab', from: 'node-a', to: 'node-b', relation: 'obsidian_wikilink' },
              { id: 'edge-bc', from: 'node-b', to: 'node-c', relation: 'semantic_similarity' },
              { id: 'edge-cd', from: 'node-c', to: 'node-d', relation: 'graphify_inferred' }
            ]
            """
        }
        try """
        <!doctype html>
        <html><head><meta charset="utf-8"></head><body>
        <input id="search" type="search"><div id="graph"></div><div id="toolbar"></div><div id="info-content"></div>
        <script>
        window.RAW_NODES = \(rawNodes);
        window.RAW_EDGES = \(rawEdges);
        class DataSet {
          constructor(items) { this.items = items.map((item) => ({ ...item })); }
          get(id) { return arguments.length === 0 ? this.items.map((item) => ({ ...item })) : this.items.find((item) => String(item.id) === String(id)); }
          update(updates) { (Array.isArray(updates) ? updates : [updates]).forEach((update) => { const item = this.items.find((candidate) => String(candidate.id) === String(update.id)); if (item) Object.assign(item, update); }); }
        }
        window.nodesDS = new DataSet(window.RAW_NODES);
        window.edgesDS = new DataSet(window.RAW_EDGES);
        function showInfo(nodeId) {
          window.__brainBarShownNodeId = String(nodeId || '');
        }
        window.network = {
          selected: [],
          handlers: {},
          getSelectedNodes() { return this.selected.slice(); },
          selectNodes(ids) { this.selected = ids.slice(); },
          redraw() {},
          on(event, handler) { (this.handlers[event] ||= []).push(handler); },
          emit(event, payload) { (this.handlers[event] || []).forEach((handler) => handler(payload || {})); },
          setOptions() {}, getPosition() { return { x: 0, y: 0 }; }, fit() {}, focus() {}
        };
        </script>
        </body></html>
        """.write(to: htmlURL, atomically: true, encoding: .utf8)
    }

    @MainActor
    private func evaluateJavaScript(_ script: String, in webView: WKWebView) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            webView.evaluateJavaScript(script) { _, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }

    @MainActor
    private func evaluateJavaScriptValue(_ script: String, in webView: WKWebView) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { value, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: value as? String)
                }
            }
        }
    }

    @MainActor
    private func evaluateThreeDJavaScript(_ script: String, action: String, in webView: WKWebView) async throws {
        _ = try await evaluateThreeDJavaScriptValue(script, action: action, in: webView)
    }

    @MainActor
    private func evaluateThreeDJavaScriptValue(_ script: String, action: String, in webView: WKWebView) async throws -> String? {
        do {
            return try await evaluateJavaScriptValue(script, in: webView)
        } catch {
            throw NSError(
                domain: "BrainBarTests",
                code: 2,
                userInfo: [NSLocalizedDescriptionKey: "3D renderer action \(action) failed: \(error.localizedDescription)"]
            )
        }
    }

    @MainActor
    private func awaitThreeDGraphOperation(_ expression: String, action: String, in webView: WKWebView) async throws -> Bool {
        let script = """
        const result = await Promise.resolve(\(expression));
        return result === true ? 'true' : result === false ? 'false' : 'invalid';
        """
        do {
            guard let result = try await callAsyncJavaScriptString(script, in: webView) else {
                throw BrainBarError.processFailed("3D graph operation returned no completion state.")
            }
            guard result == "true" || result == "false" else {
                throw BrainBarError.processFailed("3D graph operation returned an invalid completion state.")
            }
            return result == "true"
        } catch {
            throw NSError(
                domain: "BrainBarTests",
                code: 6,
                userInfo: [NSLocalizedDescriptionKey: "3D renderer action \(action) failed: \(error.localizedDescription)"]
            )
        }
    }

    @MainActor
    private func beginThreeDGraphLoadFromScheme(
        _ promiseName: String,
        graphURL: String,
        lens: String,
        generation: Int,
        in webView: WKWebView
    ) async throws {
        let script = """
        const response = await fetch(\(Graph3DWebView.jsStringLiteral(graphURL)));
        if (!response.ok && response.status !== 0) {
          throw new Error('Graph fixture unavailable.');
        }
        const graph = await response.json();
        \(promiseName) = window.brainBarLoadGraph(graph, \(Graph3DWebView.jsStringLiteral(lens)), \(generation));
        return 'started';
        """
        guard try await callAsyncJavaScriptString(script, in: webView) == "started" else {
            throw BrainBarError.processFailed("3D graph load did not start.")
        }
    }

    @MainActor
    private func beginThreeDGraphOperation(_ assignment: String, in webView: WKWebView) async throws {
        guard try await callAsyncJavaScriptString("\(assignment); return 'started';", in: webView) == "started" else {
            throw BrainBarError.processFailed("3D graph operation did not start.")
        }
    }

    @MainActor
    private func awaitThreeDBooleanResult(_ promiseExpression: String, in webView: WKWebView) async throws -> Bool {
        let script = """
        const result = await Promise.resolve(\(promiseExpression));
        return result === true ? 'true' : result === false ? 'false' : 'invalid';
        """
        guard let result = try await callAsyncJavaScriptString(script, in: webView) else {
            throw BrainBarError.processFailed("3D graph operation returned no completion state.")
        }
        guard result == "true" || result == "false" else {
            throw BrainBarError.processFailed("3D graph operation returned an invalid completion state.")
        }
        return result == "true"
    }

    @MainActor
    private func awaitThreeDOperationResults(in webView: WKWebView) async throws -> (first: Bool, second: Bool) {
        let script = """
        const values = await Promise.all([
          Promise.resolve(window.__brainBarFirstLayout),
          Promise.resolve(window.__brainBarSecondLayout)
        ]);
        return JSON.stringify({ first: values[0] === true, second: values[1] === true });
        """
        guard
            let serialized = try await callAsyncJavaScriptString(script, in: webView),
            let data = serialized.data(using: .utf8),
            let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let first = diagnosticBool(value, "first"),
            let second = diagnosticBool(value, "second")
        else {
            throw BrainBarError.processFailed("Overlapping 3D graph operations returned invalid completion states.")
        }
        return (first, second)
    }

    @MainActor
    private func waitForHeldLayoutCacheLookup(
        lens: String,
        generation: Int,
        in webView: WKWebView,
        timeout: TimeInterval = 12
    ) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        let script = """
        (() => {
          const held = window.__brainBarLayoutCacheTest?.held?.();
          return held?.lens === \(Graph3DWebView.jsStringLiteral(lens)) && held?.generation === \(generation) ? 'ready' : null;
        })()
        """
        while Date() < deadline {
            if let value = try? await evaluateJavaScriptString(script, in: webView), value == "ready" {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("Latest held layout cache request did not reach the expected test state.")
    }

    @MainActor
    private func releaseHeldCacheAndAwaitOperationResults(in webView: WKWebView) async throws -> (release: Bool, first: Bool, second: Bool) {
        let script = """
        const release = window.__brainBarLayoutCacheTest.release();
        const values = await Promise.all([
          Promise.resolve(window.__brainBarHeldCacheFirst),
          Promise.resolve(window.__brainBarHeldCacheSecond)
        ]);
        return JSON.stringify({ release: release === true, first: values[0] === true, second: values[1] === true });
        """
        guard
            let serialized = try await callAsyncJavaScriptString(script, in: webView),
            let data = serialized.data(using: .utf8),
            let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let release = diagnosticBool(value, "release"),
            let first = diagnosticBool(value, "first"),
            let second = diagnosticBool(value, "second")
        else {
            throw BrainBarError.processFailed("Held cache release returned invalid latest-wins completion states.")
        }
        return (release, first, second)
    }

    @MainActor
    private func releaseHeldLayoutWorkerResult(in webView: WKWebView) async throws -> Bool {
        try await awaitThreeDBooleanResult("window.__brainBarLayoutWorkerTestRelease()", in: webView)
    }

    @MainActor
    private func waitForHeldLayoutWorkerResult(lens: String, generation: Int, in webView: WKWebView) async throws {
        let deadline = Date().addingTimeInterval(12)
        while Date() < deadline {
            let serialized = try await callAsyncJavaScriptString(
                "return JSON.stringify(window.__brainBarLayoutWorkerTestHeld?.() ?? null);",
                in: webView
            )
            if let serialized,
               serialized != "null",
               let data = serialized.data(using: .utf8),
               let held = try JSONSerialization.jsonObject(with: data) as? [String: Any],
               held["lens"] as? String == lens,
               (held["generation"] as? NSNumber)?.intValue == generation {
                return
            }
            try await Task.sleep(for: .milliseconds(50))
        }
        throw BrainBarError.processFailed("3D worker did not hold the expected replacement layout.")
    }

    @MainActor
    private func transactionalLayoutSnapshot(in webView: WKWebView) async throws -> TransactionalLayoutSnapshot {
        let serializedValue = try await callAsyncJavaScriptString(
            "return JSON.stringify(window.__brainBarLayoutWorkerTestSnapshot?.() ?? null);",
            in: webView
        )
        let serialized = try XCTUnwrap(serializedValue)
        return try JSONDecoder().decode(TransactionalLayoutSnapshot.self, from: Data(serialized.utf8))
    }

    @MainActor
    private func rendererGlobalGraphReady(in webView: WKWebView) async throws -> Bool {
        try await awaitThreeDBooleanResult("window.__brainBarGraphReady === true", in: webView)
    }

    @MainActor
    private func waitForCoordinatorGraphReady(_ coordinator: Graph3DWebView.Coordinator, timeout: TimeInterval = 12) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if coordinator.graphReady {
                return
            }
            await Task.yield()
        }
        throw BrainBarError.processFailed("3D coordinator did not accept the committed graph-ready event.")
    }

    @MainActor
    private func waitForRecordedGraphReadyGenerations(_ expected: [Int], recorder: GraphReadyEventRecorder, timeout: TimeInterval = 12) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if recorder.graphReadyGenerations == expected {
                return
            }
            await Task.yield()
        }
        throw BrainBarError.processFailed("3D graph-ready events did not match the latest layout generation.")
    }

    @MainActor
    private func evaluateJavaScriptString(_ script: String, in webView: WKWebView) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            webView.evaluateJavaScript(script) { value, error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(returning: value as? String)
                }
            }
        }
    }

    @MainActor
    private func callAsyncJavaScriptString(_ script: String, in webView: WKWebView) async throws -> String? {
        try await withCheckedThrowingContinuation { continuation in
            webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { result in
                switch result {
                case .success(let value):
                    continuation.resume(returning: value as? String)
                case .failure(let error):
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    @MainActor
    private func waitForRendererFunction(_ functionName: String, in webView: WKWebView, phase: String, timeout: TimeInterval = 12) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        let script = "typeof window[\(Graph3DWebView.jsStringLiteral(functionName))] === 'function' ? 'ready' : null"
        while Date() < deadline {
            if let value = try? await evaluateJavaScriptString(script, in: webView), value == "ready" {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw NSError(
            domain: "BrainBarTests",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "Timed out during renderer phase \(phase)."]
        )
    }

    @MainActor
    private func waitForRendererObject(_ objectName: String, in webView: WKWebView, phase: String, timeout: TimeInterval = 12) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        let script = "window[\(Graph3DWebView.jsStringLiteral(objectName))] && typeof window[\(Graph3DWebView.jsStringLiteral(objectName))] === 'object' ? 'ready' : null"
        while Date() < deadline {
            if let value = try? await evaluateJavaScriptString(script, in: webView), value == "ready" {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw NSError(
            domain: "BrainBarTests",
            code: 5,
            userInfo: [NSLocalizedDescriptionKey: "Timed out during renderer phase \(phase)."]
        )
    }

    @MainActor
    private func waitForTwoDWorkflowRuntime(in webView: WKWebView, timeout: TimeInterval = 2) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        let script = """
        (() => {
          const handlers = window.network?.handlers || {};
          const toolbarReady = Boolean(
            document.querySelector('button[data-lens="all"]') &&
            document.querySelector('button[data-lens="obsidian"]') &&
            document.querySelector('button[data-lens="graphify"]') &&
            document.querySelector('button[data-view="focus"]') &&
            document.querySelector('button[data-view="recent"]') &&
            document.querySelector('button[data-view="groups"]') &&
            document.querySelector('button[data-view="health"]')
          );
          const bridgeReady = (handlers.selectNode || []).length > 0 &&
            (handlers.selectEdge || []).length > 0 &&
            (handlers.doubleClick || []).length > 0 &&
            window.__brainBarShowInfoWrapped === true;
          return toolbarReady && bridgeReady ? 'ready' : null;
        })()
        """
        while Date() < deadline {
            if (try? await evaluateJavaScriptString(script, in: webView)) == "ready" {
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("2D workflow runtime did not install its toolbar and network handlers.")
    }

    @MainActor
    private func invokeThreeDLayoutResponsivenessProbe(graphURL: String, in webView: WKWebView) async throws -> ThreeDLayoutResponsivenessProbe {
        let script = """
        const fetchStartedAt = performance.now();
        const response = await fetch(\(Graph3DWebView.jsStringLiteral(graphURL)));
        if (!response.ok && response.status !== 0) {
          throw new Error('Graph fixture unavailable.');
        }
        const graph = await response.json();
        const graphFetchAndParseMs = performance.now() - fetchStartedAt;
        const startedAt = performance.now();
        const timerProbe = new Promise((resolve) => {
          setTimeout(() => resolve(performance.now() - startedAt), 0);
        });
        const result = window.brainBarLoadGraph(graph, 'all', 9001);
        const callReturnMs = performance.now() - startedAt;
        const resolvedResult = await Promise.resolve(result);
        const zeroDelayTimerProbeMs = await timerProbe;
        return JSON.stringify({
          graphFetchAndParseMs,
          callReturnMs,
          zeroDelayTimerProbeMs,
          didSucceed: resolvedResult !== false
        });
        """
        guard
            let serialized = try await callAsyncJavaScriptString(script, in: webView),
            let data = serialized.data(using: .utf8),
            let value = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let graphFetchAndParseMs = diagnosticDouble(value, "graphFetchAndParseMs"), graphFetchAndParseMs.isFinite,
            let callReturnMs = diagnosticDouble(value, "callReturnMs"), callReturnMs.isFinite,
            let zeroDelayTimerProbeMs = diagnosticDouble(value, "zeroDelayTimerProbeMs"), zeroDelayTimerProbeMs.isFinite,
            let didSucceed = diagnosticBool(value, "didSucceed")
        else {
            throw BrainBarError.processFailed("3D layout responsiveness probe returned invalid content-free metrics.")
        }
        return ThreeDLayoutResponsivenessProbe(
            graphFetchAndParseMs: graphFetchAndParseMs,
            callReturnMs: callReturnMs,
            zeroDelayTimerProbeMs: zeroDelayTimerProbeMs,
            didSucceed: didSucceed
        )
    }

    @MainActor
    private func stopRendererWebView(_ webView: WKWebView, messageHandlerNames: [String] = []) {
        webView.stopLoading()
        webView.navigationDelegate = nil
        for name in messageHandlerNames {
            webView.configuration.userContentController.removeScriptMessageHandler(forName: name)
        }
    }

    @MainActor
    private func quiesceRendererWebView(_ webView: WKWebView, messageHandlerNames: [String] = []) async {
        stopRendererWebView(webView, messageHandlerNames: messageHandlerNames)
        await Task.yield()
        await Task.yield()
    }

    @MainActor
    private func closeTwoDRendererTestHost(
        _ host: RendererWebViewHost,
        messageHandlerNames: [String]
    ) async throws {
        host.webView.loadHTMLString("<!doctype html><html><body></body></html>", baseURL: nil)
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            if (try? await evaluateJavaScriptString("document.readyState", in: host.webView)) == "complete" {
                host.close(messageHandlerNames: messageHandlerNames)
                await Task.yield()
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("2D test host did not navigate to its blank teardown page.")
    }

    @MainActor
    private func closeThreeDRendererTestHost(
        _ host: RendererWebViewHost,
        messageHandlerNames: [String]
    ) async throws {
        _ = try? await evaluateThreeDJavaScript(
            "window.brainBarAbortGraphLoad?.()",
            action: "abort 3D renderer before teardown",
            in: host.webView
        )
        host.webView.loadHTMLString("<!doctype html><html><body></body></html>", baseURL: nil)
        let deadline = Date().addingTimeInterval(2)
        while Date() < deadline {
            if (try? await evaluateJavaScriptString("document.readyState", in: host.webView)) == "complete" {
                host.close(messageHandlerNames: messageHandlerNames)
                await Task.yield()
                return
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("3D test host did not navigate to its blank teardown page.")
    }

    @MainActor
    private func quiesceThreeDRendererWebView(_ webView: WKWebView, messageHandlerNames: [String] = []) async throws {
        _ = try await waitForRendererDiagnostics(
            in: webView,
            functionName: "brainBarRendererDiagnostics",
            phase: "3D layout commit before teardown"
        ) {
            diagnosticString($0, "layoutState") == "committed" &&
            diagnosticBool($0, "paintedCountsSettled") == true
        }
        await quiesceRendererWebView(webView, messageHandlerNames: messageHandlerNames)
    }

    @MainActor
    private func waitForRendererDiagnostics(
        in webView: WKWebView,
        functionName: String,
        phase: String,
        timeout: TimeInterval = 12,
        flushMeasurementPaint: Bool = true,
        matching predicate: ([String: Any]) -> Bool
    ) async throws -> [String: Any] {
        let deadline = Date().addingTimeInterval(timeout)
        var lastValue = "diagnostics function was not installed"
        var didFlushMeasurementPaint = false
        while Date() < deadline {
            do {
                let script = "(() => { const diagnostics = window[\(Graph3DWebView.jsStringLiteral(functionName))]; return typeof diagnostics === 'function' ? JSON.stringify(diagnostics()) : null; })()"
                if let serialized = try await evaluateJavaScriptString(script, in: webView) {
                    lastValue = serialized
                    guard
                        let data = serialized.data(using: .utf8),
                        let diagnostics = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                    else {
                        continue
                    }
                    if predicate(diagnostics) {
                        return diagnostics
                    }
                    if flushMeasurementPaint,
                       !didFlushMeasurementPaint,
                       diagnosticString(diagnostics, "layoutState") == "committed",
                       diagnosticBool(diagnostics, "paintedCountsSettled") == false {
                        didFlushMeasurementPaint = true
                        _ = try? await evaluateThreeDJavaScript(
                            "window.brainBarFlushRendererForMeasurement?.()",
                            action: "flush suspended measurement paint",
                            in: webView
                        )
                    }
                }
            } catch {
                lastValue = error.localizedDescription
            }
            do {
                try await Task.sleep(nanoseconds: 50_000_000)
            } catch {
                throw NSError(
                    domain: "BrainBarTests",
                    code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "Renderer polling interrupted during \(phase): \(lastValue); \(error.localizedDescription)"]
                )
            }
        }
        throw NSError(
            domain: "BrainBarTests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Timed out during renderer phase \(phase): \(lastValue)"]
        )
    }

    @MainActor
    private func waitForThreeDNodeInfoText(
        in webView: WKWebView,
        phase: String,
        requiring fragments: [String],
        timeout: TimeInterval = 12
    ) async throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        var lastText = "node inspector was unavailable"
        var didFlushScheduledWork = false
        while Date() < deadline {
            do {
                if let text = try await evaluateJavaScriptString(
                    "document.getElementById('node-info')?.textContent || ''",
                    in: webView
                ) {
                    lastText = text
                    if fragments.allSatisfy(text.contains) {
                        return text
                    }
                    if !didFlushScheduledWork {
                        didFlushScheduledWork = true
                        _ = try? await evaluateThreeDJavaScript(
                            "window.brainBarFlushRendererForMeasurement?.()",
                            action: "flush suspended evidence panel",
                            in: webView
                        )
                    }
                }
            } catch {
                lastText = error.localizedDescription
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("Timed out during \(phase): \(lastText)")
    }

    @MainActor
    private func navigateToTestPage(
        _ url: URL,
        queryItem name: String,
        value: String,
        in webView: WKWebView,
        timeout: TimeInterval = 12
    ) async throws {
        let marker = UUID().uuidString
        try await evaluateJavaScript(
            "window.__brainBarPreviousDocumentMarker = \(Graph3DWebView.jsStringLiteral(marker))",
            in: webView
        )
        webView.load(URLRequest(url: url))
        let deadline = Date().addingTimeInterval(timeout)
        var lastLocation = "unavailable"
        let script = "JSON.stringify({ href: window.location.href, value: new URLSearchParams(window.location.search).get(\(Graph3DWebView.jsStringLiteral(name))), isFresh: window.__brainBarPreviousDocumentMarker !== \(Graph3DWebView.jsStringLiteral(marker)), readyState: document.readyState })"
        while Date() < deadline {
            if let serialized = try? await evaluateJavaScriptString(script, in: webView) {
                lastLocation = serialized
                if
                    let data = serialized.data(using: .utf8),
                    let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                    result["value"] as? String == value,
                    result["isFresh"] as? Bool == true,
                    result["readyState"] as? String == "complete"
                {
                    return
                }
            }
            try await Task.sleep(nanoseconds: 50_000_000)
        }
        throw BrainBarError.processFailed("Timed out waiting for the committed test page: \(lastLocation)")
    }

    private func diagnosticCount(_ diagnostics: [String: Any], _ key: String) -> Int? {
        (diagnostics[key] as? NSNumber)?.intValue
    }

    private func diagnosticDouble(_ diagnostics: [String: Any], _ key: String) -> Double? {
        (diagnostics[key] as? NSNumber)?.doubleValue
    }

    private func diagnosticString(_ diagnostics: [String: Any], _ key: String) -> String? {
        diagnostics[key] as? String
    }

    private func diagnosticBool(_ diagnostics: [String: Any], _ key: String) -> Bool? {
        diagnostics[key] as? Bool
    }

    private func assertRendererDiagnosticsAreContentFree(_ diagnostics: [String: Any]) {
        let data = try? JSONSerialization.data(withJSONObject: diagnostics, options: [.sortedKeys])
        let serialized = String(data: data ?? Data(), encoding: .utf8) ?? ""
        for forbiddenValue in [
            "node-a", "node-b", "node-c", "node-d", "edge-ab", "edge-bc", "edge-cd",
            "Northstar", "Beacon", "Harbor",
            "Notes/Northstar.md", "Notes/Orbit.md", "Notes/Beacon.md", "Notes/Harbor.md",
            "northstar", "beacon", "hostile-load-lens", "hostile-lens-query"
        ] {
            XCTAssertFalse(serialized.localizedCaseInsensitiveContains(forbiddenValue), "Diagnostics leaked \(forbiddenValue): \(serialized)")
        }
    }

    private func assert2DDiagnosticShape(_ diagnostics: [String: Any]) {
        XCTAssertEqual(
            Set(diagnostics.keys),
            Set([
                "activeMode", "lens", "queryableNodes", "queryableEdges", "visibleNodes", "visibleEdges",
                "paintedNodes", "paintedEdges", "paintedCountsSettled", "selectedNodeCount", "searchResultCount", "networkAvailable",
                "workflowHighlightNodeCount", "workflowHighlightPendingPathCount"
            ])
        )
        for key in ["queryableNodes", "queryableEdges", "visibleNodes", "visibleEdges", "paintedNodes", "paintedEdges", "selectedNodeCount", "searchResultCount"] {
            XCTAssertNotNil(diagnosticCount(diagnostics, key), "Expected numeric 2D diagnostic: \(key)")
        }
        XCTAssertNotNil(diagnosticBool(diagnostics, "paintedCountsSettled"))
        XCTAssertNotNil(diagnosticBool(diagnostics, "networkAvailable"))
    }

    private func radarConfigurationManager(vault: URL, command: String) throws -> ConfigurationManager {
        let configURL = vault.appendingPathComponent("config.json")
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": configURL.path]
        var config = BrainBarConfig.default
        config.vaultPath = vault.path
        config.commands.refreshGraph.executable = command
        config.agentActivity = .init(eventTracingEnabled: false, fileActivityEnabled: false)
        try manager.save(config)
        return manager
    }

    private func writeRadarGraph(to vault: URL, nodeStatus: String) throws -> URL {
        let graphURL = vault.appendingPathComponent("graphify-out/graph.json")
        try FileManager.default.createDirectory(at: graphURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try """
        {
          "nodes": [
            { "id": "one", "label": "One", "source_file": "Notes/One.md", "status": "\(nodeStatus)", "category": "note" }
          ],
          "edges": []
        }
        """.write(to: graphURL, atomically: true, encoding: .utf8)
        return graphURL
    }

    @MainActor
    private func waitForRadarGate(_ gate: GraphDataLoaderGate, count: Int) async -> Bool {
        for _ in 0..<100 {
            if await gate.waiterCount() >= count { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return false
    }

    @MainActor
    private func waitForRadarCommitGate(_ gate: GraphChangeRadarCommitGate, count: Int = 1) async -> Bool {
        for _ in 0..<100 {
            if await gate.claimInvocationCount() >= count { return true }
            try? await Task.sleep(for: .milliseconds(10))
        }
        return false
    }

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("BrainBarTests")
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func measurementRequestTemporaryDirectory() throws -> URL {
        let url = URL(fileURLWithPath: "/private/tmp/brainbar-renderer-measurements-test-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    private func removeTemporaryDirectory(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }

    private func processIsGone(_ pid: pid_t) -> Bool {
        guard Darwin.kill(pid, 0) != 0 else {
            return false
        }
        return errno == ESRCH
    }

    private func processIsLive(_ pid: pid_t) -> Bool {
        guard Darwin.kill(pid, 0) != 0 else {
            return true
        }
        return errno == EPERM
    }

    private func freePort() throws -> Int {
        let descriptor = socket(AF_INET, SOCK_STREAM, 0)
        XCTAssertGreaterThanOrEqual(descriptor, 0)
        defer { close(descriptor) }

        var address = sockaddr_in()
        address.sin_family = sa_family_t(AF_INET)
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        address.sin_port = 0

        let bindResult = withUnsafePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(descriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        XCTAssertEqual(bindResult, 0)

        var length = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &address) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.getsockname(descriptor, $0, &length)
            }
        }
        XCTAssertEqual(nameResult, 0)
        return Int(UInt16(bigEndian: address.sin_port))
    }
}
