import Foundation
import XCTest
@testable import BrainBar

final class AgentActivityWorkflowTests: XCTestCase {
    func testV1MigrationIgnoresUndeclaredWorkflowFields() throws {
        let line = """
        {"version":1,"agent":"codex","action":"read","path":"Notes/Legacy.md","timestamp":"2026-08-08T10:00:00.000Z","session_id":"legacy-session","workflow_id":"must-not-exist","workflow_title":"Must not exist","path_role":"output"}
        """

        let event = try XCTUnwrap(AgentActivityEventParser.parse(line))
        XCTAssertEqual(event.version, 1)
        XCTAssertEqual(event.sessionId, "legacy-session")
        XCTAssertNil(event.workflowId)
        XCTAssertNil(event.workflowTitle)
        XCTAssertNil(event.pathRole)

        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        try AgentActivityTraceWriter.write(
            AgentActivityEvent(version: 1, agent: "codex", action: .read, path: "Notes/Legacy.md", timestamp: Date(), workflowId: "must-not-write", workflowTitle: "Must not write", pathRole: .source),
            to: log
        )
        let written = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: log)) as? [String: Any])
        XCTAssertNil(written["workflow_id"])
        XCTAssertNil(written["workflow_title"])
        XCTAssertNil(written["path_role"])
    }

    @MainActor
    func testV2MetadataSurvivesWriterParserHistoryAndMappedSnapshot() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let timestamp = Date()
        let original = AgentActivityEvent(
            version: 2,
            agent: "codex",
            action: .write,
            path: directory.appendingPathComponent("Notes/Output.md").path,
            timestamp: timestamp,
            sessionId: "session-1",
            project: "BrainBar",
            source: "test-source",
            reason: "test-reason",
            nodeId: "node-output",
            status: "complete",
            workflowId: "workflow-1",
            workflowTitle: "Publish workflow",
            pathRole: .output
        )
        try AgentActivityTraceWriter.write(original, to: log)
        let parsed = try XCTUnwrap(AgentActivityEventParser.parse(try String(contentsOf: log, encoding: .utf8)))

        XCTAssertEqual(parsed.version, original.version)
        XCTAssertEqual(parsed.sessionId, original.sessionId)
        XCTAssertEqual(parsed.project, original.project)
        XCTAssertEqual(parsed.source, original.source)
        XCTAssertEqual(parsed.reason, original.reason)
        XCTAssertEqual(parsed.status, original.status)
        XCTAssertEqual(parsed.workflowId, original.workflowId)
        XCTAssertEqual(parsed.workflowTitle, original.workflowTitle)
        XCTAssertEqual(parsed.pathRole, .output)

        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false, retentionDays: 11), vaultURL: directory)
        service.ingestForTesting(parsed)

        let record = try XCTUnwrap(service.history(afterExclusive: nil, throughInclusive: service.captureHistoryCursor(), matchingNodeIDs: [], matchingRelativePaths: []).first)
        XCTAssertEqual(record.version, original.version)
        XCTAssertEqual(record.sessionId, original.sessionId)
        XCTAssertEqual(record.project, original.project)
        XCTAssertEqual(record.source, original.source)
        XCTAssertEqual(record.reason, original.reason)
        XCTAssertEqual(record.status, original.status)
        XCTAssertEqual(record.workflowId, original.workflowId)
        XCTAssertEqual(record.workflowTitle, original.workflowTitle)
        XCTAssertEqual(record.pathRole, .output)

        let snapshot = service.currentSnapshot
        let mapped = try XCTUnwrap(snapshot.events.first)
        XCTAssertEqual(mapped.version, original.version)
        XCTAssertEqual(mapped.sessionId, original.sessionId)
        XCTAssertEqual(mapped.project, original.project)
        XCTAssertEqual(mapped.source, original.source)
        XCTAssertEqual(mapped.reason, original.reason)
        XCTAssertEqual(mapped.status, original.status)
        XCTAssertEqual(mapped.workflowId, original.workflowId)
        XCTAssertEqual(mapped.workflowTitle, original.workflowTitle)
        XCTAssertEqual(mapped.pathRole, .output)
        XCTAssertEqual(snapshot.workflowRetentionDays, 11)
        XCTAssertEqual(snapshot.eventSchemaVersion, 2)
        XCTAssertEqual(snapshot.workflows.first?.nodeIds, ["node-output"])
        XCTAssertEqual(snapshot.workflows.first?.pendingPaths, ["Notes/Output.md"])
    }

    @MainActor
    func testDerivedWorkflowsAreExplicitOnlyAndDeterministicForDuplicatesAndCollisions() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: directory)
        let timestamp = Date().addingTimeInterval(-3_600)
        let workflowPath = directory.appendingPathComponent("Notes/Workflow.md").path
        let inputNode = AgentActivityGraphNode(id: "node-input", label: "Input", sourceFile: "Notes/Input.md")
        service.setGraphIndexForTesting(.init(byNodeId: ["node-input": inputNode], bySourceFile: ["notes/input.md": inputNode], byFilename: ["input.md": inputNode]))

        // Deliberately ingest reverse chronological order. The duplicate has a distinct
        // caller id but identical fingerprint metadata and must not enter the trail.
        service.ingestForTesting(AgentActivityEvent(id: "z", agent: "codex", action: .write, path: workflowPath, timestamp: timestamp, status: "working", workflowId: "collision", workflowTitle: "Alpha", pathRole: .output))
        service.ingestForTesting(AgentActivityEvent(id: "a", agent: "codex", action: .read, path: directory.appendingPathComponent("Notes/Input.md").path, timestamp: timestamp, status: "queued", workflowId: "collision", workflowTitle: "Zulu", pathRole: .source))
        service.ingestForTesting(AgentActivityEvent(id: "duplicate", agent: "codex", action: .read, path: directory.appendingPathComponent("Notes/Input.md").path, timestamp: timestamp, status: "queued", workflowId: "collision", workflowTitle: "Zulu", pathRole: .source))
        service.ingestForTesting(AgentActivityEvent(id: "later", agent: "codex", action: .focus, path: directory.appendingPathComponent("Notes/Touched.md").path, timestamp: timestamp.addingTimeInterval(1), status: "complete", workflowId: "collision", workflowTitle: "Final"))
        // Same bare value under session_id is intentionally a separate namespaced group.
        service.ingestForTesting(AgentActivityEvent(id: "session", agent: "claude", action: .read, path: directory.appendingPathComponent("Notes/Session.md").path, timestamp: timestamp, sessionId: "collision"))
        // No explicit workflow/session id never becomes a workflow due to timing or path proximity.
        service.ingestForTesting(AgentActivityEvent(id: "ungrouped", agent: "codex", action: .write, path: directory.appendingPathComponent("Notes/Ungrouped.md").path, timestamp: timestamp))

        let workflows = service.currentSnapshot.workflows
        XCTAssertEqual(workflows.map(\.id).sorted(), ["session:collision", "workflow:collision"])
        let workflow = try XCTUnwrap(workflows.first(where: { $0.id == "workflow:collision" }))
        XCTAssertEqual(workflow.trail.map(\.id), ["a", "z", "later"])
        XCTAssertEqual(workflow.title, "Final")
        XCTAssertEqual(workflow.status, "complete")
        XCTAssertEqual(workflow.sourcePaths, ["Notes/Input.md"])
        XCTAssertEqual(workflow.outputPaths, ["Notes/Workflow.md"])
        XCTAssertEqual(workflow.touchedPaths, ["Notes/Touched.md"])
        XCTAssertEqual(workflow.nodeIds, ["node-input"])
        XCTAssertEqual(workflow.pendingPaths, ["Notes/Touched.md", "Notes/Workflow.md"])
        XCTAssertTrue(service.currentSnapshot.events.isEmpty, "Older retained workflow events remain available without appearing in the two-minute live stream.")
    }

    @MainActor
    func testRoleAbsenceMeansTouchedAndWorkflowSharesRetentionAndClear() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false, retentionDays: 1), vaultURL: directory)

        service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .read, path: directory.appendingPathComponent("Notes/Expired.md").path, timestamp: Date().addingTimeInterval(-172_800), sessionId: "expired", pathRole: .source))
        service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .write, path: directory.appendingPathComponent("Notes/Touched.md").path, timestamp: Date(), sessionId: "current"))

        let snapshot = service.currentSnapshot
        XCTAssertEqual(snapshot.workflowRetentionDays, 1)
        XCTAssertNil(snapshot.workflows.first(where: { $0.id == "session:expired" }))
        let current = try XCTUnwrap(snapshot.workflows.first(where: { $0.id == "session:current" }))
        XCTAssertEqual(current.sourcePaths, [])
        XCTAssertEqual(current.outputPaths, [])
        XCTAssertEqual(current.touchedPaths, ["Notes/Touched.md"])

        service.clearHistory()
        XCTAssertTrue(service.currentSnapshot.workflows.isEmpty)
    }

    func testPrivacyAllowlistExcludesContentBearingFields() {
        let retained = Set(AgentActivityPrivacyPreview.retainedFields)
        for forbidden in ["transcript", "prompt", "contents", "noteContent", "stdout", "stderr"] {
            XCTAssertFalse(retained.contains(forbidden))
        }
        XCTAssertTrue(AgentActivityPrivacyPreview.excludedContentDescription.contains("prompts"))
        XCTAssertTrue(AgentActivityPrivacyPreview.excludedContentDescription.contains("command output"))
    }

    @MainActor
    func testPersistedLegacyV1HistoryRestoresLiveEventsWithoutDuplicatingWorkflowTrail() async throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let configuration = AgentActivityConfiguration(eventTracingEnabled: true, fileActivityEnabled: false)
        let event = AgentActivityEvent(
            version: 1,
            agent: "codex",
            action: .write,
            path: directory.appendingPathComponent("Notes/Legacy.md").path,
            timestamp: Date(),
            sessionId: "legacy-session"
        )
        try AgentActivityTraceWriter.write(event, to: log)

        let firstLaunch = AgentActivityService(eventLogURL: log)
        firstLaunch.configureForTesting(config: configuration, vaultURL: directory)
        await firstLaunch.tailNowForTesting(initial: true)
        await firstLaunch.flushHistoryForTesting()
        XCTAssertEqual(firstLaunch.currentSnapshot.workflows.first?.trail.count, 1)

        // Emulate a pre-M4 sidecar: it has the original five-field v1 record
        // ID and no explicit retained-fingerprint list.
        let historyURL = try XCTUnwrap(
            FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)
                .first(where: { $0.lastPathComponent.hasPrefix("agent-activity-history-") })
        )
        var stored = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: historyURL)) as? [String: Any])
        var records = try XCTUnwrap(stored["records"] as? [[String: Any]])
        let logged = try XCTUnwrap(try JSONSerialization.jsonObject(with: Data(contentsOf: log)) as? [String: Any])
        let timestamp = try XCTUnwrap(logged["timestamp"] as? String)
        records[0]["id"] = [event.agent, event.action.rawValue, event.path, timestamp, ""].joined(separator: "\u{1f}")
        stored["records"] = records
        stored.removeValue(forKey: "retainedHistoryFingerprints")
        try JSONSerialization.data(withJSONObject: stored, options: [.sortedKeys]).write(to: historyURL, options: .atomic)

        let restarted = AgentActivityService(eventLogURL: log)
        restarted.configureForTesting(config: configuration, vaultURL: directory)
        await restarted.tailNowForTesting(initial: true)

        XCTAssertEqual(restarted.currentSnapshot.events.count, 1)
        XCTAssertEqual(restarted.currentSnapshot.workflows.first?.id, "session:legacy-session")
        XCTAssertEqual(restarted.currentSnapshot.workflows.first?.trail.count, 1)
        XCTAssertEqual(restarted.history(afterExclusive: nil, throughInclusive: restarted.captureHistoryCursor(), matchingNodeIDs: [], matchingRelativePaths: []).count, 1)
    }

    @MainActor
    func testBoundedLiveReplayNeverDuplicatesRetainedWorkflowHistory() async throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let log = directory.appendingPathComponent("events.jsonl")
        let configuration = AgentActivityConfiguration(eventTracingEnabled: true, fileActivityEnabled: false)
        let start = Date().addingTimeInterval(-90)
        for index in 0..<161 {
            try AgentActivityTraceWriter.write(
                AgentActivityEvent(
                    agent: "codex",
                    action: .write,
                    path: directory.appendingPathComponent("Notes/\(index).md").path,
                    timestamp: start.addingTimeInterval(TimeInterval(index) * 0.1),
                    workflowId: "bounded-replay"
                ),
                to: log
            )
        }

        let service = AgentActivityService(eventLogURL: log)
        service.configureForTesting(config: configuration, vaultURL: directory)
        await service.tailNowForTesting(initial: true)
        XCTAssertEqual(service.currentSnapshot.events.count, 80)
        XCTAssertEqual(service.currentSnapshot.workflows.first?.trail.count, 161)

        let replay = try Data(contentsOf: log)
        try replay.write(to: log, options: .atomic)
        await service.tailNowForTesting()

        XCTAssertEqual(service.currentSnapshot.workflows.first?.trail.count, 161)
        XCTAssertEqual(service.history(afterExclusive: nil, throughInclusive: service.captureHistoryCursor(), matchingNodeIDs: [], matchingRelativePaths: []).count, 161)
    }

    @MainActor
    func testWorkflowProjectionRejectsDuplicateBasenameFallbackRegardlessOfGraphOrder() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let graphDirectory = directory.appendingPathComponent("graph")
        try FileManager.default.createDirectory(at: graphDirectory, withIntermediateDirectories: true)
        let nodes = [
            ["id": "notes-plan", "label": "Notes Plan", "source_file": "Notes/Plan.md"],
            ["id": "archive-plan", "label": "Archive Plan", "source_file": "Archive/Plan.md"]
        ]

        for orderedNodes in [nodes, Array(nodes.reversed())] {
            try JSONSerialization.data(withJSONObject: ["nodes": orderedNodes]).write(to: graphDirectory.appendingPathComponent("graph.json"), options: .atomic)
            let index = AgentActivityGraphIndex.load(readAccessURL: graphDirectory)
            XCTAssertTrue(index.ambiguousFilenames.contains("plan.md"))
            XCTAssertNil(index.byFilename["plan.md"])

            let service = AgentActivityService(eventLogURL: directory.appendingPathComponent(UUID().uuidString + ".jsonl"))
            service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: directory)
            service.setGraphIndexForTesting(index)
            service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .read, path: directory.appendingPathComponent("Drafts/Plan.md").path, timestamp: Date(), workflowId: "basename"))
            service.ingestForTesting(AgentActivityEvent(agent: "codex", action: .read, path: directory.appendingPathComponent("Notes/Plan.md").path, timestamp: Date().addingTimeInterval(1), workflowId: "basename"))

            let workflow = try XCTUnwrap(service.currentSnapshot.workflows.first)
            XCTAssertEqual(workflow.nodeIds, ["notes-plan"])
            XCTAssertEqual(workflow.pendingPaths, ["Drafts/Plan.md"])
        }
    }

    @MainActor
    func testVaultScopedHistoryDoesNotProjectAcrossVaultsAndRestoresOriginalVault() async throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let vaultA = directory.appendingPathComponent("VaultA")
        let vaultB = directory.appendingPathComponent("VaultB")
        try FileManager.default.createDirectory(at: vaultA, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: vaultB, withIntermediateDirectories: true)
        let log = directory.appendingPathComponent("events.jsonl")
        let configuration = AgentActivityConfiguration(eventTracingEnabled: true, fileActivityEnabled: false)
        let node = AgentActivityGraphNode(id: "shared-plan", label: "Plan", sourceFile: "Notes/Plan.md")

        let firstA = AgentActivityService(eventLogURL: log)
        firstA.configureForTesting(config: configuration, vaultURL: vaultA)
        firstA.setGraphIndexForTesting(.init(byNodeId: [node.id: node], bySourceFile: ["notes/plan.md": node], byFilename: ["plan.md": node]))
        try AgentActivityTraceWriter.write(AgentActivityEvent(agent: "codex", action: .write, path: vaultA.appendingPathComponent("Notes/Plan.md").path, timestamp: Date(), workflowId: "vault-a", workflowTitle: "A-only"), to: log)
        await firstA.tailNowForTesting(initial: true)
        await firstA.flushHistoryForTesting()

        let vaultBService = AgentActivityService(eventLogURL: log)
        vaultBService.configureForTesting(config: configuration, vaultURL: vaultB)
        vaultBService.setGraphIndexForTesting(.init(byNodeId: [node.id: node], bySourceFile: ["notes/plan.md": node], byFilename: ["plan.md": node]))
        await vaultBService.tailNowForTesting(initial: true)
        XCTAssertTrue(vaultBService.currentSnapshot.workflows.isEmpty)
        XCTAssertTrue(vaultBService.currentSnapshot.events.isEmpty)

        let restartedA = AgentActivityService(eventLogURL: log)
        restartedA.configureForTesting(config: configuration, vaultURL: vaultA)
        restartedA.setGraphIndexForTesting(.init(byNodeId: [node.id: node], bySourceFile: ["notes/plan.md": node], byFilename: ["plan.md": node]))
        await restartedA.tailNowForTesting(initial: true)
        let restored = try XCTUnwrap(restartedA.currentSnapshot.workflows.first)
        XCTAssertEqual(restored.title, "A-only")
        XCTAssertEqual(restored.nodeIds, ["shared-plan"])
        XCTAssertEqual(restored.pendingPaths, [])
    }

    @MainActor
    func testWorkflowMetadataParticipatesInDeduplicationFingerprint() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let service = AgentActivityService(eventLogURL: directory.appendingPathComponent("events.jsonl"))
        service.configureForTesting(config: .init(eventTracingEnabled: false, fileActivityEnabled: false), vaultURL: directory)
        let timestamp = Date()
        let path = directory.appendingPathComponent("Notes/Same.md").path

        service.ingestForTesting(AgentActivityEvent(id: "first", agent: "codex", action: .read, path: path, timestamp: timestamp, workflowId: "workflow-a"))
        service.ingestForTesting(AgentActivityEvent(id: "second", agent: "codex", action: .read, path: path, timestamp: timestamp, workflowId: "workflow-b"))
        service.ingestForTesting(AgentActivityEvent(id: "duplicate", agent: "codex", action: .read, path: path, timestamp: timestamp, workflowId: "workflow-a"))

        XCTAssertEqual(service.currentSnapshot.workflows.map(\.id).sorted(), ["workflow:workflow-a", "workflow:workflow-b"])
        XCTAssertEqual(service.history(afterExclusive: nil, throughInclusive: service.captureHistoryCursor(), matchingNodeIDs: [], matchingRelativePaths: []).count, 2)
    }

    func testTraceCLIWritesSchemaV2AndRejectsInvalidPathRole() throws {
        let directory = try makeTemporaryDirectory()
        defer { removeTemporaryDirectory(directory) }
        let script = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("BrainBar/Resources/bin/brainbar-trace")
        let valid = try runTrace(script: script, home: directory, arguments: ["write", "Notes/Output.md", "--agent", "codex", "--workflow-id", "wf-1", "--workflow-title", "Workflow title", "--path-role", "output"])
        XCTAssertEqual(valid, 0)

        let log = directory.appendingPathComponent("Library/Application Support/BrainBar/agent-events.jsonl")
        let event = try XCTUnwrap(AgentActivityEventParser.parse(try String(contentsOf: log, encoding: .utf8)))
        XCTAssertEqual(event.version, 2)
        XCTAssertEqual(event.workflowId, "wf-1")
        XCTAssertEqual(event.workflowTitle, "Workflow title")
        XCTAssertEqual(event.pathRole, .output)
        XCTAssertEqual(try runTrace(script: script, home: directory, arguments: ["write", "Notes/Bad.md", "--path-role", "touched"]), 64)
    }

    private func runTrace(script: URL, home: URL, arguments: [String]) throws -> Int32 {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = [script.path] + arguments
        process.environment = ["HOME": home.path, "PATH": ProcessInfo.processInfo.environment["PATH"] ?? "/usr/bin:/bin"]
        try process.run()
        process.waitUntilExit()
        return process.terminationStatus
    }

    private func makeTemporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("BrainBarWorkflowTests-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func removeTemporaryDirectory(_ directory: URL) {
        try? FileManager.default.removeItem(at: directory)
    }
}
