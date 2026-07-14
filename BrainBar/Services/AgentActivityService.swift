import Foundation

enum AgentActivityPaths {
    static var defaultEventLogURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("BrainBar", isDirectory: true).appendingPathComponent("agent-events.jsonl")
    }
}

enum AgentActivityLogRetention {
    static let maxBytes = 5 * 1_024 * 1_024
    static let maxLines = 10_000
    static let maxAge: TimeInterval = 7 * 24 * 60 * 60

    static func pruneIfNeeded(url: URL, now: Date = Date()) {
        guard shouldPrune(url: url) else {
            return
        }
        prune(url: url, now: now)
    }

    static func prune(url: URL, now: Date = Date()) {
        guard
            let data = try? Data(contentsOf: url),
            !data.isEmpty,
            let content = String(data: data, encoding: .utf8)
        else {
            return
        }
        let cutoff = now.addingTimeInterval(-maxAge)
        let retained = retainedLines(from: content, cutoff: cutoff)
        let output = retained.isEmpty ? Data() : Data((retained.joined(separator: "\n") + "\n").utf8)
        try? output.write(to: url, options: .atomic)
    }

    static func retainedLines(from content: String, cutoff: Date) -> [String] {
        let recentLines = content
            .split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { rawLine -> (line: String, timestamp: Date)? in
                let line = String(rawLine)
                guard let event = AgentActivityEventParser.parse(line), event.timestamp >= cutoff else {
                    return nil
                }
                return (line, event.timestamp)
            }
            .sorted { lhs, rhs in
                if lhs.timestamp == rhs.timestamp {
                    return lhs.line < rhs.line
                }
                return lhs.timestamp > rhs.timestamp
            }
            .prefix(maxLines)
        return recentLines
            .sorted { lhs, rhs in
                if lhs.timestamp == rhs.timestamp {
                    return lhs.line < rhs.line
                }
                return lhs.timestamp < rhs.timestamp
            }
            .map(\.line)
    }

    private static func shouldPrune(url: URL) -> Bool {
        guard
            let values = try? url.resourceValues(forKeys: [.fileSizeKey]),
            let fileSize = values.fileSize
        else {
            return false
        }
        return fileSize > maxBytes
    }
}

@MainActor
final class AgentActivityService {
    private let eventLogURL: URL
    private var events: [AgentActivityEvent] = []
    private var eventFingerprints: Set<String> = []
    private var graphIndex = AgentActivityGraphIndex.empty
    private var snapshotHandler: ((AgentActivitySnapshot) -> Void)?
    private var lastPublishedSnapshot: AgentActivitySnapshot?
    private var eventLogStamp: AgentActivityFileStamp?
    private var eventLogWatcherTask: Task<Void, Never>?
    private var fileActivityWatcherTask: Task<Void, Never>?
    private var graphIndexLoadTask: Task<Void, Never>?
    private var knownFileState: [String: Date] = [:]
    private var config: AgentActivityConfiguration = .default

    init(eventLogURL: URL = AgentActivityPaths.defaultEventLogURL) {
        self.eventLogURL = eventLogURL
    }

    deinit {
        eventLogWatcherTask?.cancel()
        fileActivityWatcherTask?.cancel()
        graphIndexLoadTask?.cancel()
    }

    func start(
        config: AgentActivityConfiguration,
        vaultURL: URL?,
        graphReadAccessURL: URL?,
        snapshotHandler: @escaping (AgentActivitySnapshot) -> Void
    ) {
        stop()
        self.config = config.normalized
        self.snapshotHandler = snapshotHandler
        lastPublishedSnapshot = nil
        eventLogStamp = nil
        graphIndex = .empty
        refreshGraphIndex(graphReadAccessURL: graphReadAccessURL)
        readEventLog(force: true)
        startEventLogWatcherIfNeeded()
        if config.fileActivityEnabled, let vaultURL {
            startFileActivityWatcher(vaultURL: vaultURL.standardizedFileURL)
        }
        publishSnapshot()
    }

    func stop() {
        eventLogWatcherTask?.cancel()
        eventLogWatcherTask = nil
        fileActivityWatcherTask?.cancel()
        fileActivityWatcherTask = nil
        graphIndexLoadTask?.cancel()
        graphIndexLoadTask = nil
        knownFileState = [:]
    }

    func refreshGraphIndex(graphReadAccessURL: URL?) {
        graphIndexLoadTask?.cancel()
        graphIndexLoadTask = nil
        guard let graphReadAccessURL else {
            graphIndex = .empty
            publishSnapshot()
            return
        }

        graphIndexLoadTask = Task { [weak self] in
            let index = await Task.detached(priority: .utility) {
                AgentActivityGraphIndex.load(readAccessURL: graphReadAccessURL)
            }.value
            guard !Task.isCancelled else {
                return
            }
            self?.graphIndex = index
            self?.publishSnapshot()
        }
    }

