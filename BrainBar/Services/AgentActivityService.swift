import CoreServices
import CryptoKit
import Darwin
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

    @discardableResult
    static func pruneIfNeeded(url: URL, now: Date = Date(), retentionDays: Int = 7) -> Bool {
        prune(url: url, now: now, retentionDays: retentionDays)
    }

    @discardableResult
    static func prune(url: URL, now: Date = Date(), retentionDays: Int = 7) -> Bool {
        guard let content = try? String(contentsOf: url, encoding: .utf8) else { return false }
        var lines = retainedLines(from: content, cutoff: now.addingTimeInterval(-TimeInterval(retentionDays) * 86_400))
        var data = encoded(lines)
        while data.count > maxBytes, !lines.isEmpty {
            lines.removeFirst()
            data = encoded(lines)
        }
        guard data != Data(content.utf8) else { return false }
        do {
            try data.write(to: url, options: .atomic)
            return true
        } catch {
            return false
        }
    }

    static func retainedLines(from content: String, cutoff: Date) -> [String] {
        content.split(separator: "\n", omittingEmptySubsequences: true)
            .compactMap { raw -> (String, Date)? in
                let line = String(raw)
                guard let event = AgentActivityEventParser.parse(line), event.timestamp >= cutoff else { return nil }
                return (line, event.timestamp)
            }
            .sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 > $1.1 }
            .prefix(maxLines)
            .sorted { $0.1 == $1.1 ? $0.0 < $1.0 : $0.1 < $1.1 }
            .map(\.0)
    }

    private static func encoded(_ lines: [String]) -> Data {
        lines.isEmpty ? Data() : Data((lines.joined(separator: "\n") + "\n").utf8)
    }
}

@MainActor
final class AgentActivityService {
    nonisolated private let eventLogURL: URL
    nonisolated private let historyBaseURL: URL
    private var historyURL: URL
    private var historyPersistence: AgentActivityHistoryPersistence
    private var events: [AgentActivityEvent] = []
    /// Bounded de-duplication for the live event window only.
    private var liveEventFingerprints: Set<String> = []
    /// Persistent de-duplication for every retained vault-contained history record.
    private var retainedHistoryFingerprints: Set<String> = []
    private var retainedHistoryFingerprintByRecordID: [String: String] = [:]
    private var retainedHistory: [AgentActivityHistoryRecord] = []
    private var activeVaultIdentity: String?
    private var generation = UUID()
    private var nextIngestionSequence: UInt64 = 0
    private var persistenceRevision: UInt64 = 0
    private var retainedHistoryBytes = 0
    private var graphIndex = AgentActivityGraphIndex.empty
    private var snapshotHandler: ((AgentActivitySnapshot) -> Void)?
    private var lastPublishedSnapshot: AgentActivitySnapshot?
    private var tailState = AgentActivityTailState.empty
    private var rawEventLineCount = 0
    private var oldestRawEventAt: Date?
    private var logDirectorySource: DispatchSourceFileSystemObject?
    private var logDispatchRelay: AgentActivityLogDispatchRelay?
    private var logWatcherID: UUID?
    nonisolated(unsafe) private var vaultStream: FSEventStreamRef?
    private var vaultEventContext: AgentActivityFSEventContext?
    private var tailTask: Task<Void, Never>?
    private var fileInventoryTask: Task<Void, Never>?
    private var fileProcessingTask: Task<Void, Never>?
    private var tailPending = false
    private var watcherEpoch: UInt64 = 0
    private var debounceTask: Task<Void, Never>?
    private var graphIndexLoadTask: Task<Void, Never>?
    private var knownFileState: [String: AgentActivityTrackedFileState] = [:]
    private var pendingVaultPaths = Set<String>()
    private var vaultURL: URL?
    private var config = AgentActivityConfiguration.default

    init(eventLogURL: URL = AgentActivityPaths.defaultEventLogURL, historyURL: URL? = nil) {
        self.eventLogURL = eventLogURL
        self.historyBaseURL = historyURL ?? eventLogURL.deletingLastPathComponent().appendingPathComponent("agent-activity-history.json")
        self.historyURL = historyURL ?? eventLogURL.deletingLastPathComponent().appendingPathComponent("agent-activity-history.json")
        self.historyPersistence = AgentActivityHistoryPersistence(url: self.historyURL)
    }

    deinit {
        tailTask?.cancel()
        debounceTask?.cancel()
        graphIndexLoadTask?.cancel()
        fileInventoryTask?.cancel()
        fileProcessingTask?.cancel()
        logDirectorySource?.cancel()
        logDispatchRelay = nil
        if let logWatcherID {
            Task { @MainActor in AgentActivityWatcherRegistry.removeLog(id: logWatcherID) }
        }
        if let vaultStream {
            FSEventStreamStop(vaultStream)
            FSEventStreamInvalidate(vaultStream)
            FSEventStreamRelease(vaultStream)
        }
        if let vaultWatcherID = vaultEventContext?.watcherID {
            Task { @MainActor in AgentActivityWatcherRegistry.removeVault(id: vaultWatcherID) }
        }
    }

    func start(
        config: AgentActivityConfiguration,
        vaultURL: URL?,
        graphReadAccessURL: URL?,
        snapshotHandler: @escaping (AgentActivitySnapshot) -> Void
    ) {
        stop()
        self.config = config.normalized
        self.vaultURL = vaultURL?.standardizedFileURL
        activateHistory(for: self.vaultURL)
        self.snapshotHandler = snapshotHandler
        lastPublishedSnapshot = nil
        graphIndex = .empty
        pruneRetainedHistory()
        queueHistoryPersist()
        refreshGraphIndex(graphReadAccessURL: graphReadAccessURL)
        if self.config.eventTracingEnabled {
            scheduleTail(initial: true)
            startEventLogWatcher()
        }
        if self.config.fileActivityEnabled, let vaultURL = self.vaultURL {
            startFileActivityWatcher(vaultURL: vaultURL)
        }
        publishSnapshot()
    }

