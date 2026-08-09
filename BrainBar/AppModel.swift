import AppKit
import Foundation
import Observation

enum GraphSourceLens: String, CaseIterable, Identifiable, Codable, Sendable {
    case all
    case graphify
    case obsidian

    var id: String { rawValue }

    var label: String {
        switch self {
        case .all:
            return "All"
        case .graphify:
            return "Graphify"
        case .obsidian:
            return "Wikilinks"
        }
    }

    var help: String {
        switch self {
        case .all:
            return "Show every graph edge"
        case .graphify:
            return "Show generated Graphify relationships"
        case .obsidian:
            return "Show wikilinks exported in the Graphify output"
        }
    }
}

enum GraphViewMode: String, CaseIterable, Codable, Identifiable, Sendable {
    case threeD
    case twoD

    var id: String { rawValue }

    var label: String {
        switch self {
        case .twoD:
            return "2D"
        case .threeD:
            return "3D"
        }
    }

    var help: String {
        switch self {
        case .twoD:
            return "Open this context in the 2D Workbench"
        case .threeD:
            return "Open this context in the 3D focus explorer"
        }
    }
}

struct GraphPathContext: Codable, Equatable, Sendable {
    var sourceNodeID: String
    var targetNodeID: String?
    var variant: String
}

struct GraphVector3: Codable, Equatable, Sendable {
    var x: Double
    var y: Double
    var z: Double
}

struct GraphCameraState: Codable, Equatable, Sendable {
    var position: GraphVector3
    var target: GraphVector3
    var zoom: Double
    var preset: String

    var normalized: GraphCameraState? {
        guard
            position.x.isFinite, position.y.isFinite, position.z.isFinite,
            target.x.isFinite, target.y.isFinite, target.z.isFinite,
            zoom.isFinite, zoom > 0
        else {
            return nil
        }
        var state = self
        state.zoom = min(max(zoom, 0.08), 8)
        let trimmedPreset = preset.trimmingCharacters(in: .whitespacesAndNewlines)
        state.preset = trimmedPreset.isEmpty ? "Saved view" : trimmedPreset
        return state
    }
}

enum GraphDetailLevel: String, CaseIterable, Codable, Sendable {
    case overview
    case balanced
    case full
}

enum GraphDetailReason: String, CaseIterable, Codable, Sendable {
    case user
    case adaptiveDefault = "adaptive-default"
    case focusOverride = "focus-override"
    case performanceDegrade = "performance-degrade"
}

enum GraphSidebarState: String, CaseIterable, Codable, Sendable {
    case collapsed
    case overlay
    case docked
}

enum GraphCameraPreset: String, CaseIterable, Codable, Sendable {
    case overview
    case community
    case nodeFocus = "node-focus"
    case activePath = "active-path"
    case recentOrbit = "recent-orbit"
    case manual
}

struct GraphCameraHistoryEntry: Codable, Equatable, Sendable {
    var preset: GraphCameraPreset
    var selectedNodeID: String?
    var communityID: String?
    var path: GraphPathContext?
    var cameraState: GraphCameraState?

    var normalized: GraphCameraHistoryEntry {
        var entry = self
        entry.selectedNodeID = Self.compactIdentifier(entry.selectedNodeID)
        entry.communityID = Self.compactIdentifier(entry.communityID)
        if let path = entry.path, let source = Self.compactIdentifier(path.sourceNodeID) {
            let variant = Self.compactVariant(path.variant)
            entry.path = GraphPathContext(
                sourceNodeID: source,
                targetNodeID: Self.compactIdentifier(path.targetNodeID),
                variant: variant
            )
        } else {
            entry.path = nil
        }
        entry.cameraState = entry.cameraState?.normalized.map { state in
            var compacted = state
            compacted.preset = Self.compactVariant(state.preset)
            return compacted
        }
        return entry
    }

    private static func compactIdentifier(_ value: String?) -> String? {
        guard let value = value?.nilIfEmpty else {
            return nil
        }
        return String(value.prefix(GraphSessionState.maximumCameraHistoryIdentifierLength))
    }

    private static func compactVariant(_ value: String) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = trimmed.isEmpty ? "shortest" : trimmed
        return String(fallback.prefix(GraphSessionState.maximumCameraHistoryVariantLength))
    }
}

struct GraphSessionState: Codable, Equatable, Sendable {
    static let currentSchemaVersion = 2
    static let maximumCameraHistoryEntries = 8
    static let maximumCameraHistoryIdentifierLength = 160
    static let maximumCameraHistoryVariantLength = 64
    static let maximumCameraHistorySerializedBytes = 4_096
    static let defaultDockedSidebarWidth = 360.0
    static let minimumDockedSidebarWidth = 300.0

    var schemaVersion: Int
    var graphVersion: String?
    var selectedNodeID: String?
    var sourceLens: GraphSourceLens
    var focusDepth: Int?
    var path: GraphPathContext?
    var communityID: String?
    var searchQuery: String
    var cameraState: GraphCameraState?
    var detailLevel: GraphDetailLevel
    var detailReason: GraphDetailReason
    var sidebarState: GraphSidebarState
    /// Stored in points. The renderer additionally clamps this to 44% of its live viewport.
    var sidebarWidth: Double?
    var cameraPreset: GraphCameraPreset
    var cameraHistory: [GraphCameraHistoryEntry]
    var reduceMotion: Bool

    /// Identifies a v2 bridge payload. It is intentionally not persisted.
    private(set) var includesThreeDPresentationState: Bool