    func writeTestEvent() throws {
        try AgentActivityTraceWriter.write(
            AgentActivityEvent(
                agent: "brainbar",
                action: .focus,
                path: "BrainBar Agent Activity Test",
                timestamp: Date(),
                source: "BrainBar Settings",
                reason: "test"
            ),
            to: eventLogURL
        )
        readEventLog(force: true)
        publishSnapshot()
    }

    var currentSnapshot: AgentActivitySnapshot {
        snapshot()
    }

    private func startEventLogWatcherIfNeeded() {
        guard config.eventTracingEnabled else {
            return
        }
        eventLogWatcherTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(1))
                await MainActor.run {
                    guard self?.readEventLog() == true else {
                        return
                    }
                    self?.publishSnapshot()
                }
            }
        }
    }

    private func startFileActivityWatcher(vaultURL: URL) {
        fileActivityWatcherTask = Task { [weak self] in
            let initialState = await Self.scanTrackedFilesAsync(vaultURL: vaultURL)
            await MainActor.run {
                self?.knownFileState = initialState
            }
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(2))
                let nextState = await Self.scanTrackedFilesAsync(vaultURL: vaultURL)
                await MainActor.run {
                    self?.applyFileActivityState(nextState)
                }
            }
        }
    }

    private func applyFileActivityState(_ nextState: [String: Date]) {
        guard nextState != knownFileState else {
            return
        }
        let now = Date()
        let previousPaths = Set(knownFileState.keys)
        let nextPaths = Set(nextState.keys)
        for path in nextPaths.subtracting(previousPaths).sorted() {
            addFileActivityEvent(action: .create, path: path, timestamp: now)
        }
        for path in previousPaths.subtracting(nextPaths).sorted() {
            addFileActivityEvent(action: .delete, path: path, timestamp: now)
        }
        for path in nextPaths.intersection(previousPaths).sorted() where nextState[path] != knownFileState[path] {
            addFileActivityEvent(action: .write, path: path, timestamp: now)
        }
        knownFileState = nextState
        publishSnapshot()
    }

    private func addFileActivityEvent(action: AgentActivityAction, path: String, timestamp: Date) {
        addEvent(
            AgentActivityEvent(
                agent: "local-file",
                action: action,
                path: path,
                timestamp: timestamp,
                source: "File Activity"
            )
        )
    }

    private nonisolated static func scanTrackedFilesAsync(vaultURL: URL) async -> [String: Date] {
        await Task.detached(priority: .utility) {
            scanTrackedFiles(vaultURL: vaultURL)
        }.value
    }

    private nonisolated static func scanTrackedFiles(vaultURL: URL) -> [String: Date] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .isRegularFileKey]
        guard let enumerator = FileManager.default.enumerator(
            at: vaultURL,
            includingPropertiesForKeys: Array(keys),
            options: [.skipsHiddenFiles, .skipsPackageDescendants]
        ) else {
            return [:]
        }
        var result: [String: Date] = [:]
        for case let fileURL as URL in enumerator {
            guard let relativePath = relativeVaultPath(fileURL.path, vaultURL: vaultURL),
                  shouldTrackFile(relativePath)
            else {
                continue
            }
            let values = try? fileURL.resourceValues(forKeys: keys)
            guard values?.isRegularFile == true, let modifiedAt = values?.contentModificationDate else {
                continue
            }
            result[relativePath] = modifiedAt
        }
        return result
    }

    private nonisolated static func shouldTrackFile(_ path: String) -> Bool {
        guard !path.isEmpty,
              !path.hasPrefix(".git/"),
              !path.hasPrefix("graphify-out/"),
              !path.hasPrefix(".brainbar/")
        else {
            return false
        }
        return path.hasSuffix(".md") || path.hasSuffix(".markdown") || path.hasSuffix(".txt")
    }

    private nonisolated static func relativeVaultPath(_ path: String, vaultURL: URL) -> String? {
        let absolutePath = URL(fileURLWithPath: path).standardizedFileURL.path
        let vaultPath = vaultURL.standardizedFileURL.path
        guard absolutePath == vaultPath || absolutePath.hasPrefix(vaultPath + "/") else {
            return nil
        }
        if absolutePath == vaultPath {
            return nil
        }
        return String(absolutePath.dropFirst(vaultPath.count + 1))
    }

    @discardableResult
    private func readEventLog(force: Bool = false) -> Bool {
        guard config.eventTracingEnabled else {
            return false
        }
        let stamp = Self.fileStamp(for: eventLogURL)
        guard force || stamp != eventLogStamp else {
            return false
        }
        eventLogStamp = stamp
        guard
              let data = try? Data(contentsOf: eventLogURL),
              let content = String(data: data, encoding: .utf8)
        else {
            return false
        }
        AgentActivityLogRetention.pruneIfNeeded(url: eventLogURL)
        var didAddEvent = false
        for line in content.split(separator: "\n") {
            guard let event = AgentActivityEventParser.parse(String(line)) else {
                continue
            }
            didAddEvent = addEvent(event) || didAddEvent
        }
        return didAddEvent
    }

    @discardableResult
    private func addEvent(_ event: AgentActivityEvent) -> Bool {
        let fingerprint = AgentActivityEventParser.fingerprint(event)
        guard !eventFingerprints.contains(fingerprint) else {
            return false
        }
        eventFingerprints.insert(fingerprint)
        events.append(event)
        events.sort { $0.timestamp > $1.timestamp }
        if events.count > 160 {
            events = Array(events.prefix(160))
            eventFingerprints = Set(events.map(AgentActivityEventParser.fingerprint))
        }
        return true
    }

    private func publishSnapshot() {
        let nextSnapshot = snapshot()
        guard nextSnapshot != lastPublishedSnapshot else {
            return
        }
        lastPublishedSnapshot = nextSnapshot
        snapshotHandler?(nextSnapshot)
    }

    private func snapshot() -> AgentActivitySnapshot {
        let cutoff = Date().addingTimeInterval(-120)
        let recentEvents = events
            .filter { $0.timestamp >= cutoff }
            .prefix(80)
        let mapped = recentEvents.map { event in
            AgentActivityMappedEvent(event: event, node: graphIndex.node(for: event))
        }
        let nodeIds = Array(
            Set(mapped.compactMap { $0.pending ? nil : $0.nodeId })
        )
        .sorted()
        .prefix(40)
        let pendingPaths = Array(
            Set(mapped.filter(\.pending).map(\.path))
        )
        .sorted()
        let claudeInstaller = AgentActivityClaudeInstaller()
        return AgentActivitySnapshot(
            events: mapped,
            nodeIds: Array(nodeIds),
            pendingPaths: Array(pendingPaths.prefix(24)),
            lastEventAt: mapped.map(\.timestamp).max(),
            eventLogPath: eventLogURL.path,
            codexIntegrationInstalled: AgentActivityCodexInstaller().isInstalled(),
            claudeIntegrationInstalled: claudeInstaller.isInstalled(),
            claudeIntegrationPartial: claudeInstaller.isPartiallyInstalled(),
            tracingEnabled: config.eventTracingEnabled
        )
    }

    private nonisolated static func fileStamp(for url: URL) -> AgentActivityFileStamp {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        return AgentActivityFileStamp(
            modifiedAt: values?.contentModificationDate,
            fileSize: values?.fileSize
        )
    }
}

