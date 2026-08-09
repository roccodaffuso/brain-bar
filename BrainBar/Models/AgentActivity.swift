import Foundation

enum AgentActivityAction: String, Codable, CaseIterable, Sendable {
    case read
    case write
    case create
    case delete
    case focus
    case open
    case graphRefresh = "graph_refresh"
    case closeout
    case decision
    case activity
}

enum AgentActivityPathRole: String, Codable, CaseIterable, Sendable {
    case source
    case output
}

struct AgentActivityEvent: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var version: Int
    var agent: String
    var action: AgentActivityAction
    var path: String
    var timestamp: Date
    var sessionId: String?
    var project: String?
    var source: String?
    var reason: String?
    var nodeId: String?
    var status: String?
    var workflowId: String?
    var workflowTitle: String?
    /// Only explicit schema-v2 values are retained. `nil` means touched, never inferred.
    var pathRole: AgentActivityPathRole?

    init(
        id: String = UUID().uuidString,
        version: Int = 2,
        agent: String,
        action: AgentActivityAction,
        path: String,
        timestamp: Date,
        sessionId: String? = nil,
        project: String? = nil,
        source: String? = nil,
        reason: String? = nil,
        nodeId: String? = nil,
        status: String? = nil,
        workflowId: String? = nil,
        workflowTitle: String? = nil,
        pathRole: AgentActivityPathRole? = nil
    ) {
        self.id = id
        self.version = version
        self.agent = agent
        self.action = action
        self.path = path
        self.timestamp = timestamp
        self.sessionId = sessionId
        self.project = project
        self.source = source
        self.reason = reason
        self.nodeId = nodeId
        self.status = status
        self.workflowId = workflowId
        self.workflowTitle = workflowTitle
        self.pathRole = pathRole
    }
}

struct AgentActivityMappedEvent: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var version: Int
    var action: AgentActivityAction
    var agent: String
    var path: String
    var timestamp: Date
    var nodeId: String?
    var label: String?
    var sourceFile: String?
    var pending: Bool
    var sessionId: String?
    var project: String?
    var source: String?
    var reason: String?
    var status: String?
    var workflowId: String?
    var workflowTitle: String?
    var pathRole: AgentActivityPathRole?

    init(event: AgentActivityEvent, node: AgentActivityGraphNode?) {
        id = event.id
        version = event.version
        action = event.action
        agent = event.agent
        path = event.path
        timestamp = event.timestamp
        nodeId = node?.id ?? event.nodeId
        label = node?.label
        sourceFile = node?.sourceFile
        pending = node == nil
        sessionId = event.sessionId
        project = event.project
        source = event.source
        reason = event.reason
        status = event.status
        workflowId = event.workflowId
        workflowTitle = event.workflowTitle
        pathRole = event.pathRole
    }
}

/// A stable boundary for consumers that build a derived view of local activity.
/// Sequence is assigned only after raw-event de-duplication.
struct AgentActivityCursor: Codable, Equatable, Sendable {
    var generation: UUID
    var ingestionSequence: UInt64

    init(generation: UUID, ingestionSequence: UInt64) {
        self.generation = generation
        self.ingestionSequence = ingestionSequence
    }
}

/// The content-free, vault-contained projection retained for Change Radar.
/// `relativePath` is never populated from an event that cannot be resolved inside
/// the configured vault root.
struct AgentActivityHistoryRecord: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var version: Int
    var agent: String
    var action: AgentActivityAction
    var relativePath: String
    var timestamp: Date
    var sessionId: String?
    var project: String?
    var source: String?
    var reason: String?
    var nodeId: String?
    var status: String?
    var workflowId: String?
    var workflowTitle: String?
    /// `nil` is a chronological touched-path entry, not an inferred role.
    var pathRole: AgentActivityPathRole?
    var ingestionSequence: UInt64
}

/// A derived, non-persistent workflow over retained vault-contained activity.
/// The title and status use the latest nonempty declaration by `(timestamp, event id,
/// value)` so conflicts resolve independently of ingestion order.
struct AgentActivityWorkflow: Codable, Equatable, Identifiable, Sendable {
    /// Namespaced stable identity: `workflow:<workflow_id>` or `session:<session_id>`.
    var id: String
    var workflowId: String?
    var sessionId: String?
    var title: String?
    var status: String?
    /// Ordered by timestamp then stable event identity.
    var trail: [AgentActivityHistoryRecord]
    var sourcePaths: [String]
    var outputPaths: [String]
    var touchedPaths: [String]
    /// Graph node IDs resolved from an explicit node id or retained relative path.
    var nodeIds: [String]
    /// Vault-relative retained paths that have no current graph-node mapping.
    var pendingPaths: [String]
    var firstEventAt: Date
    var lastEventAt: Date
}

enum AgentActivityPrivacyPreview {
    static let retainedFields = [
        "id", "version", "agent", "action", "relativePath", "timestamp",
        "sessionId", "project", "source", "reason", "nodeId", "status", "workflowId", "workflowTitle", "pathRole", "ingestionSequence"
    ]

    static let excludedContentDescription = "Excluded: note bodies, snippets, command output, prompts, credentials, and file contents. Metadata strings are supplied by local integrations."
}

struct AgentActivitySnapshot: Codable, Equatable, Sendable {
    var events: [AgentActivityMappedEvent]
    var nodeIds: [String]
    var pendingPaths: [String]
    var lastEventAt: Date?
    var eventLogPath: String
    var codexIntegrationInstalled: Bool
    var claudeIntegrationInstalled: Bool
    var claudeIntegrationPartial: Bool
    var tracingEnabled: Bool
    /// Workflow history shares Agent Activity retention and Clear.
    var workflowRetentionDays: Int
    /// The newest event schema this app emits and understands for workflow metadata.
    var eventSchemaVersion: Int
    var workflows: [AgentActivityWorkflow]

    init(
        events: [AgentActivityMappedEvent],
        nodeIds: [String],
        pendingPaths: [String],
        lastEventAt: Date?,
        eventLogPath: String,
        codexIntegrationInstalled: Bool,
        claudeIntegrationInstalled: Bool,
        claudeIntegrationPartial: Bool,
        tracingEnabled: Bool,
        workflowRetentionDays: Int = AgentActivityConfiguration.default.retentionDays,
        eventSchemaVersion: Int = 2,
        workflows: [AgentActivityWorkflow] = []
    ) {
        self.events = events
        self.nodeIds = nodeIds
        self.pendingPaths = pendingPaths
        self.lastEventAt = lastEventAt
        self.eventLogPath = eventLogPath
        self.codexIntegrationInstalled = codexIntegrationInstalled
        self.claudeIntegrationInstalled = claudeIntegrationInstalled
        self.claudeIntegrationPartial = claudeIntegrationPartial
        self.tracingEnabled = tracingEnabled
        self.workflowRetentionDays = workflowRetentionDays
        self.eventSchemaVersion = eventSchemaVersion
        self.workflows = workflows
    }

    static let empty = AgentActivitySnapshot(
        events: [],
        nodeIds: [],
        pendingPaths: [],
        lastEventAt: nil,
        eventLogPath: AgentActivityPaths.defaultEventLogURL.path,
        codexIntegrationInstalled: false,
        claudeIntegrationInstalled: false,
        claudeIntegrationPartial: false,
        tracingEnabled: false,
        workflowRetentionDays: AgentActivityConfiguration.default.retentionDays,
        eventSchemaVersion: 2,
        workflows: []
    )
}

struct AgentActivityGraphNode: Equatable, Sendable {
    var id: String
    var label: String
    var sourceFile: String?
}