    init(
        schemaVersion: Int = currentSchemaVersion,
        graphVersion: String? = nil,
        selectedNodeID: String? = nil,
        sourceLens: GraphSourceLens = .all,
        focusDepth: Int? = nil,
        path: GraphPathContext? = nil,
        communityID: String? = nil,
        searchQuery: String = "",
        cameraState: GraphCameraState? = nil,
        detailLevel: GraphDetailLevel = .overview,
        detailReason: GraphDetailReason = .adaptiveDefault,
        sidebarState: GraphSidebarState = .collapsed,
        sidebarWidth: Double? = nil,
        cameraPreset: GraphCameraPreset = .manual,
        cameraHistory: [GraphCameraHistoryEntry] = [],
        reduceMotion: Bool = false
    ) {
        self.schemaVersion = schemaVersion
        self.graphVersion = graphVersion
        self.selectedNodeID = selectedNodeID
        self.sourceLens = sourceLens
        self.focusDepth = focusDepth
        self.path = path
        self.communityID = communityID
        self.searchQuery = searchQuery
        self.cameraState = cameraState
        self.detailLevel = detailLevel
        self.detailReason = detailReason
        self.sidebarState = sidebarState
        self.sidebarWidth = sidebarWidth
        self.cameraPreset = cameraPreset
        self.cameraHistory = cameraHistory
        self.reduceMotion = reduceMotion
        self.includesThreeDPresentationState = true
    }

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case graphVersion
        case selectedNodeID
        case sourceLens
        case focusDepth
        case path
        case communityID
        case searchQuery
        case cameraState
        case detailLevel
        case detailReason
        case sidebarState
        case sidebarWidth
        case cameraPreset
        case cameraHistory
        case reduceMotion
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        let version = try values.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        guard version <= Self.currentSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .schemaVersion,
                in: values,
                debugDescription: "Unsupported graph session schema version."
            )
        }

        schemaVersion = Self.currentSchemaVersion
        graphVersion = try values.decodeIfPresent(String.self, forKey: .graphVersion)
        selectedNodeID = try values.decodeIfPresent(String.self, forKey: .selectedNodeID)
        sourceLens = try values.decodeIfPresent(GraphSourceLens.self, forKey: .sourceLens) ?? .all
        focusDepth = try values.decodeIfPresent(Int.self, forKey: .focusDepth)
        path = try values.decodeIfPresent(GraphPathContext.self, forKey: .path)
        communityID = try values.decodeIfPresent(String.self, forKey: .communityID)
        searchQuery = try values.decodeIfPresent(String.self, forKey: .searchQuery) ?? ""
        cameraState = try values.decodeIfPresent(GraphCameraState.self, forKey: .cameraState)
        detailLevel = try values.decodeIfPresent(GraphDetailLevel.self, forKey: .detailLevel) ?? .overview
        detailReason = try values.decodeIfPresent(GraphDetailReason.self, forKey: .detailReason) ?? .adaptiveDefault
        sidebarState = try values.decodeIfPresent(GraphSidebarState.self, forKey: .sidebarState) ?? .collapsed
        sidebarWidth = try values.decodeIfPresent(Double.self, forKey: .sidebarWidth)
        cameraPreset = try values.decodeIfPresent(GraphCameraPreset.self, forKey: .cameraPreset) ?? .manual
        cameraHistory = try values.decodeIfPresent([GraphCameraHistoryEntry].self, forKey: .cameraHistory) ?? []
        reduceMotion = try values.decodeIfPresent(Bool.self, forKey: .reduceMotion) ?? false
        includesThreeDPresentationState = version >= 2
            || values.contains(.detailLevel)
            || values.contains(.detailReason)
            || values.contains(.sidebarState)
            || values.contains(.sidebarWidth)
            || values.contains(.cameraPreset)
            || values.contains(.cameraHistory)
            || values.contains(.reduceMotion)
    }

    func encode(to encoder: Encoder) throws {
        var values = encoder.container(keyedBy: CodingKeys.self)
        try values.encode(Self.currentSchemaVersion, forKey: .schemaVersion)
        try values.encodeIfPresent(graphVersion, forKey: .graphVersion)
        try values.encodeIfPresent(selectedNodeID, forKey: .selectedNodeID)
        try values.encode(sourceLens, forKey: .sourceLens)
        try values.encodeIfPresent(focusDepth, forKey: .focusDepth)
        try values.encodeIfPresent(path, forKey: .path)
        try values.encodeIfPresent(communityID, forKey: .communityID)
        try values.encode(searchQuery, forKey: .searchQuery)
        try values.encodeIfPresent(cameraState, forKey: .cameraState)
        try values.encode(detailLevel, forKey: .detailLevel)
        try values.encode(detailReason, forKey: .detailReason)
        try values.encode(sidebarState, forKey: .sidebarState)
        try values.encodeIfPresent(sidebarWidth, forKey: .sidebarWidth)
        try values.encode(cameraPreset, forKey: .cameraPreset)
        try values.encode(cameraHistory, forKey: .cameraHistory)
        try values.encode(reduceMotion, forKey: .reduceMotion)
    }

    var normalized: GraphSessionState {
        var state = self
        state.schemaVersion = Self.currentSchemaVersion
        state.selectedNodeID = state.selectedNodeID?.nilIfEmpty
        state.focusDepth = state.focusDepth.map { min(max($0, 1), 3) }
        if let path = state.path {
            if let source = path.sourceNodeID.nilIfEmpty {
                let variant = path.variant.trimmingCharacters(in: .whitespacesAndNewlines)
                state.path = GraphPathContext(
                    sourceNodeID: source,
                    targetNodeID: path.targetNodeID?.nilIfEmpty,
                    variant: variant.isEmpty ? "shortest" : variant
                )
            } else {
                state.path = nil
            }
        }
        state.communityID = state.communityID?.nilIfEmpty
        state.cameraState = state.cameraState?.normalized
        if state.sidebarState == .docked {
            let width = state.sidebarWidth?.isFinite == true ? state.sidebarWidth! : Self.defaultDockedSidebarWidth
            state.sidebarWidth = max(width, Self.minimumDockedSidebarWidth)
        } else {
            state.sidebarWidth = nil
        }
        state.cameraHistory = Self.compactCameraHistory(state.cameraHistory)
        state.schemaVersion = Self.currentSchemaVersion
        return state
    }

    private static func compactCameraHistory(_ history: [GraphCameraHistoryEntry]) -> [GraphCameraHistoryEntry] {
        let candidates = Array(history.map(\.normalized).suffix(maximumCameraHistoryEntries))
        var retained: [GraphCameraHistoryEntry] = []
        for entry in candidates.reversed() {
            let proposal = [entry] + retained
            guard historyFitsSerializedBudget(proposal) else {
                continue
            }
            retained = proposal
        }
        return retained
    }

    private static func historyFitsSerializedBudget(_ history: [GraphCameraHistoryEntry]) -> Bool {
        guard let data = try? JSONEncoder().encode(history) else {
            return false
        }
        return data.count <= maximumCameraHistorySerializedBytes
    }

    func preservingThreeDPresentation(from previous: GraphSessionState) -> GraphSessionState {
        guard !includesThreeDPresentationState else {
            return normalized
        }
        var state = self
        state.detailLevel = previous.detailLevel
        state.detailReason = previous.detailReason
        state.sidebarState = previous.sidebarState
        state.sidebarWidth = previous.sidebarWidth
        state.cameraPreset = previous.cameraPreset
        state.cameraHistory = previous.cameraHistory
        state.reduceMotion = previous.reduceMotion
        state.includesThreeDPresentationState = true
        return state.normalized
    }
}

private extension String {
    var nilIfEmpty: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : self
    }
}

enum GraphRendererKind: Hashable, Sendable {
    case twoD
    case threeD
}

enum GraphSurfaceKind: Hashable, Sendable {
    case popover
    case focus
}

enum GraphLoadFailure: Equatable, Sendable {
    case navigationFailed
    case rendererFailed
    case twoDRuntimeUnavailable
    case validation(GraphDataValidationCode)
}

enum GraphLoadState: Equatable, Sendable {
    case idle
    case loading(attempt: Int, previousReadyAttempt: Int?)
    case ready(attempt: Int)
    case stale(readyAttempt: Int, availableAttempt: Int)
    case failed(attempt: Int, reason: GraphLoadFailure, previousReadyAttempt: Int?)
    case cancelled(attempt: Int, previousReadyAttempt: Int?)
}

