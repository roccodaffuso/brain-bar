import Foundation
import XCTest
import WebKit
@testable import BrainBar

final class Graph3DPresentationStateTests: XCTestCase {
    func testPresentationWireValuesAreStable() {
        XCTAssertEqual(GraphDetailLevel.allCases.map(\.rawValue), ["overview", "balanced", "full"])
        XCTAssertEqual(GraphDetailReason.allCases.map(\.rawValue), ["user", "adaptive-default", "focus-override", "performance-degrade"])
        XCTAssertEqual(GraphSidebarState.allCases.map(\.rawValue), ["collapsed", "overlay", "docked"])
        XCTAssertEqual(
            GraphCameraPreset.allCases.map(\.rawValue),
            ["overview", "community", "node-focus", "active-path", "recent-orbit", "manual"]
        )
    }

    @MainActor
    func testV1SessionMigratesToPresentationDefaults() throws {
        let legacy: [String: Any] = [
            "schemaVersion": 1,
            "graphVersion": "digest-v1",
            "selectedNodeID": "node-a",
            "sourceLens": "graphify",
            "cameraState": [
                "position": ["x": 1, "y": 2, "z": 3],
                "target": ["x": 0, "y": 0, "z": 0],
                "zoom": 1.25,
                "preset": "Manual"
            ]
        ]

        let state = try XCTUnwrap(Graph3DWebView.decodeGraphSessionState(legacy))

        XCTAssertEqual(state.schemaVersion, 2)
        XCTAssertEqual(state.detailLevel, .overview)
        XCTAssertEqual(state.detailReason, .adaptiveDefault)
        XCTAssertEqual(state.sidebarState, .collapsed)
        XCTAssertNil(state.sidebarWidth)
        XCTAssertEqual(state.cameraPreset, .manual)
        XCTAssertEqual(state.cameraHistory, [])
        XCTAssertFalse(state.reduceMotion)
        XCTAssertFalse(state.includesThreeDPresentationState)
    }

    func testV2RoundTripNormalizesAndBoundsPresentationState() throws {
        let history = (0..<10).map { index in
            GraphCameraHistoryEntry(
                preset: index.isMultiple(of: 2) ? .community : .nodeFocus,
                selectedNodeID: " node-\(index) ",
                communityID: " community-\(index) ",
                path: nil,
                cameraState: nil
            )
        }
        let state = GraphSessionState(
            detailLevel: .full,
            detailReason: .user,
            sidebarState: .docked,
            sidebarWidth: 120,
            cameraPreset: .activePath,
            cameraHistory: history,
            reduceMotion: true
        ).normalized
        let data = try JSONEncoder().encode(state)
        let decoded = try JSONDecoder().decode(GraphSessionState.self, from: data)

        XCTAssertEqual(decoded.schemaVersion, 2)
        XCTAssertEqual(decoded.detailLevel, .full)
        XCTAssertEqual(decoded.detailReason, .user)
        XCTAssertEqual(decoded.sidebarState, .docked)
        XCTAssertEqual(decoded.sidebarWidth, 300)
        XCTAssertEqual(decoded.cameraPreset, .activePath)
        XCTAssertEqual(decoded.cameraHistory.count, 8)
        XCTAssertEqual(decoded.cameraHistory.first?.selectedNodeID, " node-2 ")
        XCTAssertTrue(decoded.reduceMotion)
        XCTAssertTrue(decoded.includesThreeDPresentationState)
    }

    func testCameraHistoryCompactionBoundsIdentifiersVariantsAndSerializedBudget() throws {
        let longIdentity = String(repeating: "identity-", count: 80)
        let longVariant = String(repeating: "variant-", count: 40)
        let history = (0..<GraphSessionState.maximumCameraHistoryEntries).map { _ in
            GraphCameraHistoryEntry(
                preset: .activePath,
                selectedNodeID: longIdentity,
                communityID: longIdentity,
                path: GraphPathContext(
                    sourceNodeID: longIdentity,
                    targetNodeID: longIdentity,
                    variant: longVariant
                ),
                cameraState: GraphCameraState(
                    position: GraphVector3(x: 1, y: 2, z: 3),
                    target: GraphVector3(x: 0, y: 0, z: 0),
                    zoom: 1,
                    preset: longVariant
                )
            )
        }
        let normalized = GraphSessionState(cameraHistory: history).normalized
        let entry = try XCTUnwrap(normalized.cameraHistory.first)

        XCTAssertLessThanOrEqual(entry.selectedNodeID?.count ?? 0, GraphSessionState.maximumCameraHistoryIdentifierLength)
        XCTAssertLessThanOrEqual(entry.communityID?.count ?? 0, GraphSessionState.maximumCameraHistoryIdentifierLength)
        XCTAssertLessThanOrEqual(entry.path?.sourceNodeID.count ?? 0, GraphSessionState.maximumCameraHistoryIdentifierLength)
        XCTAssertLessThanOrEqual(entry.path?.targetNodeID?.count ?? 0, GraphSessionState.maximumCameraHistoryIdentifierLength)
        XCTAssertLessThanOrEqual(entry.path?.variant.count ?? 0, GraphSessionState.maximumCameraHistoryVariantLength)
        XCTAssertLessThanOrEqual(entry.cameraState?.preset.count ?? 0, GraphSessionState.maximumCameraHistoryVariantLength)
        XCTAssertLessThanOrEqual(
            try JSONEncoder().encode(normalized.cameraHistory).count,
            GraphSessionState.maximumCameraHistorySerializedBytes
        )
    }

    @MainActor
    func testFutureSessionSchemaIsRejectedByBothRendererBridges() throws {
        let future: [String: Any] = ["schemaVersion": 3]

        XCTAssertNil(Graph3DWebView.decodeGraphSessionState(future))
        XCTAssertNil(GraphWebView.decodeGraphSessionState(future))
    }