    func stop() {
        watcherEpoch &+= 1
        tailTask?.cancel(); tailTask = nil
        fileInventoryTask?.cancel(); fileInventoryTask = nil
        fileProcessingTask?.cancel(); fileProcessingTask = nil
        debounceTask?.cancel(); debounceTask = nil
        graphIndexLoadTask?.cancel(); graphIndexLoadTask = nil
        logDirectorySource?.cancel(); logDirectorySource = nil; logDispatchRelay = nil
        if let logWatcherID { AgentActivityWatcherRegistry.removeLog(id: logWatcherID) }
        logWatcherID = nil
        stopVaultStream()
        pendingVaultPaths = []
        knownFileState = [:]
    }

    func refreshGraphIndex(graphReadAccessURL: URL?) {
        graphIndexLoadTask?.cancel()
        guard let graphReadAccessURL else { graphIndex = .empty; publishSnapshot(); return }
        graphIndexLoadTask = Task { [weak self] in
            let index = await Task.detached(priority: .utility) { AgentActivityGraphIndex.load(readAccessURL: graphReadAccessURL) }.value
            guard !Task.isCancelled else { return }
            self?.graphIndex = index
            self?.publishSnapshot()
        }
    }

    func writeTestEvent() throws {
        try AgentActivityTraceWriter.write(
            AgentActivityEvent(agent: "brainbar", action: .focus, path: "BrainBar Agent Activity Test", timestamp: Date(), source: "BrainBar Settings", reason: "test"),
            to: eventLogURL
        )
        scheduleTail()
    }

    var currentSnapshot: AgentActivitySnapshot { snapshot() }

    func captureHistoryCursor() -> AgentActivityCursor {
        AgentActivityCursor(generation: generation, ingestionSequence: nextIngestionSequence)
    }

    func history(
        afterExclusive: AgentActivityCursor?,
        throughInclusive: AgentActivityCursor,
        matchingNodeIDs: Set<String>,
        matchingRelativePaths: Set<String>
    ) -> [AgentActivityHistoryRecord] {
        guard throughInclusive.generation == generation else { return [] }
        let lower = afterExclusive?.generation == generation ? afterExclusive?.ingestionSequence ?? 0 : 0
        return retainedHistory.filter { record in
            guard record.ingestionSequence > lower, record.ingestionSequence <= throughInclusive.ingestionSequence else { return false }
            guard !matchingNodeIDs.isEmpty || !matchingRelativePaths.isEmpty else { return true }
            return matchingNodeIDs.contains(record.nodeId ?? "") || matchingRelativePaths.contains(record.relativePath)
        }.sorted {
            $0.ingestionSequence == $1.ingestionSequence
                ? ($0.timestamp, $0.id) < ($1.timestamp, $1.id)
                : $0.ingestionSequence < $1.ingestionSequence
        }
    }

    func clearHistory() {
        try? FileManager.default.removeItem(at: eventLogURL)
        events = []; liveEventFingerprints = []; retainedHistoryFingerprints = []; retainedHistoryFingerprintByRecordID = [:]; retainedHistory = []; retainedHistoryBytes = 0
        generation = UUID(); nextIngestionSequence = 0; tailState = .empty; tailPending = false
        rawEventLineCount = 0; oldestRawEventAt = nil
        tailTask?.cancel(); tailTask = nil
        persistenceRevision &+= 1
        let revision = persistenceRevision
        let persistence = historyPersistence
        let url = historyURL
        Task { await persistence.clear(at: revision, url: url) }
        publishSnapshot()
    }

    /// Deterministic seams used by tests; production changes arrive through native sources.
    func processEventLogChangeForTesting() { scheduleTail() }
    func processVaultPathsForTesting(_ paths: [String]) { receiveVaultEvents(paths, debounce: false) }
    func configureForTesting(config: AgentActivityConfiguration, vaultURL: URL?) {
        stop()
        self.config = config.normalized
        self.vaultURL = vaultURL?.standardizedFileURL
        activateHistory(for: self.vaultURL)
    }
    func fileActivityPathsForTesting(_ paths: [String]) -> [String] {
        guard let vaultURL else { return [] }
        return Self.fileActivityChanges(paths: Set(paths), vaultURL: vaultURL, previous: [:], config: config).changes.map(\.path)
    }
    func setGraphIndexForTesting(_ index: AgentActivityGraphIndex) { graphIndex = index }
    func flushHistoryForTesting() async {
        let stored = storedHistory()
        persistenceRevision &+= 1
        await historyPersistence.persist(stored, revision: persistenceRevision)
    }
    var monitoringStateForTesting: (eventLog: Bool, vault: Bool) { (logDirectorySource != nil, vaultStream != nil) }
    func ingestForTesting(_ event: AgentActivityEvent) { _ = addEvent(event); publishSnapshot() }
    func tailNowForTesting(initial: Bool = false) async {
        guard config.eventTracingEnabled else { return }
        let url = eventLogURL
        let state = tailState
        let result = await Task.detached(priority: .utility) { AgentActivityTailer.read(url: url, state: state) }.value
        tailState = result.state
        registerTail(result, initial: initial)
        _ = addEvents(result.events)
        rebaseAfterRawLogPruneIfNeeded(initial: initial)
        publishSnapshot()
    }