enum GraphRendererLoadEvent: Equatable, Sendable {
    case loading
    case ready
    case failed(GraphLoadFailure)
}

private struct GraphLoadKey: Hashable, Sendable {
    let renderer: GraphRendererKind
    let surface: GraphSurfaceKind
}

struct GraphLoadCancellationRequest: Equatable, Sendable {
    let id: Int
    let attempt: Int
}

enum GraphViewportCommandKind: String, Sendable {
    case fit
    case zoomIn
    case zoomOut
    case topView
    case resetTilt
    case graphHealth
    case revealNode3D
    case pathFromNode3D
    case showCommunity3D
    case setDetailLevel
    case setSidebarState
    case setCameraPreset
    case cameraBack
    case setReduceMotion
}

struct GraphViewportCommand: Equatable, Sendable {
    let id: Int
    let kind: GraphViewportCommandKind
    let payload: String?
}

struct GraphChangeRadarInboxItem: Identifiable, Equatable, Sendable {
    enum Kind: String, Equatable, Sendable {
        case node
        case edge
        case activity
        case pendingPath
    }

    let id: String
    let kind: Kind
    let title: String
    let detail: String
    let nodeID: String?
    let compareEvidence: String
}

final class GraphChangeRadarAttemptGate: @unchecked Sendable {
    // The lock protects only the monotonic attempt token. Claims never cover Radar persistence.
    private let lock = NSLock()
    private var currentToken = 0

    func begin() -> Int {
        lock.lock()
        defer { lock.unlock() }
        currentToken += 1
        return currentToken
    }

    func claimIfCurrent(_ token: Int) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return currentToken == token
    }
}

@MainActor
@Observable
final class AppModel {
    var config: BrainBarConfig
    var status: VaultStatus = .empty
    var lastBrainCheck: CommandResult?
    var lastGraphRefresh: CommandResult?
    var isRefreshingGraph = false
    var isRunningBrainCheck = false
    var errorMessage: String?
    var graphReloadToken = 0
    private var graphLoadStates: [GraphLoadKey: GraphLoadState] = [:]
    private var graphLoadCancellationRequests: [GraphLoadKey: GraphLoadCancellationRequest] = [:]
    var graphSourceLens: GraphSourceLens = .all
    var graphViewMode: GraphViewMode = .threeD
    var graphSessionState = GraphSessionState()
    var savedGraphViews: [SavedGraphView] = []
    var graph3DResetToken = 0
    var graphViewportCommand: GraphViewportCommand?
    var reviewQueueStatus: ReviewQueueStatus = .empty
    var isCheckingReviewQueue = false
    var isRunningReviewQueueAction = false
    var lastReviewQueueAction: CommandResult?
    var agentActivitySnapshot: AgentActivitySnapshot = .empty
    /// A workflow highlight is an additive renderer overlay; graph session state stays untouched.
    var selectedAgentActivityWorkflowID: String?
    var lastAgentActivityActionMessage: String?
    var graphChangeRadarSnapshots: [GraphChangeRadarSnapshot] = []
    var latestGraphChangeRadarDiff: GraphChangeRadarDiff = .empty
    var graphChangeRadarInbox: [GraphChangeRadarInboxItem] = []
    var graphChangeRadarRetentionOverflow = false
    var expandedGraphChangeRadarInboxItemIDs: Set<String> = []
    @ObservationIgnored private var graphChangeRadarLatestInboxItemCount = 0

    @ObservationIgnored private let configurationManager: ConfigurationManager
    @ObservationIgnored private let commandRunner: CommandRunner
    @ObservationIgnored private let vaultStatusService: VaultStatusService
    @ObservationIgnored private let setupDoctorService: SetupDoctorService
    @ObservationIgnored private let savedGraphViewStore: SavedGraphViewStore
    @ObservationIgnored let graphDataStore: GraphDataStore
    @ObservationIgnored private let radarGraphDataStore: GraphDataStore
    @ObservationIgnored private let graphServerController: GraphServerController
    @ObservationIgnored private let notificationService: NotificationService
    @ObservationIgnored private let reviewQueueService: ReviewQueueService
    @ObservationIgnored private let agentActivityService: AgentActivityService
    @ObservationIgnored private let graphChangeRadarService: GraphChangeRadarService
    @ObservationIgnored private let graphChangeRadarPreClaimHook: @Sendable () async -> Void
    @ObservationIgnored private let agentActivityCodexInstaller: AgentActivityCodexInstaller
    @ObservationIgnored private let agentActivityClaudeInstaller: AgentActivityClaudeInstaller
    @ObservationIgnored private var nextGraphViewportCommandID = 0
    @ObservationIgnored private var nextGraphLoadCancellationID = 0
    @ObservationIgnored private var handledTwoDRuntimeRecoveryAttempts: [GraphLoadKey: Int] = [:]
    @ObservationIgnored private var reviewQueueWatcherTask: Task<Void, Never>?
    @ObservationIgnored private var graphRefreshAttempt = 0
    @ObservationIgnored private let graphChangeRadarAttemptGate = GraphChangeRadarAttemptGate()
    @ObservationIgnored private var dismissedGraphChangeRadarInboxItemIDs: Set<String> = []

    var configPath: String {
        configurationManager.configURL.path
    }

    var graphServerRunning: Bool {
        graphServerController.isRunning
    }

    var graphServerURL: URL? {
        graphServerController.graphURL(for: config)
    }

    var graphFileURL: URL? {
        guard let vaultURL = vaultStatusService.vaultURL(for: config) else {
            return nil
        }
        return vaultStatusService.resolvedURL(config.graphHtmlRelativePath, in: vaultURL)
    }

    var graphReadAccessURL: URL? {
        graphFileURL?.deletingLastPathComponent()
    }

    var graphRefreshSummary: String {
        if isRefreshingGraph {
            return "Refreshing Graph..."
        }
        if let lastGraphRefresh {
            return lastGraphRefresh.summary
        }
        if let modifiedAt = status.graphOutputModifiedAt {
            return "Graph updated \(modifiedAt.formattedRelative)"
        }
        return status.graphOutputExists ? "Graph ready" : "Graphify not run"
    }

    var graphChangeRadarSummary: String {
        let count = graphChangeRadarInbox.count
        guard !graphChangeRadarSnapshots.isEmpty else { return "No refresh history" }
        if count == 0 {
            return graphChangeRadarLatestInboxItemCount == 0 ? "No changes in latest refresh" : "All changes dismissed"
        }
        return count == 1 ? "1 change in latest refresh" : "\(count) changes in latest refresh"
    }

    var graphChangeRadarEmptyStateMessage: String? {
        guard graphChangeRadarInbox.isEmpty else { return nil }
        guard !graphChangeRadarSnapshots.isEmpty else {
            return "Refresh Graph to capture a validated before/after snapshot."
        }
        return graphChangeRadarLatestInboxItemCount == 0
            ? "No changes detected in the latest refresh."
            : "All latest items were dismissed."
    }