    @MainActor
    func testLegacy2DRendererRoundTripPreservesThreeDPresentationState() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": directory.appendingPathComponent("config.json").path]
        let model = AppModel(configurationManager: manager)
        model.updateGraphSessionState(GraphSessionState(
            detailLevel: .balanced,
            detailReason: .focusOverride,
            sidebarState: .docked,
            sidebarWidth: 380,
            cameraPreset: .nodeFocus,
            cameraHistory: [GraphCameraHistoryEntry(
                preset: .community,
                selectedNodeID: "node-a",
                communityID: "community-a",
                path: nil,
                cameraState: nil
            )],
            reduceMotion: true
        ))
        let legacyPayload: [String: Any] = [
            "schemaVersion": 1,
            "selectedNodeID": "node-b",
            "sourceLens": "obsidian",
            "searchQuery": "status:active"
        ]
        let legacyState = try XCTUnwrap(GraphWebView.decodeGraphSessionState(legacyPayload))

        model.updateGraphSessionStateFromRenderer(legacyState)

        XCTAssertEqual(model.graphSessionState.selectedNodeID, "node-b")
        XCTAssertEqual(model.graphSourceLens, .obsidian)
        XCTAssertEqual(model.graphSessionState.detailLevel, .balanced)
        XCTAssertEqual(model.graphSessionState.detailReason, .focusOverride)
        XCTAssertEqual(model.graphSessionState.sidebarState, .docked)
        XCTAssertEqual(model.graphSessionState.sidebarWidth, 380)
        XCTAssertEqual(model.graphSessionState.cameraPreset, .nodeFocus)
        XCTAssertEqual(model.graphSessionState.cameraHistory.count, 1)
        XCTAssertTrue(model.graphSessionState.reduceMotion)
    }

    @MainActor
    func testSavedViewAndBridgeJSONContainOnlyDisplayStateAndPermittedIdentities() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let savedViewsURL = directory.appendingPathComponent("saved-views.json")
        let store = SavedGraphViewStore(fileURL: savedViewsURL)
        var manager = ConfigurationManager()
        manager.environment = ["BRAIN_BAR_CONFIG": directory.appendingPathComponent("config.json").path]
        let model = AppModel(configurationManager: manager, savedGraphViewStore: store)
        let presentation = GraphSessionState(
            selectedNodeID: "node-a",
            detailLevel: .balanced,
            detailReason: .performanceDegrade,
            sidebarState: .overlay,
            cameraPreset: .recentOrbit,
            cameraHistory: [GraphCameraHistoryEntry(
                preset: .recentOrbit,
                selectedNodeID: "node-a",
                communityID: nil,
                path: GraphPathContext(sourceNodeID: "node-a", targetNodeID: "node-b", variant: "shortest"),
                cameraState: nil
            )],
            reduceMotion: true
        )
        model.updateGraphSessionState(presentation)
        await model.saveCurrentGraphView(named: "Presentation")

        let saved = try XCTUnwrap(model.savedGraphViews.first)
        XCTAssertEqual(saved.session.detailLevel, .balanced)
        XCTAssertEqual(saved.session.cameraPreset, .recentOrbit)
        XCTAssertTrue(saved.session.reduceMotion)

        let bridgeJSON = Graph3DWebView.graphSessionJSON(saved.session)
        let persistedJSON = try String(contentsOf: savedViewsURL, encoding: .utf8)
        for forbidden in ["NOTE_CONTENT_SENTINEL", "noteContent", "source_file", "label", "searchHistory"] {
            XCTAssertFalse(bridgeJSON.contains(forbidden))
            XCTAssertFalse(persistedJSON.contains(forbidden))
        }
        XCTAssertTrue(bridgeJSON.contains("\"schemaVersion\":2"))
        XCTAssertTrue(bridgeJSON.contains("\"detailLevel\":\"balanced\""))
        XCTAssertTrue(bridgeJSON.contains("\"cameraPreset\":\"recent-orbit\""))
    }

    @MainActor
    func testThreeDViewportCommandsUseLatestStrictlyIncreasingPendingID() throws {
        let coordinator = Graph3DWebView.Coordinator(
            onDiagnostic: { _ in },
            onOpenNode: { _ in }
        )
        let newest = GraphViewportCommand(id: 8, kind: .setDetailLevel, payload: "full")
        let stale = GraphViewportCommand(id: 7, kind: .setDetailLevel, payload: "overview")

        coordinator.receiveViewportCommand(newest)
        coordinator.receiveViewportCommand(stale)

        XCTAssertEqual(coordinator.pendingViewportCommand, newest)
        XCTAssertNil(coordinator.lastViewportCommandID)
        let webView = WKWebView()

        coordinator.applyViewportCommandIfNeeded(coordinator.pendingViewportCommand, in: webView)

        XCTAssertNil(coordinator.lastViewportCommandID)
        XCTAssertEqual(coordinator.pendingViewportCommand, newest)
    }

    @MainActor
    func testTwoDViewportCommandsUseLatestStrictlyIncreasingPendingID() {
        let coordinator = GraphWebView.Coordinator(onOpenNode: { _ in })
        let newest = GraphViewportCommand(id: 8, kind: .fit, payload: nil)
        let stale = GraphViewportCommand(id: 7, kind: .zoomIn, payload: nil)

        coordinator.receiveViewportCommand(newest)
        coordinator.receiveViewportCommand(stale)

        XCTAssertEqual(coordinator.pendingViewportCommand, newest)
        XCTAssertEqual(coordinator.lastViewportCommandID, -1)
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("Graph3DPresentationStateTests")
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}