    private func startEventLogWatcher() {
        let directory = eventLogURL.deletingLastPathComponent()
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let descriptor = open(directory.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .rename, .delete], queue: .global(qos: .utility))
        let watcherID = UUID()
        logWatcherID = watcherID
        AgentActivityWatcherRegistry.installLog(id: watcherID) { [weak self] in self?.scheduleTail() }
        let relay = AgentActivityLogDispatchRelay(watcherID: watcherID, descriptor: descriptor)
        source.setEventHandler(handler: relay.signal)
        source.setCancelHandler(handler: relay.cancel)
        logDirectorySource = source
        logDispatchRelay = relay
        source.resume()
    }

    private func scheduleTail(initial: Bool = false) {
        guard config.eventTracingEnabled else { return }
        guard tailTask == nil else { tailPending = true; return }
        let state = initial ? AgentActivityTailState.empty : tailState
        let url = eventLogURL
        tailTask = Task { [weak self] in
            let result = await Task.detached(priority: .utility) { AgentActivityTailer.read(url: url, state: state) }.value
            guard !Task.isCancelled, let self else { return }
            self.tailTask = nil
            self.tailState = result.state
            self.registerTail(result, initial: initial)
            let didAdd = self.addEvents(result.events)
            self.rebaseAfterRawLogPruneIfNeeded(initial: initial)
            if didAdd { self.publishSnapshot() }
            if self.tailPending { self.tailPending = false; self.scheduleTail() }
        }
    }

    private func startFileActivityWatcher(vaultURL: URL) {
        let currentConfig = config
        let epoch = watcherEpoch
        fileInventoryTask = Task { [weak self] in
            let inventory = await Task.detached(priority: .utility) { Self.scanTrackedFiles(vaultURL: vaultURL, config: currentConfig) }.value
            guard !Task.isCancelled, let self, self.watcherEpoch == epoch, self.vaultURL == vaultURL else { return }
            self.knownFileState = inventory
            self.createVaultStream(vaultURL: vaultURL)
        }
    }

    private func createVaultStream(vaultURL: URL) {
        let watcherID = UUID()
        AgentActivityWatcherRegistry.installVault(id: watcherID) { [weak self] paths in self?.receiveVaultEvents(paths, debounce: true) }
        let callbackContext = AgentActivityFSEventContext(watcherID: watcherID)
        vaultEventContext = callbackContext
        var context = FSEventStreamContext(version: 0, info: Unmanaged.passUnretained(callbackContext).toOpaque(), retain: nil, release: nil, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents | kFSEventStreamCreateFlagIgnoreSelf)
        guard let stream = FSEventStreamCreate(kCFAllocatorDefault, agentActivityFSEventCallback, &context, [vaultURL.path] as CFArray, FSEventStreamEventId(kFSEventStreamEventIdSinceNow), 0.15, flags) else {
            AgentActivityWatcherRegistry.removeVault(id: watcherID)
            vaultEventContext = nil
            return
        }
        FSEventStreamSetDispatchQueue(stream, .global(qos: .utility))
        guard FSEventStreamStart(stream) else {
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            AgentActivityWatcherRegistry.removeVault(id: watcherID)
            vaultEventContext = nil
            return
        }
        vaultStream = stream
    }

    private func stopVaultStream() {
        guard let vaultStream else {
            if let vaultEventContext { AgentActivityWatcherRegistry.removeVault(id: vaultEventContext.watcherID) }
            vaultEventContext = nil
            return
        }
        FSEventStreamStop(vaultStream)
        FSEventStreamInvalidate(vaultStream)
        FSEventStreamRelease(vaultStream)
        self.vaultStream = nil
        if let vaultEventContext { AgentActivityWatcherRegistry.removeVault(id: vaultEventContext.watcherID) }
        vaultEventContext = nil
    }

    fileprivate func receiveVaultEvents(_ paths: [String], debounce: Bool = true) {
        pendingVaultPaths.formUnion(paths)
        debounceTask?.cancel()
        guard debounce else { processPendingVaultPaths(); return }
        debounceTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(250))
            guard !Task.isCancelled else { return }
            self?.processPendingVaultPaths()
        }
    }

    private func processPendingVaultPaths() {
        let paths = pendingVaultPaths
        pendingVaultPaths = []
        guard let vaultURL else { return }
        let previous = knownFileState
        let currentConfig = config
        let epoch = watcherEpoch
        fileProcessingTask = Task { [weak self] in
            let result = await Task.detached(priority: .utility) {
                Self.fileActivityChanges(paths: paths, vaultURL: vaultURL, previous: previous, config: currentConfig)
            }.value
            guard !Task.isCancelled, let self, self.watcherEpoch == epoch, self.vaultURL == vaultURL else { return }
            self.knownFileState = result.state
            for change in result.changes { self.addFileActivityEvent(action: change.action, path: change.path, timestamp: change.timestamp) }
            if !result.changes.isEmpty { self.publishSnapshot() }
        }
    }

    private func addFileActivityEvent(action: AgentActivityAction, path: String, timestamp: Date) {
        _ = addEvent(AgentActivityEvent(agent: "local-file", action: action, path: path, timestamp: timestamp, source: "File Activity"))
    }

    private func registerTail(_ result: AgentActivityTailReadResult, initial: Bool) {
        if initial { rawEventLineCount = 0; oldestRawEventAt = nil }
        rawEventLineCount += result.events.count
        if let oldest = result.events.map(\.timestamp).min() {
            oldestRawEventAt = min(oldestRawEventAt ?? oldest, oldest)
        }
    }

    /// Full JSONL compaction happens only when an incremental counter crosses a
    /// retention boundary; ordinary appends never reparse the complete log.
    private func rebaseAfterRawLogPruneIfNeeded(initial: Bool) {
        guard tailState.partial.isEmpty else { return }
        let size = (try? eventLogURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let isExpired = (oldestRawEventAt ?? .distantFuture) < Date().addingTimeInterval(-TimeInterval(config.retentionDays) * 86_400)
        guard initial || size > AgentActivityLogRetention.maxBytes || rawEventLineCount > AgentActivityLogRetention.maxLines || isExpired else { return }
        guard AgentActivityLogRetention.pruneIfNeeded(url: eventLogURL, retentionDays: config.retentionDays) else { return }
        let rebase = AgentActivityTailer.rebase(url: eventLogURL)
        tailState = rebase.state
        rawEventLineCount = rebase.eventCount
        oldestRawEventAt = rebase.oldestEventAt
    }

    @discardableResult
    private func addEvents(_ batch: [AgentActivityEvent]) -> Bool {
        var didAdd = false
        for event in batch { didAdd = addEvent(event, persist: false) || didAdd }
        if didAdd { pruneRetainedHistory(); queueHistoryPersist() }
        return didAdd
    }

    private func addEvent(_ event: AgentActivityEvent, persist: Bool = true) -> Bool {
        let fingerprint = AgentActivityEventParser.fingerprint(event)
        let belongsToActiveVault = vaultURL.map { Self.projectedRelativePath(event.path, vaultURL: $0) != nil } ?? true
        let addedToLiveEvents = belongsToActiveVault && liveEventFingerprints.insert(fingerprint).inserted
        if addedToLiveEvents {
            events.append(event)
            events.sort {
                $0.timestamp == $1.timestamp
                    ? $0.id < $1.id
                    : $0.timestamp > $1.timestamp
            }
            if events.count > 160 {
                events = Array(events.prefix(160))
                liveEventFingerprints = Set(events.map(AgentActivityEventParser.fingerprint))
            }
        }
        var addedToHistory = false
        if var record = historyRecord(for: event) {
            if retainedHistoryFingerprints.insert(fingerprint).inserted {
                nextIngestionSequence &+= 1
                record.ingestionSequence = nextIngestionSequence
                retainedHistory.append(record)
                retainedHistoryFingerprintByRecordID[record.id] = fingerprint
                retainedHistoryBytes += estimatedHistoryBytes(for: record)
                addedToHistory = true
                if persist { pruneRetainedHistory(); queueHistoryPersist() }
            }
        }
        return addedToLiveEvents || addedToHistory
    }

    private func historyRecord(for event: AgentActivityEvent) -> AgentActivityHistoryRecord? {
        guard let vaultURL, let relativePath = Self.projectedRelativePath(event.path, vaultURL: vaultURL) else { return nil }
        return AgentActivityHistoryRecord(id: event.id, version: event.version, agent: event.agent, action: event.action, relativePath: relativePath, timestamp: event.timestamp, sessionId: event.sessionId, project: event.project, source: event.source, reason: event.reason, nodeId: event.nodeId, status: event.status, workflowId: event.workflowId, workflowTitle: event.workflowTitle, pathRole: event.pathRole, ingestionSequence: 0)
    }

    private func pruneRetainedHistory(now: Date = Date()) {
        let cutoff = now.addingTimeInterval(-TimeInterval(config.retentionDays) * 86_400)
        retainedHistory = retainedHistory.filter { $0.timestamp >= cutoff }.sorted { $0.ingestionSequence < $1.ingestionSequence }
        if retainedHistory.count > AgentActivityLogRetention.maxLines { retainedHistory.removeFirst(retainedHistory.count - AgentActivityLogRetention.maxLines) }
        rebuildHistoryByteEstimate()
        while retainedHistoryBytes > AgentActivityLogRetention.maxBytes, let removed = retainedHistory.first {
            retainedHistory.removeFirst()
            retainedHistoryBytes -= estimatedHistoryBytes(for: removed)
        }
        let retainedRecordIDs = Set(retainedHistory.map(\.id))
        retainedHistoryFingerprintByRecordID = retainedHistoryFingerprintByRecordID.filter { retainedRecordIDs.contains($0.key) }
        retainedHistoryFingerprints = Set(retainedHistoryFingerprintByRecordID.values)
    }

    private func loadHistory() {
        guard let data = try? Data(contentsOf: historyURL), let stored = try? JSONDecoder().decode(AgentActivityStoredHistory.self, from: data) else { return }
        generation = stored.generation
        nextIngestionSequence = stored.nextIngestionSequence
        retainedHistory = stored.records
        retainedHistoryFingerprints = Set(stored.retainedHistoryFingerprints ?? stored.records.map(\.id))
        retainedHistoryFingerprintByRecordID = Dictionary(uniqueKeysWithValues: stored.records.map { ($0.id, $0.id) })
        rebuildHistoryByteEstimate()
    }

    private func queueHistoryPersist() {
        let stored = storedHistory()
        persistenceRevision &+= 1
        let revision = persistenceRevision
        let persistence = historyPersistence
        Task { await persistence.persist(stored, revision: revision) }
    }

    private func storedHistory() -> AgentActivityStoredHistory {
        AgentActivityStoredHistory(
            generation: generation,
            nextIngestionSequence: nextIngestionSequence,
            records: retainedHistory,
            retainedHistoryFingerprints: retainedHistoryFingerprints.sorted()
        )
    }

    /// Retention is scoped to a digest-named sidecar. The legacy unscoped sidecar
    /// is deliberately never read, preventing cross-vault metadata projection.
    private func activateHistory(for vaultURL: URL?) {
        guard let vaultURL else {
            activeVaultIdentity = nil
            events = []; liveEventFingerprints = []; retainedHistoryFingerprints = []; retainedHistoryFingerprintByRecordID = [:]; retainedHistory = []
            retainedHistoryBytes = 0; generation = UUID(); nextIngestionSequence = 0
            return
        }
        let identity = Self.vaultIdentity(for: vaultURL)
        guard identity != activeVaultIdentity else { return }
        activeVaultIdentity = identity
        historyURL = Self.scopedHistoryURL(baseURL: historyBaseURL, vaultIdentity: identity)
        historyPersistence = AgentActivityHistoryPersistence(url: historyURL)
        events = []; liveEventFingerprints = []; retainedHistoryFingerprints = []; retainedHistoryFingerprintByRecordID = [:]; retainedHistory = []
        retainedHistoryBytes = 0; generation = UUID(); nextIngestionSequence = 0
        loadHistory()
    }

    private nonisolated static func scopedHistoryURL(baseURL: URL, vaultIdentity: String) -> URL {
        let stem = baseURL.deletingPathExtension().lastPathComponent
        let suffix = baseURL.pathExtension
        let filename = "\(stem)-\(vaultIdentity)"
        return baseURL.deletingLastPathComponent().appendingPathComponent(filename).appendingPathExtension(suffix)
    }

    private nonisolated static func vaultIdentity(for vaultURL: URL) -> String {
        let canonicalPath = vaultURL.resolvingSymlinksInPath().standardizedFileURL.path
        return AgentActivitySHA256.hexDigest(of: Data(canonicalPath.utf8))
    }

    private func rebuildHistoryByteEstimate() {
        retainedHistoryBytes = retainedHistory.reduce(0) { $0 + estimatedHistoryBytes(for: $1) }
    }

    private func estimatedHistoryBytes(for record: AgentActivityHistoryRecord) -> Int {
        1_024 + 6 * (record.id.utf8.count + record.agent.utf8.count + record.relativePath.utf8.count
            + (record.sessionId?.utf8.count ?? 0) + (record.project?.utf8.count ?? 0)
            + (record.source?.utf8.count ?? 0) + (record.reason?.utf8.count ?? 0)
            + (record.nodeId?.utf8.count ?? 0) + (record.status?.utf8.count ?? 0))
            + (record.workflowId?.utf8.count ?? 0) + (record.workflowTitle?.utf8.count ?? 0)
    }

    private func publishSnapshot() {
        let next = snapshot()
        guard next != lastPublishedSnapshot else { return }
        lastPublishedSnapshot = next
        snapshotHandler?(next)
    }

    private func snapshot() -> AgentActivitySnapshot {
        let recent = events.filter { $0.timestamp >= Date().addingTimeInterval(-120) }.prefix(80)
        let mapped = recent.map { AgentActivityMappedEvent(event: $0, node: graphIndex.node(for: $0)) }
        let nodeIds = Array(Set(mapped.compactMap { $0.pending ? nil : $0.nodeId })).sorted().prefix(40)
        let pending = Array(Set(mapped.filter(\.pending).map(\.path))).sorted().prefix(24)
        let claude = AgentActivityClaudeInstaller()
        return AgentActivitySnapshot(events: mapped, nodeIds: Array(nodeIds), pendingPaths: Array(pending), lastEventAt: mapped.map(\.timestamp).max(), eventLogPath: eventLogURL.path, codexIntegrationInstalled: AgentActivityCodexInstaller().isInstalled(), claudeIntegrationInstalled: claude.isInstalled(), claudeIntegrationPartial: claude.isPartiallyInstalled(), tracingEnabled: config.eventTracingEnabled, workflowRetentionDays: config.retentionDays, eventSchemaVersion: 2, workflows: derivedWorkflows())
    }

    /// Groups only retained records that resolve inside the vault. An explicit
    /// `workflow_id` wins over `session_id`; records without either remain ungrouped.
    /// Trails are chronological by timestamp then stable event identity. Conflicting
    /// titles/status values use the latest nonempty declaration by that same ordering,
    /// with the declared value as a final deterministic tie-breaker.
    private func derivedWorkflows() -> [AgentActivityWorkflow] {
        let grouped = Dictionary(grouping: retainedHistory) { record -> String? in
            if let workflowId = nonempty(record.workflowId) { return "workflow:\(workflowId)" }
            if let sessionId = nonempty(record.sessionId) { return "session:\(sessionId)" }
            return nil
        }

        return grouped.compactMap { id, records in
            guard let id else { return nil }
            let trail = records.sorted(by: Self.workflowTrailOrder)
            guard let first = trail.first, let last = trail.last else { return nil }
            let sourcePaths = uniquePaths(in: trail, role: .source)
            let outputPaths = uniquePaths(in: trail, role: .output)
            let touchedPaths = uniquePaths(in: trail, role: nil)
            let graphMappings = trail.map { record in
                graphIndex.node(forVaultRelativePath: record.relativePath, nodeId: record.nodeId)
            }
            return AgentActivityWorkflow(
                id: id,
                workflowId: id.hasPrefix("workflow:") ? String(id.dropFirst("workflow:".count)) : nil,
                sessionId: id.hasPrefix("session:") ? String(id.dropFirst("session:".count)) : nil,
                title: canonicalMetadata(in: trail, keyPath: \.workflowTitle),
                status: canonicalMetadata(in: trail, keyPath: \.status),
                trail: trail,
                sourcePaths: sourcePaths,
                outputPaths: outputPaths,
                touchedPaths: touchedPaths,
                nodeIds: Array(Set(zip(trail, graphMappings).compactMap { pair in pair.1?.id ?? pair.0.nodeId })).sorted(),
                pendingPaths: Array(Set(zip(trail, graphMappings).compactMap { pair in pair.1 == nil ? pair.0.relativePath : nil })).sorted(),
                firstEventAt: first.timestamp,
                lastEventAt: last.timestamp
            )
        }.sorted {
            $0.lastEventAt == $1.lastEventAt
                ? $0.id < $1.id
                : $0.lastEventAt > $1.lastEventAt
        }
    }

    private static func workflowTrailOrder(_ lhs: AgentActivityHistoryRecord, _ rhs: AgentActivityHistoryRecord) -> Bool {
        lhs.timestamp == rhs.timestamp ? lhs.id < rhs.id : lhs.timestamp < rhs.timestamp
    }

    private func canonicalMetadata(
        in trail: [AgentActivityHistoryRecord],
        keyPath: KeyPath<AgentActivityHistoryRecord, String?>
    ) -> String? {
        trail.compactMap { record -> (Date, String, String)? in
            guard let value = nonempty(record[keyPath: keyPath]) else { return nil }
            return (record.timestamp, record.id, value)
        }.max { lhs, rhs in
            lhs.0 == rhs.0 ? (lhs.1, lhs.2) < (rhs.1, rhs.2) : lhs.0 < rhs.0
        }?.2
    }

    private func uniquePaths(in trail: [AgentActivityHistoryRecord], role: AgentActivityPathRole?) -> [String] {
        Array(Set(trail.compactMap { $0.pathRole == role ? $0.relativePath : nil })).sorted()
    }

    private func nonempty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    nonisolated static func shouldTrackFile(_ path: String, exclusions: [String] = []) -> Bool {
        let normalized = normalizeRelativePath(path)
        let components = normalized.split(separator: "/")
        guard !normalized.isEmpty, !components.contains(where: { $0.hasPrefix(".") }), !normalized.hasPrefix("graphify-out/") else { return false }
        guard normalized.hasSuffix(".md") || normalized.hasSuffix(".markdown") || normalized.hasSuffix(".txt") else { return false }
        return !exclusions.contains { globMatches(normalizeRelativePath($0), normalized) }
    }

    private nonisolated static func scanTrackedFiles(vaultURL: URL, config: AgentActivityConfiguration) -> [String: AgentActivityTrackedFileState] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey, .isRegularFileKey]
        guard let enumerator = FileManager.default.enumerator(at: vaultURL, includingPropertiesForKeys: Array(keys), options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { return [:] }
        var result: [String: AgentActivityTrackedFileState] = [:]
        for case let url as URL in enumerator {
            guard let path = relativeVaultPath(url.path, vaultURL: vaultURL), shouldTrackFile(path, exclusions: config.fileActivityExclusions) else { continue }
            let values = try? url.resourceValues(forKeys: keys)
            guard values?.isRegularFile == true else { continue }
            result[path] = AgentActivityTrackedFileState(modifiedAt: values?.contentModificationDate, fileSize: values?.fileSize)
        }
        return result
    }

    private nonisolated static func fileActivityChanges(paths: Set<String>, vaultURL: URL, previous: [String: AgentActivityTrackedFileState], config: AgentActivityConfiguration) -> AgentActivityFileActivityChangeResult {
        var state = previous
        for absolute in paths {
            let url = URL(fileURLWithPath: absolute)
            let relative = relativeVaultPath(absolute, vaultURL: vaultURL)
            if url.standardizedFileURL == vaultURL.standardizedFileURL {
                state = scanTrackedFiles(vaultURL: vaultURL, config: config)
            } else if let relative {
                let values = try? url.resourceValues(forKeys: [.isDirectoryKey, .isRegularFileKey, .contentModificationDateKey, .fileSizeKey])
                if values?.isRegularFile == true, shouldTrackFile(relative, exclusions: config.fileActivityExclusions) {
                    state[relative] = AgentActivityTrackedFileState(modifiedAt: values?.contentModificationDate, fileSize: values?.fileSize)
                } else if values?.isDirectory == true {
                    let prefix = relative + "/"
                    state = state.filter { !$0.key.hasPrefix(prefix) }
                    for (child, stamp) in scanTrackedFiles(vaultURL: url, config: config) {
                        let finalPath = normalizeRelativePath(relative + "/" + child)
                        guard shouldTrackFile(finalPath, exclusions: config.fileActivityExclusions) else { continue }
                        state[finalPath] = stamp
                    }
                } else {
                    state = state.filter { $0.key != relative && !$0.key.hasPrefix(relative + "/") }
                }
            }
        }
        let now = Date(), before = Set(previous.keys), after = Set(state.keys)
        var changes = after.subtracting(before).sorted().map { AgentActivityFileActivityChange(action: .create, path: $0, timestamp: now) }
        changes += before.subtracting(after).sorted().map { AgentActivityFileActivityChange(action: .delete, path: $0, timestamp: now) }
        changes += after.intersection(before).sorted().compactMap { state[$0] == previous[$0] ? nil : AgentActivityFileActivityChange(action: .write, path: $0, timestamp: now) }
        return AgentActivityFileActivityChangeResult(state: state, changes: changes)
    }

    private nonisolated static func relativeVaultPath(_ path: String, vaultURL: URL) -> String? {
        let absolute = URL(fileURLWithPath: path).resolvingSymlinksInPath().standardizedFileURL.path
        let root = vaultURL.resolvingSymlinksInPath().standardizedFileURL.path
        guard absolute.hasPrefix(root + "/") else { return nil }
        return normalizeRelativePath(String(absolute.dropFirst(root.count + 1)))
    }

    private nonisolated static func projectedRelativePath(_ path: String, vaultURL: URL) -> String? {
        relativeVaultPath(path.hasPrefix("/") ? path : vaultURL.appendingPathComponent(path).path, vaultURL: vaultURL)
    }
}

