import Foundation

actor GraphChangeRadarService {
    private static let schemaVersion = 2
    private static let maximumActivityRecords = 500
    private static let maximumPendingPaths = 500
    private struct Document: Codable, Equatable {
        var schemaVersion: Int
        var retentionOverflow: Bool
        var snapshots: [GraphChangeRadarSnapshot]
    }

    private let storageURL: URL
    private let now: @Sendable () -> Date
    private let maximumSnapshots: Int
    private let maximumAge: TimeInterval
    private let maximumEncodedBytes: Int
    private var document: Document?

    init(
        applicationSupportDirectory: URL? = nil,
        now: @escaping @Sendable () -> Date = Date.init,
        maximumSnapshots: Int = 20,
        maximumAge: TimeInterval = 30 * 24 * 60 * 60,
        maximumEncodedBytes: Int = 64 * 1024 * 1024
    ) {
        let baseURL = applicationSupportDirectory ?? Self.defaultApplicationSupportDirectory()
        storageURL = baseURL
            .appendingPathComponent("BrainBar", isDirectory: true)
            .appendingPathComponent("graph-change-radar.json", isDirectory: false)
        self.now = now
        self.maximumSnapshots = maximumSnapshots
        self.maximumAge = maximumAge
        self.maximumEncodedBytes = maximumEncodedBytes
    }

    func append(
        validatedHandle: GraphDataHandle,
        seed: GraphChangeRadarSeed,
        activityWindow: GraphChangeRadarActivityWindow = .init()
    ) throws -> GraphChangeRadarAppendResult {
        guard validatedHandle.digest == seed.graphDigest,
              validatedHandle.semanticFingerprint == seed.semanticFingerprint
        else {
            throw GraphChangeRadarError.mismatchedGraphSeed
        }

        var document = loadDocument()
        prune(&document)
        let previous = document.snapshots.last
        let snapshot = makeSnapshot(
            seed: seed,
            activityWindow: activityWindow,
            previous: previous,
            capturedAt: now()
        )
        let diff = previous.map { makeDiff(from: $0, to: snapshot) } ?? .empty
        document.snapshots.append(snapshot)
        prune(&document)
        self.document = document
        persist(document)
        return .init(snapshot: snapshot, diff: diff)
    }

    func appendIfCurrent(
        validatedHandle: GraphDataHandle,
        seed: GraphChangeRadarSeed,
        activityWindow: GraphChangeRadarActivityWindow = .init(),
        beforeCurrentClaim: @Sendable () async -> Void = {},
        currentAttemptIsCurrent: @Sendable () -> Bool
    ) async throws -> GraphChangeRadarAppendResult? {
        await beforeCurrentClaim()
        guard currentAttemptIsCurrent() else {
            return nil
        }
        return try append(
            validatedHandle: validatedHandle,
            seed: seed,
            activityWindow: activityWindow
        )
    }

    func snapshots() -> [GraphChangeRadarSnapshot] {
        var document = loadDocument()
        let before = document
        prune(&document)
        self.document = document
        if document != before {
            persist(document)
        }
        return document.snapshots
    }

    func retentionOverflow() -> Bool {
        var document = loadDocument()
        let before = document
        prune(&document)
        self.document = document
        if document != before {
            persist(document)
        }
        return document.retentionOverflow
    }

    func latestSnapshotAndDiff() -> (snapshot: GraphChangeRadarSnapshot?, diff: GraphChangeRadarDiff) {
        var document = loadDocument()
        let before = document
        prune(&document)
        self.document = document
        if document != before {
            persist(document)
        }
        guard let snapshot = document.snapshots.last else {
            return (nil, .empty)
        }
        let diff = document.snapshots.dropLast().last.map { makeDiff(from: $0, to: snapshot) } ?? .empty
        return (snapshot, diff)
    }

    func clear() {
        document = nil
        try? FileManager.default.removeItem(at: storageURL)
    }

    private func loadDocument() -> Document {
        if let document {
            return document
        }
        guard let data = try? Data(contentsOf: storageURL),
              let decoded = try? JSONDecoder().decode(Document.self, from: data),
              decoded.schemaVersion == Self.schemaVersion
        else {
            let empty = Document(schemaVersion: Self.schemaVersion, retentionOverflow: false, snapshots: [])
            document = empty
            return empty
        }
        document = decoded
        return decoded
    }

    private func persist(_ document: Document) {
        guard let data = try? encoded(document) else {
            return
        }
        try? FileManager.default.createDirectory(at: storageURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: storageURL, options: .atomic)
    }

    private func prune(_ document: inout Document) {
        document.snapshots.sort { $0.capturedAt < $1.capturedAt }
        guard let newest = document.snapshots.last else {
            document.retentionOverflow = false
            return
        }

        let cutoff = now().addingTimeInterval(-maximumAge)
        document.snapshots = document.snapshots.filter { $0.capturedAt >= cutoff || $0 == newest }
        while document.snapshots.count > maximumSnapshots, document.snapshots.count > 1 {
            document.snapshots.removeFirst()
        }

        document.retentionOverflow = false
        while encodedByteCount(document) > maximumEncodedBytes, document.snapshots.count > 1 {
            document.snapshots.removeFirst()
        }
        document.retentionOverflow = encodedByteCount(document) > maximumEncodedBytes
    }

    private func encoded(_ document: Document) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        return try encoder.encode(document)
    }

    private func encodedByteCount(_ document: Document) -> Int {
        (try? encoded(document).count) ?? Int.max
    }

    private func makeSnapshot(
        seed: GraphChangeRadarSeed,
        activityWindow: GraphChangeRadarActivityWindow,
        previous: GraphChangeRadarSnapshot?,
        capturedAt: Date
    ) -> GraphChangeRadarSnapshot {
        let activity = normalizedActivityWindow(activityWindow)
        var connected = Set<String>()
        for edge in seed.edges {
            connected.insert(edge.source)
            connected.insert(edge.target)
        }
        let nodes = seed.nodes.map { node in
            let isOrphan = !connected.contains(node.id)
            return GraphChangeRadarNodeSnapshot(
                id: node.id,
                contentHash: node.contentHash,
                community: node.community,
                sourcePath: node.sourcePath,
                status: node.status,
                category: node.category,
                isOrphan: isOrphan,
                needsAttention: isOrphan || node.hasExplicitAttention
            )
        }.sorted { $0.id < $1.id }
        let edges = seed.edges.map {
            GraphChangeRadarEdgeSnapshot(identity: $0.identity, source: $0.source, target: $0.target)
        }.sorted { $0.identity < $1.identity }
        let sourcePaths = Set(nodes.compactMap(\.sourcePath))
        let pendingRelativePaths = orderedUnique((previous?.pendingRelativePaths ?? []) + activity.pendingRelativePaths)
            .filter { !sourcePaths.contains($0) }
            .prefix(Self.maximumPendingPaths)
        return .init(
            capturedAt: capturedAt,
            graphDigest: seed.graphDigest,
            semanticFingerprint: seed.semanticFingerprint,
            activityCursor: activity.cursor,
            activityRecords: activity.records,
            pendingRelativePaths: Array(pendingRelativePaths),
            nodes: nodes,
            edges: edges
        )
    }

    private func makeDiff(from old: GraphChangeRadarSnapshot, to new: GraphChangeRadarSnapshot) -> GraphChangeRadarDiff {
        let oldNodes = Dictionary(uniqueKeysWithValues: old.nodes.map { ($0.id, $0) })
        let newNodes = Dictionary(uniqueKeysWithValues: new.nodes.map { ($0.id, $0) })
        let oldEdges = Set(old.edges.map(\.identity))
        let newEdges = Set(new.edges.map(\.identity))
        let commonNodeIDs = Set(oldNodes.keys).intersection(newNodes.keys)

        let addedNodeIDs = Array(Set(newNodes.keys).subtracting(oldNodes.keys)).sorted()
        let removedNodeIDs = Array(Set(oldNodes.keys).subtracting(newNodes.keys)).sorted()
        let changedNodeIDs = commonNodeIDs.filter { oldNodes[$0]?.contentHash != newNodes[$0]?.contentHash }.sorted()
        let newlyOrphanedNodeIDs = commonNodeIDs.filter { oldNodes[$0]?.isOrphan == false && newNodes[$0]?.isOrphan == true }.sorted()
        let resolvedOrphanNodeIDs = commonNodeIDs.filter { oldNodes[$0]?.isOrphan == true && newNodes[$0]?.isOrphan == false }.sorted()
        let newlyNeedsAttentionNodeIDs = Set(
            commonNodeIDs.filter { oldNodes[$0]?.needsAttention == false && newNodes[$0]?.needsAttention == true }
                + addedNodeIDs.filter { newNodes[$0]?.needsAttention == true }
        ).sorted()
        let resolvedNeedsAttentionNodeIDs = commonNodeIDs.filter { oldNodes[$0]?.needsAttention == true && newNodes[$0]?.needsAttention == false }.sorted()
        let communityMovements = communityMovements(old: oldNodes, new: newNodes)
        let pendingResolutions = resolvedPendingPaths(from: old, to: new)
        let impactedNodeIDs = Set(addedNodeIDs + removedNodeIDs + changedNodeIDs + newlyOrphanedNodeIDs + resolvedOrphanNodeIDs + newlyNeedsAttentionNodeIDs + resolvedNeedsAttentionNodeIDs + communityMovements.map(\.nodeID) + pendingResolutions.nodeIDs)

        return GraphChangeRadarDiff(
            addedNodeIDs: addedNodeIDs,
            removedNodeIDs: removedNodeIDs,
            changedNodeIDs: changedNodeIDs,
            addedEdgeIDs: Array(newEdges.subtracting(oldEdges)).sorted(),
            removedEdgeIDs: Array(oldEdges.subtracting(newEdges)).sorted(),
            communityMovements: communityMovements,
            newlyOrphanedNodeIDs: newlyOrphanedNodeIDs,
            resolvedOrphanNodeIDs: resolvedOrphanNodeIDs,
            newlyNeedsAttentionNodeIDs: newlyNeedsAttentionNodeIDs,
            resolvedNeedsAttentionNodeIDs: resolvedNeedsAttentionNodeIDs,
            activityLinks: activityLinks(records: new.activityRecords, nodes: newNodes, impactedNodeIDs: impactedNodeIDs),
            resolvedPendingPaths: pendingResolutions.paths,
            resolvedPendingNodeIDs: pendingResolutions.nodeIDs
        )
    }

    private func normalizedActivityWindow(_ window: GraphChangeRadarActivityWindow) -> GraphChangeRadarActivityWindow {
        let records = window.records.compactMap { record -> GraphChangeRadarActivityRecord? in
            guard !record.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return nil
            }
            return .init(
                id: record.id,
                action: record.action,
                agent: record.agent,
                timestamp: record.timestamp,
                relativePath: safeRelativePath(record.relativePath),
                nodeID: nonempty(record.nodeID),
                status: nonempty(record.status),
                category: nonempty(record.category)
            )
        }.sorted { lhs, rhs in
            lhs.timestamp == rhs.timestamp ? lhs.id < rhs.id : lhs.timestamp < rhs.timestamp
        }
        let boundedRecords = Array(records.suffix(Self.maximumActivityRecords))
        let pendingPaths = Set(window.pendingRelativePaths.compactMap(safeRelativePath)
            + boundedRecords.compactMap { $0.nodeID == nil ? $0.relativePath : nil })
            .sorted()
        return .init(
            cursor: window.cursor,
            records: boundedRecords,
            pendingRelativePaths: Array(pendingPaths.prefix(Self.maximumPendingPaths))
        )
    }

    private func resolvedPendingPaths(
        from old: GraphChangeRadarSnapshot,
        to new: GraphChangeRadarSnapshot
    ) -> (paths: [String], nodeIDs: [String]) {
        let byPath = Dictionary(grouping: new.nodes.compactMap { node -> (String, String)? in
            node.sourcePath.map { ($0, node.id) }
        }, by: \.0)
        let currentPendingPaths = Set(new.pendingRelativePaths)
        let paths = old.pendingRelativePaths.filter {
            byPath[$0] != nil && !currentPendingPaths.contains($0)
        }.sorted()
        let nodeIDs = Set(paths.flatMap { byPath[$0]?.map(\.1) ?? [] }).sorted()
        return (paths, nodeIDs)
    }

    private func activityLinks(
        records: [GraphChangeRadarActivityRecord],
        nodes: [String: GraphChangeRadarNodeSnapshot],
        impactedNodeIDs: Set<String>
    ) -> [GraphChangeRadarActivityLink] {
        guard !impactedNodeIDs.isEmpty else {
            return []
        }
        return records.flatMap { record -> [GraphChangeRadarActivityLink] in
            let nodeIDs = Set(
                [record.nodeID].compactMap { $0 }.filter(impactedNodeIDs.contains)
                + nodes.values.compactMap { node in
                    record.relativePath == node.sourcePath && impactedNodeIDs.contains(node.id) ? node.id : nil
                }
            ).sorted()
            guard !nodeIDs.isEmpty else {
                return [.init(record: record, nodeID: nil, relationship: .temporal)]
            }
            return nodeIDs.map { .init(record: record, nodeID: $0, relationship: .touched) }
        }.sorted {
            $0.record.id == $1.record.id ? ($0.nodeID ?? "") < ($1.nodeID ?? "") : $0.record.id < $1.record.id
        }
    }

    private func safeRelativePath(_ value: String?) -> String? {
        guard let value = nonempty(value) else {
            return nil
        }
        let normalized = value.replacingOccurrences(of: "\\", with: "/")
        guard !normalized.hasPrefix("/"),
              !normalized.split(separator: "/", omittingEmptySubsequences: false).contains("..")
        else {
            return nil
        }
        let components = normalized.split(separator: "/").filter { $0 != "." && !$0.isEmpty }
        guard !components.isEmpty else {
            return nil
        }
        return components.joined(separator: "/")
    }

    private func nonempty(_ value: String?) -> String? {
        guard let value else {
            return nil
        }
        return value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : value
    }

    private func orderedUnique(_ paths: [String]) -> [String] {
        var seen = Set<String>()
        return paths.filter { seen.insert($0).inserted }
    }

    private func communityMovements(
        old: [String: GraphChangeRadarNodeSnapshot],
        new: [String: GraphChangeRadarNodeSnapshot]
    ) -> [GraphChangeRadarCommunityMovement] {
        let shared = Set(old.keys).intersection(new.keys)
        let oldGroups = Dictionary(grouping: shared, by: { old[$0]!.community }).mapValues(Set.init)
        let newGroups = Dictionary(grouping: shared, by: { new[$0]!.community }).mapValues(Set.init)
        var matches: [String: String] = [:]
        var matchedNew = Set<String>()

        for oldLabel in oldGroups.keys.sorted() {
            guard let oldMembers = oldGroups[oldLabel] else { continue }
            if let newLabel = newGroups.keys.sorted().first(where: { newGroups[$0] == oldMembers }) {
                matches[oldLabel] = newLabel
                matchedNew.insert(newLabel)
            }
        }

        for oldLabel in oldGroups.keys.sorted() where matches[oldLabel] == nil {
            guard let oldMembers = oldGroups[oldLabel] else { continue }
            let candidates = newGroups.keys.filter { !matchedNew.contains($0) }.compactMap { newLabel -> (String, Int, Int)? in
                guard let newMembers = newGroups[newLabel] else { return nil }
                let intersection = oldMembers.intersection(newMembers).count
                guard intersection > 0 else { return nil }
                return (newLabel, intersection, oldMembers.union(newMembers).count)
            }.sorted { lhs, rhs in
                let leftScore = lhs.1 * rhs.2
                let rightScore = rhs.1 * lhs.2
                return leftScore == rightScore ? lhs.0 < rhs.0 : leftScore > rightScore
            }
            if let candidate = candidates.first {
                matches[oldLabel] = candidate.0
                matchedNew.insert(candidate.0)
            }
        }

        return shared.compactMap { id in
            guard let before = old[id], let after = new[id], before.community != after.community,
                  matches[before.community] != after.community
            else {
                return nil
            }
            return GraphChangeRadarCommunityMovement(nodeID: id, from: before.community, to: after.community)
        }.sorted { $0.nodeID < $1.nodeID }
    }

    private static func defaultApplicationSupportDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
    }
}