    init(
        configurationManager: ConfigurationManager = ConfigurationManager(),
        commandRunner: CommandRunner = CommandRunner(),
        vaultStatusService: VaultStatusService = VaultStatusService(),
        graphDataStore: GraphDataStore = GraphDataStore(),
        radarGraphDataStore: GraphDataStore = GraphDataStore(),
        graphServerController: GraphServerController = GraphServerController(),
        notificationService: NotificationService = NotificationService(),
        reviewQueueService: ReviewQueueService = ReviewQueueService(),
        agentActivityService: AgentActivityService = AgentActivityService(),
        graphChangeRadarService: GraphChangeRadarService = GraphChangeRadarService(),
        graphChangeRadarPreClaimHook: @escaping @Sendable () async -> Void = {},
        agentActivityCodexInstaller: AgentActivityCodexInstaller = AgentActivityCodexInstaller(),
        agentActivityClaudeInstaller: AgentActivityClaudeInstaller = AgentActivityClaudeInstaller(),
        setupDoctorService: SetupDoctorService = SetupDoctorService(),
        savedGraphViewStore: SavedGraphViewStore = SavedGraphViewStore()
    ) {
        self.configurationManager = configurationManager
        self.commandRunner = commandRunner
        self.vaultStatusService = vaultStatusService
        self.setupDoctorService = setupDoctorService
        self.savedGraphViewStore = savedGraphViewStore
        self.graphDataStore = graphDataStore
        self.radarGraphDataStore = radarGraphDataStore
        self.graphServerController = graphServerController
        self.notificationService = notificationService
        self.reviewQueueService = reviewQueueService
        self.agentActivityService = agentActivityService
        self.graphChangeRadarService = graphChangeRadarService
        self.graphChangeRadarPreClaimHook = graphChangeRadarPreClaimHook
        self.agentActivityCodexInstaller = agentActivityCodexInstaller
        self.agentActivityClaudeInstaller = agentActivityClaudeInstaller
        self.config = (try? configurationManager.loadOrCreate()) ?? .default
        updateReviewQueueWatcher()
        updateAgentActivityService()
    }

    deinit {
        reviewQueueWatcherTask?.cancel()
    }

    func refreshStatus(graphRefreshAttempt: Int? = nil) async {
        let previousGraphVersion = status.graphOutputModifiedAt
        let nextStatus = await vaultStatusService.status(for: config)
        guard graphRefreshAttempt == nil || graphRefreshAttempt == self.graphRefreshAttempt else {
            return
        }
        status = nextStatus
        graphSessionState.graphVersion = nextStatus.graphOutputModifiedAt.map {
            String(format: "%.6f", $0.timeIntervalSince1970)
        }
        if nextStatus.graphOutputModifiedAt != previousGraphVersion {
            agentActivityService.refreshGraphIndex(graphReadAccessURL: graphReadAccessURL)
            requestGraphReload()
        }
        errorMessage = nil
    }

    func reloadGraphView() {
        requestGraphReload()
        errorMessage = nil
    }

    func retryGraphLoad() {
        requestGraphReload()
        errorMessage = nil
    }

    func graphLoadState(
        for renderer: GraphRendererKind,
        surface: GraphSurfaceKind = .focus
    ) -> GraphLoadState {
        graphLoadStates[GraphLoadKey(renderer: renderer, surface: surface)] ?? .idle
    }

    func graphLoadCancellationRequest(
        for renderer: GraphRendererKind,
        surface: GraphSurfaceKind = .focus
    ) -> GraphLoadCancellationRequest? {
        graphLoadCancellationRequests[GraphLoadKey(renderer: renderer, surface: surface)]
    }

    func cancelGraphLoad(
        renderer: GraphRendererKind,
        surface: GraphSurfaceKind = .focus
    ) {
        let key = GraphLoadKey(renderer: renderer, surface: surface)
        guard case .loading(let attempt, let previousReadyAttempt) = graphLoadStates[key],
              attempt == graphReloadToken else {
            return
        }
        nextGraphLoadCancellationID += 1
        graphLoadCancellationRequests[key] = GraphLoadCancellationRequest(
            id: nextGraphLoadCancellationID,
            attempt: attempt
        )
        graphLoadStates[key] = .cancelled(
            attempt: attempt,
            previousReadyAttempt: previousReadyAttempt
        )
    }

    func handleGraphRendererLoadEvent(
        _ event: GraphRendererLoadEvent,
        renderer: GraphRendererKind,
        surface: GraphSurfaceKind = .focus,
        attempt: Int,
        threeDRendererAvailable: Bool = false
    ) {
        guard attempt == graphReloadToken else {
            return
        }

        let currentState = graphLoadState(for: renderer, surface: surface)
        if case .cancelled(let cancelledAttempt, _) = currentState, cancelledAttempt == attempt {
            return
        }
        let previousReadyAttempt = readyAttempt(in: currentState)
        let nextState: GraphLoadState
        switch event {
        case .loading:
            nextState = .loading(attempt: attempt, previousReadyAttempt: previousReadyAttempt)
        case .ready:
            nextState = .ready(attempt: attempt)
        case .failed(let reason):
            nextState = .failed(
                attempt: attempt,
                reason: reason,
                previousReadyAttempt: previousReadyAttempt
            )
        }
        setGraphLoadState(nextState, for: renderer, surface: surface)

        if case .failed(.twoDRuntimeUnavailable) = event {
            recoverFromTwoDRuntimeFailureIfPossible(
                renderer: renderer,
                surface: surface,
                attempt: attempt,
                threeDRendererAvailable: threeDRendererAvailable
            )
        }
    }

    func setGraphSourceLens(_ lens: GraphSourceLens) {
        graphSourceLens = lens
        graphSessionState.sourceLens = lens
        errorMessage = nil
    }

    func setGraphViewMode(_ mode: GraphViewMode) {
        graphViewMode = mode
        if mode == .twoD, graphSessionState.path != nil {
            errorMessage = "The 2D Workbench cannot draw the active 3D path. BrainBar kept its endpoints and variant for your return to 3D."
        } else {
            errorMessage = nil
        }
    }

    func updateGraphSessionState(_ nextState: GraphSessionState) {
        guard nextState.schemaVersion == GraphSessionState.currentSchemaVersion else {
            return
        }
        let normalized = nextState.normalized
        graphSessionState = normalized
        graphSourceLens = normalized.sourceLens
    }

    func updateGraphSessionStateFromRenderer(_ nextState: GraphSessionState) {
        guard nextState.schemaVersion == GraphSessionState.currentSchemaVersion else {
            return
        }
        let normalized = nextState
            .preservingThreeDPresentation(from: graphSessionState)
            .normalized
        graphSessionState = normalized
        graphSourceLens = normalized.sourceLens
    }

    func loadSavedGraphViews() async {
        do {
            savedGraphViews = try await savedGraphViewStore.load()
        } catch {
            errorMessage = "Saved views could not be loaded."
        }
    }