private struct AgentActivityTrackedFileState: Equatable, Sendable { var modifiedAt: Date?; var fileSize: Int? }
private struct AgentActivityFileActivityChange: Sendable { var action: AgentActivityAction; var path: String; var timestamp: Date }
private struct AgentActivityFileActivityChangeResult: Sendable { var state: [String: AgentActivityTrackedFileState]; var changes: [AgentActivityFileActivityChange] }
private struct AgentActivityStoredHistory: Codable {
    var generation: UUID
    var nextIngestionSequence: UInt64
    var records: [AgentActivityHistoryRecord]
    /// Optional so legacy sidecars remain decodable but are not projected.
    var retainedHistoryFingerprints: [String]?
}

private enum AgentActivitySHA256 {
    static func hexDigest(of data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }
}
private actor AgentActivityHistoryPersistence {
    private let url: URL
    private var latestRevision: UInt64 = 0

    init(url: URL) { self.url = url }

    func persist(_ stored: AgentActivityStoredHistory, revision: UInt64) {
        guard revision >= latestRevision else { return }
        latestRevision = revision
        guard let data = try? JSONEncoder().encode(stored), data.count <= AgentActivityLogRetention.maxBytes else { return }
        try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try? data.write(to: url, options: .atomic)
    }

    func clear(at revision: UInt64, url: URL) {
        guard revision >= latestRevision else { return }
        latestRevision = revision
        try? FileManager.default.removeItem(at: url)
    }
}
private struct AgentActivityTailState: Sendable { var identity: AgentActivityFileIdentity?; var offset: UInt64; var partial: Data; static let empty = Self(identity: nil, offset: 0, partial: Data()) }
private struct AgentActivityFileIdentity: Equatable, Sendable { var device: Int64; var inode: Int64 }
private struct AgentActivityTailReadResult: Sendable { var state: AgentActivityTailState; var events: [AgentActivityEvent] }
private struct AgentActivityTailRebase: Sendable { var state: AgentActivityTailState; var eventCount: Int; var oldestEventAt: Date? }
private final class AgentActivityLogDispatchRelay: @unchecked Sendable {
    private let watcherID: UUID
    private let descriptor: Int32

