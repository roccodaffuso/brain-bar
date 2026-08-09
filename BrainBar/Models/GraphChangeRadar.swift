import Foundation

struct GraphChangeRadarSeed: Equatable, Sendable {
    struct Node: Equatable, Sendable {
        let id: String
        let contentHash: String
        let community: String
        let sourcePath: String?
        let status: String?
        let category: String?
        let hasExplicitAttention: Bool
    }

    struct Edge: Equatable, Sendable {
        let identity: String
        let source: String
        let target: String
    }

    let graphDigest: String
    let semanticFingerprint: String
    let nodes: [Node]
    let edges: [Edge]
}

/// Privacy-filtered local activity metadata. It intentionally has no reason, content, or raw path fields.
struct GraphChangeRadarActivityRecord: Codable, Equatable, Sendable {
    let id: String
    let action: AgentActivityAction
    let agent: String
    let timestamp: Date
    let relativePath: String?
    let nodeID: String?
    let status: String?
    let category: String?

    init(
        id: String,
        action: AgentActivityAction,
        agent: String,
        timestamp: Date,
        relativePath: String? = nil,
        nodeID: String? = nil,
        status: String? = nil,
        category: String? = nil
    ) {
        self.id = id
        self.action = action
        self.agent = agent
        self.timestamp = timestamp
        self.relativePath = relativePath
        self.nodeID = nodeID
        self.status = status
        self.category = category
    }
}

struct GraphChangeRadarActivityWindow: Equatable, Sendable {
    let cursor: AgentActivityCursor?
    let records: [GraphChangeRadarActivityRecord]
    let pendingRelativePaths: [String]

    init(
        cursor: AgentActivityCursor? = nil,
        records: [GraphChangeRadarActivityRecord] = [],
        pendingRelativePaths: [String] = []
    ) {
        self.cursor = cursor
        self.records = records
        self.pendingRelativePaths = pendingRelativePaths
    }
}

/// Context only: a link is temporal metadata or an exact touched-node/path match, never causality.
enum GraphChangeRadarActivityRelationship: String, Codable, Equatable, Sendable {
    case temporal
    case touched
}

struct GraphChangeRadarActivityLink: Codable, Equatable, Sendable {
    let record: GraphChangeRadarActivityRecord
    let nodeID: String?
    let relationship: GraphChangeRadarActivityRelationship
}

struct GraphChangeRadarNodeSnapshot: Codable, Equatable, Sendable {
    let id: String
    let contentHash: String
    let community: String
    let sourcePath: String?
    let status: String?
    let category: String?
    let isOrphan: Bool
    let needsAttention: Bool
}

struct GraphChangeRadarEdgeSnapshot: Codable, Equatable, Sendable {
    let identity: String
    let source: String
    let target: String
}

struct GraphChangeRadarSnapshot: Codable, Equatable, Sendable {
    let capturedAt: Date
    let graphDigest: String
    let semanticFingerprint: String
    let activityCursor: AgentActivityCursor?
    let activityRecords: [GraphChangeRadarActivityRecord]
    let pendingRelativePaths: [String]
    let nodes: [GraphChangeRadarNodeSnapshot]
    let edges: [GraphChangeRadarEdgeSnapshot]
}

struct GraphChangeRadarCommunityMovement: Equatable, Sendable {
    let nodeID: String
    let from: String
    let to: String
}

struct GraphChangeRadarDiff: Equatable, Sendable {
    let addedNodeIDs: [String]
    let removedNodeIDs: [String]
    let changedNodeIDs: [String]
    let addedEdgeIDs: [String]
    let removedEdgeIDs: [String]
    let communityMovements: [GraphChangeRadarCommunityMovement]
    let newlyOrphanedNodeIDs: [String]
    let resolvedOrphanNodeIDs: [String]
    let newlyNeedsAttentionNodeIDs: [String]
    let resolvedNeedsAttentionNodeIDs: [String]
    let activityLinks: [GraphChangeRadarActivityLink]
    let resolvedPendingPaths: [String]
    let resolvedPendingNodeIDs: [String]

    static let empty = GraphChangeRadarDiff(
        addedNodeIDs: [],
        removedNodeIDs: [],
        changedNodeIDs: [],
        addedEdgeIDs: [],
        removedEdgeIDs: [],
        communityMovements: [],
        newlyOrphanedNodeIDs: [],
        resolvedOrphanNodeIDs: [],
        newlyNeedsAttentionNodeIDs: [],
        resolvedNeedsAttentionNodeIDs: [],
        activityLinks: [],
        resolvedPendingPaths: [],
        resolvedPendingNodeIDs: []
    )
}

struct GraphChangeRadarAppendResult: Equatable, Sendable {
    let snapshot: GraphChangeRadarSnapshot
    let diff: GraphChangeRadarDiff
}

enum GraphChangeRadarError: Error, Equatable, Sendable {
    case mismatchedGraphSeed
}
