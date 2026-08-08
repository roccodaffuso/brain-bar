import Foundation
import XCTest
@testable import BrainBar

final class GraphChangeRadarTests: XCTestCase {
    func testIdenticalAndReorderedRefreshHaveNoDiff() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())

        let first = try await prepare(
            graph(nodes: [node("a"), node("b")], edges: [edge("ab", "a", "b")]),
            vault: vault,
            store: store,
            policy: .retry
        )
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        let second = try await prepare(
            graph(nodes: [node("b"), node("a")], edges: [edge("ab", "a", "b")]),
            vault: vault,
            store: store,
            policy: .retry
        )
        let result = try await radar.append(validatedHandle: second.handle, seed: second.seed)

        XCTAssertEqual(result.diff, .empty)
        XCTAssertEqual(result.diff.activityLinks, [])
        XCTAssertEqual(result.diff.resolvedPendingPaths, [])
        XCTAssertEqual(result.diff.resolvedPendingNodeIDs, [])
    }

    func testGoldenAddedRemovedAndChangedNodesAndEdges() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())
        let first = try await prepare(
            graph(nodes: [node("a", label: "old"), node("b"), node("c")], edges: [edge("ab", "a", "b"), edge("bc", "b", "c")]),
            vault: vault, store: store, policy: .retry
        )
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        let second = try await prepare(
            graph(nodes: [node("a", label: "new"), node("c"), node("d")], edges: [edge("cd", "c", "d")]),
            vault: vault, store: store, policy: .retry
        )
        let result = try await radar.append(validatedHandle: second.handle, seed: second.seed)

        XCTAssertEqual(result.diff.addedNodeIDs, ["d"])
        XCTAssertEqual(result.diff.removedNodeIDs, ["b"])
        XCTAssertEqual(result.diff.changedNodeIDs, ["a"])
        XCTAssertEqual(result.diff.addedEdgeIDs, ["id:cd"])
        XCTAssertEqual(result.diff.removedEdgeIDs, ["id:ab", "id:bc"])
    }

    func testExplicitAndIdlessEdgesPreserveMultiplicityAcrossReorder() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())
        let idless = edge(nil, "a", "b", relation: "links", attributes: ["weight": 1])
        let first = try await prepare(
            graph(nodes: [node("a"), node("b")], edges: [edge("explicit", "a", "b"), idless, idless]),
            vault: vault, store: store, policy: .retry
        )
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        let reordered = try await prepare(
            graph(nodes: [node("b"), node("a")], edges: [idless, edge("explicit", "a", "b"), idless]),
            vault: vault, store: store, policy: .retry
        )
        let reorderedResult = try await radar.append(validatedHandle: reordered.handle, seed: reordered.seed)
        XCTAssertEqual(reorderedResult.diff, .empty)
        XCTAssertEqual(reorderedResult.diff.activityLinks, [])
        XCTAssertEqual(reorderedResult.diff.resolvedPendingPaths, [])
        let reduced = try await prepare(
            graph(nodes: [node("a"), node("b")], edges: [edge("explicit", "a", "b"), idless]),
            vault: vault, store: store, policy: .retry
        )
        let result = try await radar.append(validatedHandle: reduced.handle, seed: reduced.seed)
        XCTAssertEqual(result.diff.removedEdgeIDs.count, 1)
        XCTAssertTrue(result.diff.removedEdgeIDs[0].hasPrefix("semantic:"))
    }

    func testCommunityRenumberIsZeroMovementAndChangedMembershipIsDeterministic() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())
        let first = try await prepare(
            graph(nodes: [node("a", community: "1"), node("b", community: "1"), node("c", community: "2"), node("d", community: "2")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        let renamed = try await prepare(
            graph(nodes: [node("a", community: "North"), node("b", community: "North"), node("c", community: "South"), node("d", community: "South")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let renamedResult = try await radar.append(validatedHandle: renamed.handle, seed: renamed.seed)
        XCTAssertEqual(renamedResult.diff.communityMovements, [])
        let moved = try await prepare(
            graph(nodes: [node("a", community: "North"), node("b", community: "South"), node("c", community: "South"), node("d", community: "South")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let movedResult = try await radar.append(validatedHandle: moved.handle, seed: moved.seed)
        XCTAssertEqual(movedResult.diff.communityMovements, [.init(nodeID: "b", from: "North", to: "South")])
    }

    func testOrphansAndNeedsAttentionResolveOnlyFromExistingSignals() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())
        let first = try await prepare(
            graph(nodes: [node("a", status: "pending"), node("b")], edges: [edge("ab", "a", "b")]),
            vault: vault, store: store, policy: .retry
        )
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        let second = try await prepare(
            graph(nodes: [node("a", status: "closed"), node("b"), node("c", status: "pending")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let orphaned = try await radar.append(validatedHandle: second.handle, seed: second.seed)
        XCTAssertEqual(orphaned.diff.newlyOrphanedNodeIDs, ["a", "b"])
        XCTAssertEqual(orphaned.diff.newlyNeedsAttentionNodeIDs, ["b", "c"])
        let third = try await prepare(
            graph(nodes: [node("a", status: "closed"), node("b")], edges: [edge("ab", "a", "b")]),
            vault: vault, store: store, policy: .retry
        )
        let resolved = try await radar.append(validatedHandle: third.handle, seed: third.seed)
        XCTAssertEqual(resolved.diff.resolvedOrphanNodeIDs, ["a", "b"])
        XCTAssertEqual(resolved.diff.resolvedNeedsAttentionNodeIDs, ["a", "b"])
    }

    func testUnsafeSourcePathsAreOmittedFromSeed() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let notes = vault.appendingPathComponent("Notes", isDirectory: true)
        try FileManager.default.createDirectory(at: notes, withIntermediateDirectories: true)
        try Data("inside".utf8).write(to: notes.appendingPathComponent("inside.md"))
        let outside = vault.deletingLastPathComponent().appendingPathComponent("outside.md")
        try Data("outside".utf8).write(to: outside)
        try FileManager.default.createSymbolicLink(at: notes.appendingPathComponent("escape.md"), withDestinationURL: outside)
        let store = GraphDataStore()
        let prepared = try await prepare(
            graph(nodes: [
                node("inside", source: "Notes/inside.md"),
                node("traversal", source: "../outside.md"),
                node("absolute", source: outside.path),
                node("escape", source: "Notes/escape.md")
            ], edges: []),
            vault: vault, store: store, policy: .retry
        )
        XCTAssertEqual(Dictionary(uniqueKeysWithValues: prepared.seed.nodes.map { ($0.id, $0.sourcePath) })["inside"]!, "Notes/inside.md")
        XCTAssertNil(Dictionary(uniqueKeysWithValues: prepared.seed.nodes.map { ($0.id, $0.sourcePath) })["traversal"]!)
        XCTAssertNil(Dictionary(uniqueKeysWithValues: prepared.seed.nodes.map { ($0.id, $0.sourcePath) })["absolute"]!)
        XCTAssertNil(Dictionary(uniqueKeysWithValues: prepared.seed.nodes.map { ($0.id, $0.sourcePath) })["escape"]!)
    }

    func testPendingPathsResolveToNodesAndActivityLinksAreTouchedMetadata() async throws {
        let vault = try makeVault()
        defer { try? FileManager.default.removeItem(at: vault.deletingLastPathComponent()) }
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: vault.deletingLastPathComponent())
        let timestamp = Date(timeIntervalSince1970: 5_000)
        let first = try await prepare(
            graph(nodes: [node("b")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        _ = try await radar.append(
            validatedHandle: first.handle,
            seed: first.seed,
            activityWindow: .init(
                cursor: cursor(1),
                records: [.init(
                    id: "pending-event",
                    action: .write,
                    agent: "codex",
                    timestamp: timestamp,
                    relativePath: "Notes/A.md"
                )]
            )
        )
        let carried = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        XCTAssertEqual(carried.snapshot.pendingRelativePaths, ["Notes/A.md"])
        XCTAssertEqual(carried.diff.resolvedPendingPaths, [])
        let second = try await prepare(
            graph(nodes: [node("b"), node("a", source: "Notes/A.md")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let result = try await radar.append(
            validatedHandle: second.handle,
            seed: second.seed
        )

        XCTAssertEqual(result.diff.resolvedPendingPaths, ["Notes/A.md"])
        XCTAssertEqual(result.diff.resolvedPendingNodeIDs, ["a"])
        XCTAssertEqual(result.snapshot.pendingRelativePaths, [])
        XCTAssertEqual(result.diff.activityLinks, [])
        let repeated = try await radar.append(validatedHandle: second.handle, seed: second.seed)
        XCTAssertEqual(repeated.diff.resolvedPendingPaths, [])
        XCTAssertEqual(repeated.diff.resolvedPendingNodeIDs, [])

        let touched = try await prepare(
            graph(nodes: [node("b"), node("a", source: "Notes/A.md", status: "pending")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let touchedResult = try await radar.append(
            validatedHandle: touched.handle,
            seed: touched.seed,
            activityWindow: .init(records: [.init(
                id: "touched-event",
                action: .write,
                agent: "codex",
                timestamp: timestamp,
                relativePath: "Notes/A.md"
            )])
        )
        XCTAssertEqual(
            touchedResult.diff.activityLinks,
            [.init(
                record: .init(
                    id: "touched-event",
                    action: .write,
                    agent: "codex",
                    timestamp: timestamp,
                    relativePath: "Notes/A.md"
                ),
                nodeID: "a",
                relationship: .touched
            )]
        )

        let currentOnlyRoot = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: currentOnlyRoot) }
        let currentOnlyRadar = GraphChangeRadarService(applicationSupportDirectory: currentOnlyRoot)
        let currentOnly = try await currentOnlyRadar.append(
            validatedHandle: second.handle,
            seed: second.seed,
            activityWindow: .init(records: [.init(
                id: "already-mapped-event",
                action: .write,
                agent: "codex",
                timestamp: timestamp,
                relativePath: "Notes/A.md"
            )])
        )
        XCTAssertEqual(currentOnly.snapshot.pendingRelativePaths, [])
        let noLaterResolution = try await currentOnlyRadar.append(validatedHandle: second.handle, seed: second.seed)
        XCTAssertEqual(noLaterResolution.diff.resolvedPendingPaths, [])
    }

    func testPersistenceSchemaRetentionPrivacyAndClear() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let vault = root.appendingPathComponent("vault", isDirectory: true)
        let store = GraphDataStore()
        let prepared = try await prepare(
            graph(nodes: [node("a", label: "private-note-body", source: "Notes/A.md", status: "pending", category: "decision")], edges: []),
            vault: vault, store: store, policy: .retry
        )
        let base = Date(timeIntervalSince1970: 1_000)
        for offset in 0..<3 {
            let radar = GraphChangeRadarService(
                applicationSupportDirectory: root,
                now: { base.addingTimeInterval(TimeInterval(offset)) },
                maximumSnapshots: 2
            )
            _ = try await radar.append(
                validatedHandle: prepared.handle,
                seed: prepared.seed,
                activityWindow: .init(
                    cursor: cursor(UInt64(offset)),
                    records: [.init(
                        id: "activity-\(offset)",
                        action: .write,
                        agent: "codex",
                        timestamp: base,
                        relativePath: "Notes/A.md",
                        status: "done",
                        category: "agent"
                    )]
                )
            )
        }
        let radar = GraphChangeRadarService(applicationSupportDirectory: root, now: { base.addingTimeInterval(3) }, maximumSnapshots: 2)
        let snapshots = await radar.snapshots()
        XCTAssertEqual(snapshots.count, 2)
        XCTAssertEqual(snapshots.map(\.activityCursor), [cursor(1), cursor(2)])
        let storage = root.appendingPathComponent("BrainBar/graph-change-radar.json")
        let persisted = try String(decoding: Data(contentsOf: storage), as: UTF8.self)
        XCTAssertFalse(persisted.contains("private-note-body"))
        XCTAssertFalse(persisted.contains(vault.path))
        XCTAssertFalse(persisted.contains("source_file"))
        XCTAssertFalse(persisted.contains("\"reason\""))
        XCTAssertFalse(persisted.contains("\"sessionId\""))
        XCTAssertTrue(persisted.contains("sourcePath"))
        await radar.clear()
        let cleared = await radar.snapshots()
        XCTAssertEqual(cleared, [])
        XCTAssertFalse(FileManager.default.fileExists(atPath: storage.path))

        try Data("{\"schemaVersion\":999,\"retentionOverflow\":false,\"snapshots\":[]}".utf8).write(to: storage, options: .atomic)
        let schemaReset = GraphChangeRadarService(applicationSupportDirectory: root)
        let schemaSnapshots = await schemaReset.snapshots()
        XCTAssertEqual(schemaSnapshots, [])

        let retentionRoot = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: retentionRoot) }
        let start = Date(timeIntervalSince1970: 10_000)
        let firstRetention = GraphChangeRadarService(applicationSupportDirectory: retentionRoot, now: { start })
        _ = try await firstRetention.append(validatedHandle: prepared.handle, seed: prepared.seed)
        let secondRetention = GraphChangeRadarService(
            applicationSupportDirectory: retentionRoot,
            now: { start.addingTimeInterval(24 * 60 * 60) }
        )
        _ = try await secondRetention.append(validatedHandle: prepared.handle, seed: prepared.seed)
        let expiredReader = GraphChangeRadarService(
            applicationSupportDirectory: retentionRoot,
            now: { start.addingTimeInterval(31 * 24 * 60 * 60) }
        )
        let retainedByAge = await expiredReader.snapshots()
        XCTAssertEqual(retainedByAge.count, 1)
        XCTAssertEqual(retainedByAge[0].capturedAt, start.addingTimeInterval(24 * 60 * 60))
    }

    func testMismatchedHandleIsRejectedAndNewestSnapshotSurvivesSizeCap() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let vault = root.appendingPathComponent("vault", isDirectory: true)
        let store = GraphDataStore()
        let prepared = try await prepare(graph(nodes: [node("a")], edges: []), vault: vault, store: store, policy: .retry)
        let radar = GraphChangeRadarService(applicationSupportDirectory: root, maximumEncodedBytes: 100)
        let mismatch = GraphDataHandle(
            digest: "other",
            semanticFingerprint: prepared.handle.semanticFingerprint,
            counts: prepared.handle.counts,
            sourceSignature: prepared.handle.sourceSignature
        )
        await XCTAssertThrowsErrorAsync(try await radar.append(validatedHandle: mismatch, seed: prepared.seed)) { error in
            XCTAssertEqual(error as? GraphChangeRadarError, .mismatchedGraphSeed)
        }
        _ = try await radar.append(validatedHandle: prepared.handle, seed: prepared.seed)
        let snapshots = await radar.snapshots()
        let overflow = await radar.retentionOverflow()
        XCTAssertEqual(snapshots.count, 1)
        XCTAssertTrue(overflow)
    }

    private struct Prepared {
        let handle: GraphDataHandle
        let seed: GraphChangeRadarSeed
    }

    private func prepare(
        _ payload: [String: Any],
        vault: URL,
        store: GraphDataStore,
        policy: GraphDataPreparePolicy
    ) async throws -> Prepared {
        let graphURL = vault.appendingPathComponent("graphify-out/graph.json")
        try FileManager.default.createDirectory(at: graphURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        try data.write(to: graphURL, options: .atomic)
        guard case let .ready(handle) = await store.prepare(url: graphURL, policy: policy),
              let seed = await store.radarSeed(for: handle)
        else {
            throw NSError(domain: "GraphChangeRadarTests", code: 1)
        }
        return .init(handle: handle, seed: seed)
    }

    private func makeVault() throws -> URL {
        try temporaryDirectory().appendingPathComponent("vault", isDirectory: true)
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func graph(nodes: [[String: Any]], edges: [[String: Any]]) -> [String: Any] {
        ["nodes": nodes, "edges": edges]
    }

    private func cursor(_ sequence: UInt64) -> AgentActivityCursor {
        .init(generation: UUID(uuidString: "00000000-0000-0000-0000-000000000001")!, ingestionSequence: sequence)
    }

    private func node(
        _ id: String,
        label: String? = nil,
        community: String? = nil,
        source: String? = nil,
        status: String? = nil,
        category: String? = nil
    ) -> [String: Any] {
        var result: [String: Any] = ["id": id]
        if let label { result["label"] = label }
        if let community { result["community"] = community }
        if let source { result["source_file"] = source }
        if let status { result["status"] = status }
        if let category { result["category"] = category }
        return result
    }

    private func edge(
        _ id: String?,
        _ source: String,
        _ target: String,
        relation: String = "links",
        attributes: [String: Any] = [:]
    ) -> [String: Any] {
        var result = attributes
        if let id { result["id"] = id }
        result["source"] = source
        result["target"] = target
        result["relation"] = relation
        return result
    }
}

final class GraphChangeRadarPerformanceTests: XCTestCase {
    func test25KSnapshotAndDiffPerformance() async throws {
        let root = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: root) }
        let vault = root.appendingPathComponent("vault", isDirectory: true)
        let graphURL = vault.appendingPathComponent("graphify-out/graph.json")
        try FileManager.default.createDirectory(at: graphURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        let store = GraphDataStore()
        let radar = GraphChangeRadarService(applicationSupportDirectory: root)
        let firstPayload = stressGraph(changed: false)
        try JSONSerialization.data(withJSONObject: firstPayload, options: [.sortedKeys]).write(to: graphURL, options: .atomic)

        let start = Date()
        let first = try await prepare(graphURL: graphURL, store: store, policy: .retry)
        _ = try await radar.append(validatedHandle: first.handle, seed: first.seed)
        try JSONSerialization.data(withJSONObject: stressGraph(changed: true), options: [.sortedKeys]).write(to: graphURL, options: .atomic)
        let second = try await prepare(graphURL: graphURL, store: store, policy: .retry)
        let result = try await radar.append(validatedHandle: second.handle, seed: second.seed)
        let elapsed = Date().timeIntervalSince(start)
        let bytes = try Data(contentsOf: root.appendingPathComponent("BrainBar/graph-change-radar.json")).count

        XCTAssertEqual(first.handle.counts, .init(nodes: 25_000, edges: 59_512))
        XCTAssertEqual(second.handle.counts, .init(nodes: 25_000, edges: 59_512))
        XCTAssertEqual(result.diff.changedNodeIDs, ["n0"])
        XCTAssertEqual(result.diff.addedNodeIDs, [])
        XCTAssertEqual(result.diff.removedNodeIDs, [])
        XCTAssertEqual(result.diff.addedEdgeIDs, [])
        XCTAssertEqual(result.diff.removedEdgeIDs, [])
        XCTAssertLessThanOrEqual(bytes, 64 * 1024 * 1024)
        // Reference-host ceiling: includes two validated parses, snapshot construction, diff, and atomic persistence.
        XCTAssertLessThan(elapsed, 12.0)
        print("GraphChangeRadar 25K: \(String(format: "%.3f", elapsed))s, \(bytes) bytes")
    }

    private func prepare(graphURL: URL, store: GraphDataStore, policy: GraphDataPreparePolicy) async throws -> (handle: GraphDataHandle, seed: GraphChangeRadarSeed) {
        guard case let .ready(handle) = await store.prepare(url: graphURL, policy: policy),
              let seed = await store.radarSeed(for: handle)
        else {
            throw NSError(domain: "GraphChangeRadarPerformanceTests", code: 1)
        }
        return (handle, seed)
    }

    private func stressGraph(changed: Bool) -> [String: Any] {
        let nodes = (0..<25_000).map { index -> [String: Any] in
            var node: [String: Any] = ["id": "n\(index)", "community": "c\(index % 50)"]
            if changed && index == 0 { node["status"] = "pending" }
            return node
        }
        let edges = (0..<59_512).map { index in
            ["id": "e\(index)", "source": "n\(index % 25_000)", "target": "n\((index * 17 + 1) % 25_000)", "relation": "links"]
        }
        return ["nodes": nodes, "edges": edges]
    }

    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }
}

private func XCTAssertThrowsErrorAsync<T>(
    _ expression: @autoclosure () async throws -> T,
    _ handler: (Error) -> Void = { _ in }
) async {
    do {
        _ = try await expression()
        XCTFail("Expected an error")
    } catch {
        handler(error)
    }
}