    init(watcherID: UUID, descriptor: Int32) {
        self.watcherID = watcherID
        self.descriptor = descriptor
    }

    nonisolated func signal() {
        let watcherID = watcherID
        Task { await AgentActivityWatcherRegistry.deliverLog(id: watcherID) }
    }

    nonisolated func cancel() {
        close(descriptor)
    }
}

private final class AgentActivityFSEventContext: @unchecked Sendable {
    let watcherID: UUID
    init(watcherID: UUID) { self.watcherID = watcherID }
}

@MainActor
private enum AgentActivityWatcherRegistry {
    static var logCallbacks: [UUID: () -> Void] = [:]
    static var vaultCallbacks: [UUID: ([String]) -> Void] = [:]

    static func installLog(id: UUID, callback: @escaping () -> Void) { logCallbacks[id] = callback }
    static func removeLog(id: UUID) { logCallbacks[id] = nil }
    static func deliverLog(id: UUID) { logCallbacks[id]?() }
    static func installVault(id: UUID, callback: @escaping ([String]) -> Void) { vaultCallbacks[id] = callback }
    static func removeVault(id: UUID) { vaultCallbacks[id] = nil }
    static func deliverVault(id: UUID, paths: [String]) { vaultCallbacks[id]?(paths) }
}

private enum AgentActivityTailer {
    static func read(url: URL, state: AgentActivityTailState) -> AgentActivityTailReadResult {
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path), let number = attributes[.size] as? NSNumber, let identity = identity(for: url) else { return .init(state: .empty, events: []) }
        var next = state
        if state.identity != identity || UInt64(number.uint64Value) < state.offset { next = .init(identity: identity, offset: 0, partial: Data()) }
        guard let handle = try? FileHandle(forReadingFrom: url) else { return .init(state: next, events: []) }
        defer { try? handle.close() }
        try? handle.seek(toOffset: next.offset)
        let suffix = (try? handle.readToEnd()) ?? Data()
        next.offset = number.uint64Value; next.identity = identity
        let all = next.partial + suffix
        let parts = all.split(separator: 0x0A, omittingEmptySubsequences: false)
        next.partial = all.last == 0x0A ? Data() : Data(parts.last ?? Data())
        let complete = all.last == 0x0A ? parts : parts.dropLast()
        return .init(state: next, events: complete.compactMap { String(data: $0, encoding: .utf8).flatMap(AgentActivityEventParser.parse) })
    }

    private static func identity(for url: URL) -> AgentActivityFileIdentity? {
        var value = stat()
        let result = url.withUnsafeFileSystemRepresentation { path in
            path.map { Darwin.lstat($0, &value) } ?? -1
        }
        guard result == 0 else { return nil }
        return AgentActivityFileIdentity(device: Int64(value.st_dev), inode: Int64(value.st_ino))
    }

    static func rebase(url: URL) -> AgentActivityTailRebase {
        guard let identity = identity(for: url), let data = try? Data(contentsOf: url) else {
            return AgentActivityTailRebase(state: .empty, eventCount: 0, oldestEventAt: nil)
        }
        let events = data.split(separator: 0x0A).compactMap { String(data: $0, encoding: .utf8).flatMap(AgentActivityEventParser.parse) }
        return AgentActivityTailRebase(
            state: AgentActivityTailState(identity: identity, offset: UInt64(data.count), partial: Data()),
            eventCount: events.count,
            oldestEventAt: events.map(\.timestamp).min()
        )
    }
}