    func saveCurrentGraphView(named name: String) async {
        let view = SavedGraphView(
            id: UUID(),
            name: name,
            createdAt: Date(),
            mode: graphViewMode,
            session: graphSessionState
        )
        guard view.normalized != nil else {
            errorMessage = "Enter a name for the saved view."
            return
        }
        do {
            savedGraphViews = try await savedGraphViewStore.save(view)
            errorMessage = nil
        } catch {
            errorMessage = "The graph view could not be saved."
        }
    }

    func applySavedGraphView(_ view: SavedGraphView) {
        guard let normalized = view.normalized else {
            return
        }
        graphViewMode = normalized.mode
        updateGraphSessionState(normalized.session)
        errorMessage = nil
    }

    func deleteSavedGraphView(_ view: SavedGraphView) async {
        do {
            savedGraphViews = try await savedGraphViewStore.delete(id: view.id)
            errorMessage = nil
        } catch {
            errorMessage = "The saved view could not be deleted."
        }
    }

    func resetGraph3DCamera() {
        graph3DResetToken += 1
        graphSessionState.cameraPreset = .overview
        sendGraphViewportCommand(.topView)
    }

    func resetGraph3DTilt() {
        sendGraphViewportCommand(.resetTilt)
    }

    func fitGraphView() {
        sendGraphViewportCommand(.fit)
    }

    func zoomGraphIn() {
        sendGraphViewportCommand(.zoomIn)
    }

    func zoomGraphOut() {
        sendGraphViewportCommand(.zoomOut)
    }

    func setGraphDetailLevel(_ level: GraphDetailLevel, reason: GraphDetailReason = .user) {
        graphSessionState.detailLevel = level
        graphSessionState.detailReason = reason
        sendGraphViewportCommand(.setDetailLevel, payload: level.rawValue)
    }

    func setGraphSidebarState(_ state: GraphSidebarState, width: Double? = nil) {
        graphSessionState.sidebarState = state
        graphSessionState.sidebarWidth = width
        graphSessionState = graphSessionState.normalized
        sendGraphViewportCommand(.setSidebarState, payload: state.rawValue)
    }

    func setGraphCameraPreset(_ preset: GraphCameraPreset) {
        graphSessionState.cameraPreset = preset
        sendGraphViewportCommand(.setCameraPreset, payload: preset.rawValue)
    }

    func navigateGraphCameraBack() {
        sendGraphViewportCommand(.cameraBack)
    }

    func setGraphReduceMotion(_ enabled: Bool) {
        graphSessionState.reduceMotion = enabled
        sendGraphViewportCommand(.setReduceMotion, payload: enabled ? "true" : "false")
    }

    func showGraphHealth() {
        guard status.graphOutputExists else {
            errorMessage = "Graph Check requires Graphify output. Generate the graph before opening Graph Check."
            return
        }
        sendGraphViewportCommand(.graphHealth)
    }

    func reportGraphRendererIssue(_ message: String) {
        guard !message.isEmpty else {
            return
        }
        errorMessage = "3D graph issue: \(message)"
    }

    private func sendGraphViewportCommand(_ kind: GraphViewportCommandKind, payload: String? = nil) {
        nextGraphViewportCommandID += 1
        graphViewportCommand = GraphViewportCommand(id: nextGraphViewportCommandID, kind: kind, payload: payload)
        errorMessage = nil
    }

    @discardableResult
    func saveConfig(_ newConfig: BrainBarConfig) -> Bool {
        do {
            let normalizedConfig = newConfig.normalized()
            try configurationManager.save(normalizedConfig)
            config = normalizedConfig
            requestGraphReload()
            errorMessage = nil
            updateReviewQueueWatcher()
            updateAgentActivityService()
            Task {
                await refreshStatus()
            }
            return true
        } catch {
            errorMessage = error.localizedDescription
            return false
        }
    }

    func inspectSetup(for newConfig: BrainBarConfig) async -> SetupDoctorReport {
        await setupDoctorService.inspect(
            config: newConfig.normalized(),
            lastGraphRefresh: lastGraphRefresh
        )
    }

    func validateAndSaveConfig(_ newConfig: BrainBarConfig) async -> SetupDoctorSaveResult {
        let normalizedConfig = newConfig.normalized()
        let report = await inspectSetup(for: normalizedConfig)
        guard report.canSave else {
            errorMessage = report.findings.first(where: \.blocksSaving)?.remediation
            return SetupDoctorSaveResult(report: report, saved: false)
        }
        return SetupDoctorSaveResult(report: report, saved: saveConfig(normalizedConfig))
    }

    func openVault() {
        performOpen {
            try vaultStatusService.openVault(config)
        }
    }

    func openProjectDashboard() {
        performOpen {
            try vaultStatusService.openRelativeFile(config.projectDashboardRelativePath, config: config)
        }
    }

    func openGraphifyReport() {
        performOpen {
            try vaultStatusService.openRelativeFile(config.graphReportRelativePath, config: config)
        }
    }

    func openGraph() {
        if graphServerRunning, let url = graphServerURL {
            NSWorkspace.shared.open(url)
            return
        }
        performOpen {
            try vaultStatusService.openRelativeFile(config.graphHtmlRelativePath, config: config)
        }
    }

    func openGraphNode(_ request: GraphNodeOpenRequest) {
        switch request.action {
        case "revealIn3D":
            graphSessionState.selectedNodeID = request.nodeId
            graphViewMode = .threeD
            sendGraphViewportCommand(.revealNode3D, payload: request.nodeId)
            return
        case "pathFromNodeIn3D":
            graphSessionState.selectedNodeID = request.nodeId
            graphSessionState.path = GraphPathContext(
                sourceNodeID: request.nodeId,
                targetNodeID: request.targetNodeId,
                variant: "shortest"
            )
            graphViewMode = .threeD
            sendGraphViewportCommand(.pathFromNode3D, payload: graphPathBridgePayload(sourceId: request.nodeId, targetId: request.targetNodeId))
            return
        case "showCommunityIn3D":
            graphSessionState.communityID = request.communityId
            graphViewMode = .threeD
            sendGraphViewportCommand(.showCommunity3D, payload: request.communityId)
            return
        default:
            break
        }
        performOpen {
            try vaultStatusService.openGraphNodeSource(request.sourceFile, config: config)
        }
    }

