import Darwin
import XCTest
@testable import BrainBar

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
    func testGraph3DPayloadIncludesNodeFileMetadata() throws {
        let vault = try temporaryDirectory()
        let graphDirectory = vault.appendingPathComponent("graphify-out")
        let noteURL = vault.appendingPathComponent("Notes/Recent.md")
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

        let script = Graph3DWebView.graphPayloadScript(readAccessURL: graphDirectory)

        XCTAssertTrue(script.contains("window.__brainBarNodeFileMetadata ="))
        XCTAssertTrue(script.contains(#""recent""#))
        XCTAssertTrue(script.contains(#""Notes\/Recent.md""#) || script.contains(#""Notes/Recent.md""#))
        XCTAssertTrue(script.contains(#""mtime""#))
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

    private func temporaryDirectory() throws -> URL {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent("BrainBarTests")
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
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