private func agentActivityFSEventCallback(_ stream: ConstFSEventStreamRef, _ context: UnsafeMutableRawPointer?, _ count: Int, _ paths: UnsafeMutableRawPointer, _ flags: UnsafePointer<FSEventStreamEventFlags>, _ ids: UnsafePointer<FSEventStreamEventId>) {
    guard let context else { return }
    let callbackContext = Unmanaged<AgentActivityFSEventContext>.fromOpaque(context).takeUnretainedValue()
    let eventPaths = AgentActivityFSEventPathDecoder.decode(paths, count: count)
    Task { await AgentActivityWatcherRegistry.deliverVault(id: callbackContext.watcherID, paths: eventPaths) }
}

enum AgentActivityFSEventPathDecoder {
    static func decode(_ eventPaths: UnsafeMutableRawPointer, count: Int) -> [String] {
        guard count > 0 else { return [] }
        let paths = eventPaths.assumingMemoryBound(to: UnsafePointer<CChar>?.self)
        return (0..<count).compactMap { index in
            guard let path = paths[index] else { return nil }
            return String(cString: path)
        }
    }
}

private func normalizeRelativePath(_ value: String) -> String {
    value.replacingOccurrences(of: "\\", with: "/").split(separator: "/").filter { !$0.isEmpty && $0 != "." }.joined(separator: "/")
}