private struct AgentActivityFileStamp: Equatable {
    var modifiedAt: Date?
    var fileSize: Int?
}

enum AgentActivityEventParser {
    static func parse(_ line: String) -> AgentActivityEvent? {
        guard
            let data = line.data(using: .utf8),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let agent = object["agent"] as? String,
            let actionText = object["action"] as? String,
            let path = object["path"] as? String,
            let timestampText = object["timestamp"] as? String,
            !agent.isEmpty,
            !path.isEmpty,
            let timestamp = AgentActivityDateCoding.date(from: timestampText)
        else {
            return nil
        }
        let action = AgentActivityAction(rawValue: actionText) ?? .activity
        return AgentActivityEvent(
            id: fingerprintFields(agent: agent, action: action.rawValue, path: path, timestamp: timestampText, nodeId: object["node_id"] as? String),
            version: object["version"] as? Int ?? 1,
            agent: agent,
            action: action,
            path: path,
            timestamp: timestamp,
            sessionId: object["session_id"] as? String,
            project: object["project"] as? String,
            source: object["source"] as? String,
            reason: object["reason"] as? String,
            nodeId: object["node_id"] as? String,
            status: object["status"] as? String
        )
    }

    static func fingerprint(_ event: AgentActivityEvent) -> String {
        fingerprintFields(
            agent: event.agent,
            action: event.action.rawValue,
            path: event.path,
            timestamp: AgentActivityDateCoding.string(from: event.timestamp),
            nodeId: event.nodeId
        )
    }

    private static func fingerprintFields(agent: String, action: String, path: String, timestamp: String, nodeId: String?) -> String {
        [agent, action, path, timestamp, nodeId ?? ""].joined(separator: "\u{1f}")
    }
}