    private func graphPathBridgePayload(sourceId: String, targetId: String?) -> String {
        guard let targetId, !targetId.isEmpty else {
            return sourceId
        }
        let payload = [
            "sourceId": sourceId,
            "targetId": targetId
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else {
            return sourceId
        }
        return json
    }

    func loadGraphChangeRadar() async {
        let snapshots = await graphChangeRadarService.snapshots()
        let latest = await graphChangeRadarService.latestSnapshotAndDiff()
        let retentionOverflow = await graphChangeRadarService.retentionOverflow()
        graphChangeRadarSnapshots = snapshots
        graphChangeRadarRetentionOverflow = retentionOverflow
        latestGraphChangeRadarDiff = latest.diff
        rebuildGraphChangeRadarInbox()
    }

    func clearGraphChangeRadar() async {
        await graphChangeRadarService.clear()
        graphChangeRadarSnapshots = []
        latestGraphChangeRadarDiff = .empty
        graphChangeRadarInbox = []
        graphChangeRadarRetentionOverflow = false
        expandedGraphChangeRadarInboxItemIDs = []
        dismissedGraphChangeRadarInboxItemIDs = []
        graphChangeRadarLatestInboxItemCount = 0
    }

    func dismissGraphChangeRadarInboxItem(_ item: GraphChangeRadarInboxItem) {
        dismissedGraphChangeRadarInboxItemIDs.insert(item.id)
        expandedGraphChangeRadarInboxItemIDs.remove(item.id)
        rebuildGraphChangeRadarInbox()
    }

    func revealGraphChangeRadarInboxItem(_ item: GraphChangeRadarInboxItem) {
        guard let nodeID = item.nodeID else { return }
        graphSessionState.selectedNodeID = nodeID
        graphViewMode = .threeD
        sendGraphViewportCommand(.revealNode3D, payload: nodeID)
    }

    func focusGraphChangeRadarInboxItem(_ item: GraphChangeRadarInboxItem) {
        guard let nodeID = item.nodeID else { return }
        graphSessionState.selectedNodeID = nodeID
        graphSessionState.focusDepth = min(max(graphSessionState.focusDepth ?? 1, 1), 3)
        graphViewMode = .threeD
        sendGraphViewportCommand(.revealNode3D, payload: nodeID)
    }

    func compareGraphChangeRadarInboxItem(_ item: GraphChangeRadarInboxItem) {
        expandedGraphChangeRadarInboxItemIDs.insert(item.id)
    }

    func refreshGraph(openAfterSuccess: Bool = false) async {
        graphRefreshAttempt += 1
        let refreshAttempt = graphRefreshAttempt
        let radarAttemptToken = graphChangeRadarAttemptGate.begin()

        guard let vaultURL = vaultStatusService.vaultURL(for: config) else {
            isRefreshingGraph = false
            errorMessage = BrainBarError.vaultNotConfigured.localizedDescription
            return
        }

        isRefreshingGraph = true
        defer {
            if refreshAttempt == graphRefreshAttempt {
                isRefreshingGraph = false
            }
        }

        do {
            let result = try await commandRunner.run(config.commands.refreshGraph, name: "Refresh Graph", vaultURL: vaultURL)
            guard refreshAttempt == graphRefreshAttempt else { return }
            lastGraphRefresh = result
            errorMessage = result.succeeded ? nil : result.summary
            await notificationService.notifyIfEnabled(
                title: "Graph refresh finished",
                body: result.summary,
                enabled: config.notificationsEnabled
            )
            guard refreshAttempt == graphRefreshAttempt else { return }
            guard result.succeeded else {
                await refreshStatus(graphRefreshAttempt: refreshAttempt)
                return
            }
            guard let graphJSONURL = graphReadAccessURL?.appendingPathComponent("graph.json"),
                  FileManager.default.fileExists(atPath: graphJSONURL.path)
            else {
                await refreshStatus(graphRefreshAttempt: refreshAttempt)
                return
            }

            let persistedSnapshots = await graphChangeRadarService.snapshots()
            guard refreshAttempt == graphRefreshAttempt else { return }
            let previousCursor = persistedSnapshots.last?.activityCursor
            let upperCursor = agentActivityService.captureHistoryCursor()
            let prepared = await radarGraphDataStore.prepare(url: graphJSONURL, policy: .retry)
            guard refreshAttempt == graphRefreshAttempt else { return }
            guard case .ready(let handle) = prepared else {
                await refreshStatus(graphRefreshAttempt: refreshAttempt)
                return
            }
            let seed = await radarGraphDataStore.radarSeed(for: handle)
            guard refreshAttempt == graphRefreshAttempt else { return }
            guard let seed else {
                await refreshStatus(graphRefreshAttempt: refreshAttempt)
                return
            }

            let nodeIDs = Set(seed.nodes.map(\.id))
            let sourcePaths = Set(seed.nodes.compactMap(\.sourcePath))
            let matchingHistory = agentActivityService.history(
                afterExclusive: previousCursor,
                throughInclusive: upperCursor,
                matchingNodeIDs: nodeIDs,
                matchingRelativePaths: sourcePaths
            )
            let intervalHistory = agentActivityService.history(
                afterExclusive: previousCursor,
                throughInclusive: upperCursor,
                matchingNodeIDs: [],
                matchingRelativePaths: []
            )
            let nodesByID = Dictionary(uniqueKeysWithValues: seed.nodes.map { ($0.id, $0) })
            let nodesByPath = Dictionary(seed.nodes.compactMap { node in
                node.sourcePath.map { ($0, node) }
            }, uniquingKeysWith: { first, _ in first })
            let records = matchingHistory.map { record -> GraphChangeRadarActivityRecord in
                let node = record.nodeId.flatMap { nodesByID[$0] } ?? nodesByPath[record.relativePath]
                return GraphChangeRadarActivityRecord(
                    id: record.id,
                    action: record.action,
                    agent: record.agent,
                    timestamp: record.timestamp,
                    relativePath: record.relativePath,
                    nodeID: node?.id,
                    status: node?.status,
                    category: node?.category
                )
            }
            let pendingPaths = Set(intervalHistory.compactMap { record -> String? in
                guard !nodeIDs.contains(record.nodeId ?? ""), !sourcePaths.contains(record.relativePath) else {
                    return nil
                }
                return record.relativePath
            }).sorted()
            let activityWindow = GraphChangeRadarActivityWindow(
                cursor: upperCursor,
                records: records,
                pendingRelativePaths: pendingPaths
            )
            guard refreshAttempt == graphRefreshAttempt else { return }
            guard let append = try? await graphChangeRadarService.appendIfCurrent(
                validatedHandle: handle,
                seed: seed,
                activityWindow: activityWindow,
                beforeCurrentClaim: graphChangeRadarPreClaimHook,
                currentAttemptIsCurrent: { [graphChangeRadarAttemptGate] in
                    graphChangeRadarAttemptGate.claimIfCurrent(radarAttemptToken)
                }
            ) else {
                await refreshStatus(graphRefreshAttempt: refreshAttempt)
                return
            }
            guard refreshAttempt == graphRefreshAttempt else { return }
            graphChangeRadarSnapshots = await graphChangeRadarService.snapshots()
            graphChangeRadarRetentionOverflow = await graphChangeRadarService.retentionOverflow()
            latestGraphChangeRadarDiff = append.diff
            dismissedGraphChangeRadarInboxItemIDs = []
            expandedGraphChangeRadarInboxItemIDs = []
            rebuildGraphChangeRadarInbox()
            await refreshStatus(graphRefreshAttempt: refreshAttempt)
            guard refreshAttempt == graphRefreshAttempt else { return }
            agentActivityService.refreshGraphIndex(graphReadAccessURL: graphReadAccessURL)
            if openAfterSuccess {
                requestGraphReload()
            }
        } catch {
            guard refreshAttempt == graphRefreshAttempt else { return }
            let commandError = error.localizedDescription
            await refreshStatus(graphRefreshAttempt: refreshAttempt)
            guard refreshAttempt == graphRefreshAttempt else { return }
            errorMessage = commandError
        }
    }

    func runBrainCheck() async {
        guard let command = config.commands.brainCheck else {
            errorMessage = BrainBarError.commandNotConfigured("Brain check").localizedDescription
            return
        }
        guard let vaultURL = vaultStatusService.vaultURL(for: config) else {
            errorMessage = BrainBarError.vaultNotConfigured.localizedDescription
            return
        }

        isRunningBrainCheck = true
        defer { isRunningBrainCheck = false }

        do {
            let result = try await commandRunner.run(command, name: "Brain Check", vaultURL: vaultURL)
            lastBrainCheck = result
            errorMessage = result.succeeded ? nil : result.summary
            await notificationService.notifyIfEnabled(
                title: "Brain check finished",
                body: result.summary,
                enabled: config.notificationsEnabled
            )
            await refreshStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func refreshReviewQueueStatus() async {
        guard config.reviewQueue.isEnabled else {
            reviewQueueStatus = .empty
            return
        }
        guard !isCheckingReviewQueue else {
            return
        }

        isCheckingReviewQueue = true
        defer { isCheckingReviewQueue = false }

        let vaultURL = vaultStatusService.vaultURL(for: config)
        reviewQueueStatus = await reviewQueueService.check(config: config.reviewQueue.normalized, vaultURL: vaultURL)
    }

    func runReviewQueueAction() async {
        guard config.reviewQueue.isEnabled else {
            return
        }
        guard !isRunningReviewQueueAction else {
            return
        }

        isRunningReviewQueueAction = true
        defer { isRunningReviewQueueAction = false }

        let vaultURL = vaultStatusService.vaultURL(for: config)
        do {
            let result = try await reviewQueueService.runManual(config: config.reviewQueue.normalized, vaultURL: vaultURL)
            lastReviewQueueAction = result
            errorMessage = result.succeeded ? nil : result.summary
            await refreshReviewQueueStatus()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startOrStopGraphServer() async {
        if graphServerRunning {
            graphServerController.stop()
            return
        }

        guard let vaultURL = vaultStatusService.vaultURL(for: config) else {
            errorMessage = BrainBarError.vaultNotConfigured.localizedDescription
            return
        }

        do {
            try await graphServerController.start(vaultURL: vaultURL, port: config.serverPort)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func installCodexAgentActivityIntegration() {
        do {
            let status = try agentActivityCodexInstaller.install()
            lastAgentActivityActionMessage = status.message
            updateAgentActivityService()
            errorMessage = status == .installed ? nil : status.message
        } catch {
            lastAgentActivityActionMessage = error.localizedDescription
            errorMessage = error.localizedDescription
        }
    }

    func installClaudeAgentActivityIntegration() {
        do {
            let status = try agentActivityClaudeInstaller.install()
            lastAgentActivityActionMessage = status.message
            updateAgentActivityService()
            errorMessage = status == .installed || status == .partial ? nil : status.message
        } catch {
            lastAgentActivityActionMessage = error.localizedDescription
            errorMessage = error.localizedDescription
        }
    }

    func writeAgentActivityTestEvent() {
        do {
            try agentActivityService.writeTestEvent()
            lastAgentActivityActionMessage = "Test event written"
            errorMessage = nil
        } catch {
            lastAgentActivityActionMessage = error.localizedDescription
            errorMessage = error.localizedDescription
        }
    }

    func clearAgentActivity() {
        agentActivityService.clearHistory()
        selectedAgentActivityWorkflowID = nil
        lastAgentActivityActionMessage = "Agent Activity and workflow-derived history cleared"
        errorMessage = nil
    }

    func selectAgentActivityWorkflow(_ workflow: AgentActivityWorkflow?) {
        selectedAgentActivityWorkflowID = workflow?.id
    }

    func openAgentActivityLog() {
        do {
            let url = AgentActivityPaths.defaultEventLogURL
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            if !FileManager.default.fileExists(atPath: url.path) {
                try Data().write(to: url)
            }
            NSWorkspace.shared.open(url)
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func performOpen(_ action: () throws -> Void) {
        do {
            try action()
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func requestGraphReload() {
        let availableAttempt = graphReloadToken + 1
        markReadyGraphLoadsStale(availableAttempt: availableAttempt)
        graphReloadToken = availableAttempt
    }

    private func markReadyGraphLoadsStale(availableAttempt: Int) {
        for (key, state) in graphLoadStates {
            guard case .ready(let readyAttempt) = state else {
                continue
            }
            graphLoadStates[key] = .stale(readyAttempt: readyAttempt, availableAttempt: availableAttempt)
        }
    }

    private func readyAttempt(in state: GraphLoadState) -> Int? {
        switch state {
        case .idle:
            nil
        case .loading(_, let previousReadyAttempt),
             .failed(_, _, let previousReadyAttempt),
             .cancelled(_, let previousReadyAttempt):
            previousReadyAttempt
        case .ready(let attempt), .stale(let attempt, _):
            attempt
        }
    }

    private func setGraphLoadState(
        _ state: GraphLoadState,
        for renderer: GraphRendererKind,
        surface: GraphSurfaceKind
    ) {
        graphLoadStates[GraphLoadKey(renderer: renderer, surface: surface)] = state
    }

    private func recoverFromTwoDRuntimeFailureIfPossible(
        renderer: GraphRendererKind,
        surface: GraphSurfaceKind,
        attempt: Int,
        threeDRendererAvailable: Bool
    ) {
        guard renderer == .twoD,
              status.graphJSONExists,
              threeDRendererAvailable else {
            return
        }

        let key = GraphLoadKey(renderer: renderer, surface: surface)
        guard handledTwoDRuntimeRecoveryAttempts[key] != attempt else {
            return
        }
        handledTwoDRuntimeRecoveryAttempts[key] = attempt

        switch surface {
        case .focus:
            guard graphViewMode == .twoD else {
                return
            }
            graphViewMode = .threeD
            errorMessage = "The 2D graph needs the Vis runtime from the generated Graphify page. It wasn’t available, so BrainBar switched to the local 3D graph."
        case .popover:
            errorMessage = "The 2D graph needs the Vis runtime from the generated Graphify page. The popover can’t host the 3D renderer; open the Focus Window to use 3D."
        }
    }

    private func updateReviewQueueWatcher() {
        reviewQueueWatcherTask?.cancel()
        reviewQueueWatcherTask = nil

        let reviewConfig = config.reviewQueue.normalized
        guard reviewConfig.isEnabled,
              reviewConfig.backgroundWatcherEnabled,
              reviewConfig.preflightCommand != nil else {
            if !reviewConfig.isEnabled {
                reviewQueueStatus = .empty
            }
            return
        }

        reviewQueueWatcherTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refreshReviewQueueStatus()
                try? await Task.sleep(for: .seconds(reviewConfig.watcherIntervalSeconds))
            }
        }
    }

    private func updateAgentActivityService() {
        let vaultURL = vaultStatusService.vaultURL(for: config)
        agentActivityService.start(
            config: config.agentActivity.normalized,
            vaultURL: vaultURL,
            graphReadAccessURL: graphReadAccessURL
        ) { [weak self] snapshot in
            guard let self else { return }
            agentActivitySnapshot = snapshot
            if let selectedAgentActivityWorkflowID,
               !snapshot.workflows.contains(where: { $0.id == selectedAgentActivityWorkflowID }) {
                self.selectedAgentActivityWorkflowID = nil
            }
        }
    }

    private func rebuildGraphChangeRadarInbox() {
        guard let latest = graphChangeRadarSnapshots.last else {
            graphChangeRadarInbox = []
            graphChangeRadarLatestInboxItemCount = 0
            return
        }
        let previous = graphChangeRadarSnapshots.dropLast().last
        let latestNodes = Dictionary(uniqueKeysWithValues: latest.nodes.map { ($0.id, $0) })
        let previousNodes = Dictionary(uniqueKeysWithValues: (previous?.nodes ?? []).map { ($0.id, $0) })
        let latestEdges = Dictionary(uniqueKeysWithValues: latest.edges.map { ($0.identity, $0) })
        let previousEdges = Dictionary(uniqueKeysWithValues: (previous?.edges ?? []).map { ($0.identity, $0) })
        var items: [GraphChangeRadarInboxItem] = []

        func addNode(_ nodeID: String, title: String, evidence: String) {
            let node = latestNodes[nodeID] ?? previousNodes[nodeID]
            items.append(.init(
                id: "node:\(title):\(nodeID)",
                kind: .node,
                title: title,
                detail: node?.sourcePath ?? nodeID,
                nodeID: latestNodes[nodeID] == nil ? nil : nodeID,
                compareEvidence: evidence
            ))
        }

        func nodeEvidence(_ node: GraphChangeRadarNodeSnapshot?, fallback: String) -> String {
            guard let node else { return fallback }
            let fields = [node.sourcePath, node.status, node.category, node.community]
                .compactMap { $0?.isEmpty == false ? $0 : nil }
            return fields.isEmpty ? fallback : fields.joined(separator: " · ")
        }

        for nodeID in latestGraphChangeRadarDiff.addedNodeIDs {
            addNode(nodeID, title: "Node added", evidence: "Before: not in graph\nAfter: \(nodeEvidence(latestNodes[nodeID], fallback: nodeID))")
        }
        for nodeID in latestGraphChangeRadarDiff.removedNodeIDs {
            addNode(nodeID, title: "Node removed", evidence: "Before: \(nodeEvidence(previousNodes[nodeID], fallback: nodeID))\nAfter: not in graph")
        }
        for nodeID in latestGraphChangeRadarDiff.changedNodeIDs {
            addNode(nodeID, title: "Node changed", evidence: "Before: \(nodeEvidence(previousNodes[nodeID], fallback: nodeID))\nAfter: \(nodeEvidence(latestNodes[nodeID], fallback: nodeID))")
        }
        for edgeID in latestGraphChangeRadarDiff.addedEdgeIDs {
            let edge = latestEdges[edgeID]
            items.append(.init(id: "edge:added:\(edgeID)", kind: .edge, title: "Edge added", detail: edge.map { "\($0.source) → \($0.target)" } ?? edgeID, nodeID: edge?.source, compareEvidence: "Before: not in graph\nAfter: \(edgeID)"))
        }
        for edgeID in latestGraphChangeRadarDiff.removedEdgeIDs {
            let edge = previousEdges[edgeID]
            items.append(.init(id: "edge:removed:\(edgeID)", kind: .edge, title: "Edge removed", detail: edge.map { "\($0.source) → \($0.target)" } ?? edgeID, nodeID: nil, compareEvidence: "Before: \(edgeID)\nAfter: not in graph"))
        }
        for movement in latestGraphChangeRadarDiff.communityMovements {
            addNode(movement.nodeID, title: "Community moved", evidence: "Before: \(movement.from)\nAfter: \(movement.to)")
        }
        for nodeID in latestGraphChangeRadarDiff.newlyNeedsAttentionNodeIDs {
            addNode(nodeID, title: "Needs attention", evidence: "This node is newly marked as needing attention.")
        }
        for nodeID in latestGraphChangeRadarDiff.resolvedNeedsAttentionNodeIDs {
            addNode(nodeID, title: "Attention resolved", evidence: "This node is no longer marked as needing attention.")
        }
        for nodeID in latestGraphChangeRadarDiff.newlyOrphanedNodeIDs {
            addNode(nodeID, title: "Node became orphaned", evidence: "This node no longer has graph connections.")
        }
        for nodeID in latestGraphChangeRadarDiff.resolvedOrphanNodeIDs {
            addNode(nodeID, title: "Node reconnected", evidence: "This node is no longer orphaned.")
        }
        for link in latestGraphChangeRadarDiff.activityLinks {
            let nodeID = link.nodeID
            items.append(.init(
                id: "activity:\(link.record.id):\(nodeID ?? "none")",
                kind: .activity,
                title: link.relationship == .touched ? "Touched during interval" : "Activity during interval",
                detail: link.record.relativePath ?? link.record.id,
                nodeID: nodeID,
                compareEvidence: "Interval record: \(link.record.action.rawValue) by \(link.record.agent)"
            ))
        }
        for path in latest.pendingRelativePaths {
            items.append(.init(id: "pending:\(path)", kind: .pendingPath, title: "Pending path touched during interval", detail: path, nodeID: nil, compareEvidence: "This contained path did not map to a graph node in this refresh."))
        }
        for path in latestGraphChangeRadarDiff.resolvedPendingPaths {
            let node = latest.nodes.first { $0.sourcePath == path }
            items.append(.init(id: "resolved-pending:\(path)", kind: .pendingPath, title: "Pending path resolved", detail: path, nodeID: node?.id, compareEvidence: "This previously pending path now maps to the current graph."))
        }
        for nodeID in latestGraphChangeRadarDiff.resolvedPendingNodeIDs {
            addNode(nodeID, title: "Pending node resolved", evidence: "This node now resolves a path touched during an earlier interval.")
        }

        let currentItems = Array(items.prefix(24))
        graphChangeRadarLatestInboxItemCount = currentItems.count
        graphChangeRadarInbox = currentItems.filter {
            !dismissedGraphChangeRadarInboxItemIDs.contains($0.id)
        }
    }
}