private func globMatches(_ pattern: String, _ value: String) -> Bool {
    var p = pattern.startIndex, v = value.startIndex, star: String.Index?, retry: String.Index?
    while v < value.endIndex {
        if p < pattern.endIndex, pattern[p] == "?" || pattern[p] == value[v] { pattern.formIndex(after: &p); value.formIndex(after: &v) }
        else if p < pattern.endIndex, pattern[p] == "*" { star = p; pattern.formIndex(after: &p); retry = v }
        else if let star, let retryIndex = retry { p = pattern.index(after: star); v = value.index(after: retryIndex); retry = v }
        else { return false }
    }
    while p < pattern.endIndex, pattern[p] == "*" { pattern.formIndex(after: &p) }
    return p == pattern.endIndex
}

enum AgentActivityEventParser {
    static func parse(_ line: String) -> AgentActivityEvent? {
        guard let data = line.data(using: .utf8), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let agent = object["agent"] as? String, let actionText = object["action"] as? String, let path = object["path"] as? String, let timestampText = object["timestamp"] as? String, !agent.isEmpty, !path.isEmpty, let timestamp = AgentActivityDateCoding.date(from: timestampText) else { return nil }
        let action = AgentActivityAction(rawValue: actionText) ?? .activity
        let version = object["version"] as? Int ?? 1
        // Schema v1 did not define workflow fields. Ignore any lookalikes so a
        // v1 record cannot be promoted into a workflow by an accidental payload.
        let workflowId = version >= 2 ? object["workflow_id"] as? String : nil
        let workflowTitle = version >= 2 ? object["workflow_title"] as? String : nil
        let pathRole = version >= 2 ? (object["path_role"] as? String).flatMap(AgentActivityPathRole.init(rawValue:)) : nil
        var event = AgentActivityEvent(id: fingerprintFields(agent: agent, action: action.rawValue, path: path, timestamp: timestampText, nodeId: object["node_id"] as? String), version: version, agent: agent, action: action, path: path, timestamp: timestamp, sessionId: object["session_id"] as? String, project: object["project"] as? String, source: object["source"] as? String, reason: object["reason"] as? String, nodeId: object["node_id"] as? String, status: object["status"] as? String, workflowId: workflowId, workflowTitle: workflowTitle, pathRole: pathRole)
        event.id = fingerprint(event)
        return event
    }