enum AgentActivityTraceWriter {
    static func write(_ event: AgentActivityEvent, to url: URL = AgentActivityPaths.defaultEventLogURL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var payload: [String: Any] = [
            "version": event.version,
            "agent": event.agent,
            "action": event.action.rawValue,
            "path": event.path,
            "timestamp": AgentActivityDateCoding.string(from: event.timestamp)
        ]
        payload["session_id"] = event.sessionId
        payload["project"] = event.project
        payload["source"] = event.source
        payload["reason"] = event.reason
        payload["node_id"] = event.nodeId
        payload["status"] = event.status
        let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
        let line = data + Data([0x0a])
        if FileManager.default.fileExists(atPath: url.path) {
            let handle = try FileHandle(forWritingTo: url)
            try handle.seekToEnd()
            try handle.write(contentsOf: line)
            try handle.close()
        } else {
            try line.write(to: url, options: .atomic)
        }
        AgentActivityLogRetention.pruneIfNeeded(url: url)
    }
}

struct AgentActivityGraphIndex: Sendable {
    var byNodeId: [String: AgentActivityGraphNode]
    var bySourceFile: [String: AgentActivityGraphNode]
    var byFilename: [String: AgentActivityGraphNode]

    static let empty = AgentActivityGraphIndex(byNodeId: [:], bySourceFile: [:], byFilename: [:])

    static func load(readAccessURL: URL) -> AgentActivityGraphIndex {
        let graphJSONURL = readAccessURL.appendingPathComponent("graph.json")
        guard
            let data = try? Data(contentsOf: graphJSONURL),
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let nodes = object["nodes"] as? [[String: Any]]
        else {
            return .empty
        }
        var byNodeId: [String: AgentActivityGraphNode] = [:]
        var bySourceFile: [String: AgentActivityGraphNode] = [:]
        var byFilename: [String: AgentActivityGraphNode] = [:]
        for nodeObject in nodes {
            guard let idValue = nodeObject["id"] else {
                continue
            }
            let id = String(describing: idValue)
            let label = (nodeObject["label"] as? String) ?? id
            let sourceFile = (nodeObject["source_file"] as? String) ?? (nodeObject["_source_file"] as? String) ?? (nodeObject["path"] as? String)
            let node = AgentActivityGraphNode(id: id, label: label, sourceFile: sourceFile)
            byNodeId[id] = node
            if let sourceFile, !sourceFile.isEmpty {
                let sourceKey = normalize(sourceFile)
                if shouldPrefer(node: node, over: bySourceFile[sourceKey], sourceFile: sourceFile, nodeObject: nodeObject) {
                    bySourceFile[sourceKey] = node
                }
                let filenameKey = URL(fileURLWithPath: sourceFile).lastPathComponent.lowercased()
                if shouldPrefer(node: node, over: byFilename[filenameKey], sourceFile: sourceFile, nodeObject: nodeObject) {
                    byFilename[filenameKey] = node
                }
            }
        }
        return AgentActivityGraphIndex(byNodeId: byNodeId, bySourceFile: bySourceFile, byFilename: byFilename)
    }

    func node(for event: AgentActivityEvent) -> AgentActivityGraphNode? {
        if let nodeId = event.nodeId, let node = byNodeId[nodeId] {
            return node
        }
        if let node = bySourceFile[Self.normalize(event.path)] {
            return node
        }
        return byFilename[URL(fileURLWithPath: event.path).lastPathComponent.lowercased()]
    }

    private static func normalize(_ path: String) -> String {
        path.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased()
    }

    private static func shouldPrefer(
        node: AgentActivityGraphNode,
        over current: AgentActivityGraphNode?,
        sourceFile: String,
        nodeObject: [String: Any]
    ) -> Bool {
        guard let current else {
            return true
        }
        return mappingScore(node: node, sourceFile: sourceFile, nodeObject: nodeObject) < mappingScore(
            node: current,
            sourceFile: sourceFile,
            nodeObject: [:]
        )
    }

    private static func mappingScore(node: AgentActivityGraphNode, sourceFile: String, nodeObject: [String: Any]) -> Int {
        let basename = URL(fileURLWithPath: sourceFile).deletingPathExtension().lastPathComponent.lowercased()
        let filename = URL(fileURLWithPath: sourceFile).lastPathComponent.lowercased()
        let label = node.label.lowercased()
        var score = 20
        if label == basename || label == filename {
            score -= 16
        }
        if (nodeObject["source_location"] as? String) == "L1" {
            score -= 8
        }
        if ["links", "summary", "checks", "blockers", "commit", "promoted", "archived"].contains(label) {
            score += 12
        }
        return score
    }
}

enum AgentActivityDateCoding {
    static func date(from text: String) -> Date? {
        fractionalFormatter.date(from: text) ?? standardFormatter.date(from: text)
    }

    static func string(from date: Date) -> String {
        fractionalFormatter.string(from: date)
    }

    private static var fractionalFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }

    private static var standardFormatter: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }
}