    static func fingerprint(_ event: AgentActivityEvent) -> String {
        let timestamp = AgentActivityDateCoding.string(from: event.timestamp)
        // Pre-M4 persisted v1 IDs contained only these five fields. Keep this
        // exact byte layout so an upgrade does not re-append retained history.
        guard event.version >= 2 else {
            return fingerprintFields(agent: event.agent, action: event.action.rawValue, path: event.path, timestamp: timestamp, nodeId: event.nodeId)
        }
        let v2BaseFields = [event.agent, event.action.rawValue, event.path, timestamp, event.nodeId ?? "", event.sessionId ?? "", event.project ?? "", event.source ?? "", event.reason ?? "", event.status ?? ""]
        return ([String(event.version)] + v2BaseFields + [event.workflowId ?? "", event.workflowTitle ?? "", event.pathRole?.rawValue ?? ""])
            .joined(separator: "\u{1f}")
    }
    private static func fingerprintFields(agent: String, action: String, path: String, timestamp: String, nodeId: String?) -> String { [agent, action, path, timestamp, nodeId ?? ""].joined(separator: "\u{1f}") }
}

enum AgentActivityTraceWriter {
    static func write(_ event: AgentActivityEvent, to url: URL = AgentActivityPaths.defaultEventLogURL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        var payload: [String: Any] = ["version": event.version, "agent": event.agent, "action": event.action.rawValue, "path": event.path, "timestamp": AgentActivityDateCoding.string(from: event.timestamp)]
        payload["session_id"] = event.sessionId; payload["project"] = event.project; payload["source"] = event.source; payload["reason"] = event.reason; payload["node_id"] = event.nodeId; payload["status"] = event.status
        if event.version >= 2 {
            payload["workflow_id"] = event.workflowId
            payload["workflow_title"] = event.workflowTitle
            payload["path_role"] = event.pathRole?.rawValue
        }
        let line = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys]) + Data([0x0A])
        if FileManager.default.fileExists(atPath: url.path) { let handle = try FileHandle(forWritingTo: url); try handle.seekToEnd(); try handle.write(contentsOf: line); try handle.close() } else { try line.write(to: url, options: .atomic) }
    }
}

struct AgentActivityGraphIndex: Sendable {
    var byNodeId: [String: AgentActivityGraphNode]
    var bySourceFile: [String: AgentActivityGraphNode]
    var byFilename: [String: AgentActivityGraphNode]
    var ambiguousFilenames: Set<String>

    init(
        byNodeId: [String: AgentActivityGraphNode],
        bySourceFile: [String: AgentActivityGraphNode],
        byFilename: [String: AgentActivityGraphNode],
        ambiguousFilenames: Set<String> = []
    ) {
        self.byNodeId = byNodeId
        self.bySourceFile = bySourceFile
        self.byFilename = byFilename
        self.ambiguousFilenames = ambiguousFilenames
    }

    static let empty = AgentActivityGraphIndex(byNodeId: [:], bySourceFile: [:], byFilename: [:])

    static func load(readAccessURL: URL) -> AgentActivityGraphIndex {
        let url = readAccessURL.appendingPathComponent("graph.json")
        guard let data = try? Data(contentsOf: url), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let nodes = object["nodes"] as? [[String: Any]] else { return .empty }
        var ids: [String: AgentActivityGraphNode] = [:], paths: [String: AgentActivityGraphNode] = [:], names: [String: AgentActivityGraphNode] = [:]
        var ambiguousNames = Set<String>()
        for object in nodes {
            guard let value = object["id"] else { continue }
            let id = String(describing: value), source = (object["source_file"] as? String) ?? (object["_source_file"] as? String) ?? (object["path"] as? String)
            let node = AgentActivityGraphNode(id: id, label: (object["label"] as? String) ?? id, sourceFile: source)
            ids[id] = node
            if let source, !source.isEmpty {
                paths[normalize(source)] = paths[normalize(source)] ?? node
                let filename = URL(fileURLWithPath: source).lastPathComponent.lowercased()
                if let existing = names[filename], existing.id != node.id {
                    names[filename] = nil
                    ambiguousNames.insert(filename)
                } else if !ambiguousNames.contains(filename) {
                    names[filename] = node
                }
            }
        }
        return AgentActivityGraphIndex(byNodeId: ids, bySourceFile: paths, byFilename: names, ambiguousFilenames: ambiguousNames)
    }

    func node(for event: AgentActivityEvent) -> AgentActivityGraphNode? {
        node(forPath: event.path, nodeId: event.nodeId)
    }

    func node(forPath path: String, nodeId: String?) -> AgentActivityGraphNode? {
        if let nodeId, let node = byNodeId[nodeId] { return node }
        return bySourceFile[Self.normalize(path)] ?? byFilename[URL(fileURLWithPath: path).lastPathComponent.lowercased()]
    }

    /// Retained workflow paths are already vault-relative, so a basename match
    /// could incorrectly claim a role for a different same-named note.
    func node(forVaultRelativePath path: String, nodeId: String?) -> AgentActivityGraphNode? {
        if let nodeId, let node = byNodeId[nodeId] { return node }
        return bySourceFile[Self.normalize(path)]
    }

    private static func normalize(_ path: String) -> String { path.replacingOccurrences(of: "\\", with: "/").trimmingCharacters(in: CharacterSet(charactersIn: "/")).lowercased() }
}

enum AgentActivityDateCoding {
    private static let lock = NSLock()
    nonisolated(unsafe) private static let fractional: ISO8601DateFormatter = { let value = ISO8601DateFormatter(); value.formatOptions = [.withInternetDateTime, .withFractionalSeconds]; return value }()
    nonisolated(unsafe) private static let standard: ISO8601DateFormatter = { let value = ISO8601DateFormatter(); value.formatOptions = [.withInternetDateTime]; return value }()
    static func date(from text: String) -> Date? { lock.lock(); defer { lock.unlock() }; return fractional.date(from: text) ?? standard.date(from: text) }
    static func string(from date: Date) -> String { lock.lock(); defer { lock.unlock() }; return fractional.string(from: date) }
}
