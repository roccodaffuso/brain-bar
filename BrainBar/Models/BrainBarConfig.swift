import Foundation

struct BrainBarConfig: Codable, Equatable, Sendable {
    var vaultPath: String
    var projectDashboardRelativePath: String
    var graphHtmlRelativePath: String
    var graphReportRelativePath: String
    var serverPort: Int
    var useObsidianURLScheme: Bool
    var notificationsEnabled: Bool
    var commands: CommandConfiguration
    var reviewQueue: ReviewQueueConfiguration
    var agentActivity: AgentActivityConfiguration

    static let `default` = BrainBarConfig(
        vaultPath: "",
        projectDashboardRelativePath: "Project Dashboard.md",
        graphHtmlRelativePath: "graphify-out/graph.html",
        graphReportRelativePath: "graphify-out/GRAPH_REPORT.md",
        serverPort: 8765,
        useObsidianURLScheme: false,
        notificationsEnabled: false,
        commands: CommandConfiguration(
            refreshGraph: CommandSpec(
                executable: "graphify",
                arguments: ["update", "."],
                workingDirectory: "vault"
            ),
            brainCheck: nil
        ),
        reviewQueue: .default,
        agentActivity: .default
    )

    enum CodingKeys: String, CodingKey {
        case vaultPath
        case projectDashboardRelativePath
        case graphHtmlRelativePath
        case graphReportRelativePath
        case serverPort
        case useObsidianURLScheme
        case notificationsEnabled
        case commands
        case reviewQueue
        case agentActivity
    }

    init(
        vaultPath: String,
        projectDashboardRelativePath: String,
        graphHtmlRelativePath: String,
        graphReportRelativePath: String,
        serverPort: Int,
        useObsidianURLScheme: Bool,
        notificationsEnabled: Bool,
        commands: CommandConfiguration,
        reviewQueue: ReviewQueueConfiguration,
        agentActivity: AgentActivityConfiguration
    ) {
        self.vaultPath = vaultPath
        self.projectDashboardRelativePath = projectDashboardRelativePath
        self.graphHtmlRelativePath = graphHtmlRelativePath
        self.graphReportRelativePath = graphReportRelativePath
        self.serverPort = serverPort
        self.useObsidianURLScheme = useObsidianURLScheme
        self.notificationsEnabled = notificationsEnabled
        self.commands = commands
        self.reviewQueue = reviewQueue
        self.agentActivity = agentActivity
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        vaultPath = try container.decode(String.self, forKey: .vaultPath)
        projectDashboardRelativePath = try container.decode(String.self, forKey: .projectDashboardRelativePath)
        graphHtmlRelativePath = try container.decode(String.self, forKey: .graphHtmlRelativePath)
        graphReportRelativePath = try container.decode(String.self, forKey: .graphReportRelativePath)
        serverPort = try container.decode(Int.self, forKey: .serverPort)
        useObsidianURLScheme = try container.decode(Bool.self, forKey: .useObsidianURLScheme)
        notificationsEnabled = try container.decode(Bool.self, forKey: .notificationsEnabled)
        commands = try container.decode(CommandConfiguration.self, forKey: .commands)
        reviewQueue = try container.decodeIfPresent(ReviewQueueConfiguration.self, forKey: .reviewQueue) ?? .default
        agentActivity = try container.decodeIfPresent(AgentActivityConfiguration.self, forKey: .agentActivity) ?? .default
    }
}

struct CommandConfiguration: Codable, Equatable, Sendable {
    var refreshGraph: CommandSpec
    var brainCheck: CommandSpec?

    enum CodingKeys: String, CodingKey {
        case refreshGraph
        case brainCheck
    }

    init(refreshGraph: CommandSpec, brainCheck: CommandSpec?) {
        self.refreshGraph = refreshGraph
        self.brainCheck = brainCheck
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        refreshGraph = try container.decode(CommandSpec.self, forKey: .refreshGraph)
        brainCheck = try container.decodeIfPresent(CommandSpec.self, forKey: .brainCheck)
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(refreshGraph, forKey: .refreshGraph)
        if let brainCheck {
            try container.encode(brainCheck, forKey: .brainCheck)
        } else {
            try container.encodeNil(forKey: .brainCheck)
        }
    }
}

extension BrainBarConfig {
    func normalized() -> BrainBarConfig {
        var config = self
        if config.commands.refreshGraph.executable == "graphify",
           config.commands.refreshGraph.arguments == ["--update", "."] {
            config.commands.refreshGraph.arguments = ["update", "."]
        }
        config.reviewQueue = config.reviewQueue.normalized
        config.agentActivity = config.agentActivity.normalized
        return config
    }
}

struct CommandSpec: Codable, Equatable, Sendable {
    var executable: String
    var arguments: [String]
    var workingDirectory: String?
}

struct ReviewQueueConfiguration: Codable, Equatable, Sendable {
    var isEnabled: Bool
    var preflightCommand: CommandSpec?
    var manualCommand: CommandSpec?
    var backgroundWatcherEnabled: Bool
    var watcherIntervalSeconds: Int
    var timeoutSeconds: Int

    static let `default` = ReviewQueueConfiguration(
        isEnabled: false,
        preflightCommand: nil,
        manualCommand: nil,
        backgroundWatcherEnabled: false,
        watcherIntervalSeconds: 300,
        timeoutSeconds: 10
    )

    var normalized: ReviewQueueConfiguration {
        var configuration = self
        configuration.watcherIntervalSeconds = max(300, watcherIntervalSeconds)
        configuration.timeoutSeconds = min(max(1, timeoutSeconds), 60)
        if !isEnabled {
            configuration.backgroundWatcherEnabled = false
        }
        return configuration
    }
}

struct AgentActivityConfiguration: Codable, Equatable, Sendable {
    var eventTracingEnabled: Bool
    var fileActivityEnabled: Bool

    static let `default` = AgentActivityConfiguration(
        eventTracingEnabled: false,
        fileActivityEnabled: true
    )

    var normalized: AgentActivityConfiguration {
        self
    }
}

struct ReviewQueueItem: Codable, Equatable, Identifiable, Sendable {
    var id: String
    var title: String
    var detail: String?
    var sourceFile: String?
    var nodeId: String?

    init(id: String, title: String, detail: String?, sourceFile: String? = nil, nodeId: String? = nil) {
        self.id = id
        self.title = title
        self.detail = detail
        self.sourceFile = sourceFile
        self.nodeId = nodeId
    }
}

struct ReviewQueueStatus: Equatable, Sendable {
    var pendingCount: Int?
    var items: [ReviewQueueItem]
    var lastCheckedAt: Date?
    var errorMessage: String?

    static let empty = ReviewQueueStatus(
        pendingCount: nil,
        items: [],
        lastCheckedAt: nil,
        errorMessage: nil
    )

    var summary: String {
        if let errorMessage, !errorMessage.isEmpty {
            return errorMessage
        }
        guard let pendingCount else {
            return "Not checked"
        }
        if pendingCount == 0 {
            return "Review Queue clear"
        }
        return pendingCount == 1 ? "1 pending item" : "\(pendingCount) pending items"
    }
}

struct CommandResult: Equatable, Sendable {
    var commandName: String
    var exitCode: Int32
    var stdout: String
    var stderr: String
    var startedAt: Date
    var finishedAt: Date

    var duration: TimeInterval {
        finishedAt.timeIntervalSince(startedAt)
    }

    var succeeded: Bool {
        exitCode == 0
    }

    var summary: String {
        if succeeded {
            return "Succeeded in \(duration.formattedSeconds)"
        }

        let message = stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        if message.isEmpty {
            return "Failed with exit code \(exitCode)"
        }
        return "Failed: \(message)"
    }
}

struct VaultStatus: Equatable, Sendable {
    var vaultPath: String
    var vaultExists: Bool
    var dashboardExists: Bool
    var graphHtmlExists: Bool
    var graphHtmlModifiedAt: Date?
    var graphJSONExists: Bool
    var graphJSONModifiedAt: Date?
    var graphReportExists: Bool
    var gitBranch: String?
    var gitDirty: Bool?

    static let empty = VaultStatus(
        vaultPath: "",
        vaultExists: false,
        dashboardExists: false,
        graphHtmlExists: false,
        graphHtmlModifiedAt: nil,
        graphJSONExists: false,
        graphJSONModifiedAt: nil,
        graphReportExists: false,
        gitBranch: nil,
        gitDirty: nil
    )

    var graphOutputExists: Bool {
        graphJSONExists || graphHtmlExists
    }

    var graphOutputModifiedAt: Date? {
        [graphJSONModifiedAt, graphHtmlModifiedAt]
            .compactMap { $0 }
            .max()
    }

    var gitDescription: String {
        guard let gitDirty else {
            return "Vault · no Git"
        }
        let branch = gitBranch?.isEmpty == false ? gitBranch! : "detached"
        return gitDirty ? "Vault · \(branch) · changes" : "Vault · \(branch) · clean"
    }
}

struct GraphNodeOpenRequest: Equatable, Sendable {
    var action: String
    var nodeId: String
    var label: String
    var sourceFile: String?
    var communityId: String?
    var targetNodeId: String?
}

enum BrainBarError: LocalizedError, Equatable, Sendable {
    case vaultNotConfigured
    case vaultMissing(String)
    case fileMissing(String)
    case graphNodeSourceMissing
    case graphNodeSourceOutsideVault(String)
    case graphNodeSourceFileMissing(String)
    case commandNotConfigured(String)
    case commandTimedOut(String, Int)
    case invalidPort(Int)
    case portBusy(Int)
    case processFailed(String)

    var errorDescription: String? {
        switch self {
        case .vaultNotConfigured:
            return "Vault path is not configured."
        case .vaultMissing(let path):
            return "Vault path does not exist: \(path)"
        case .fileMissing(let path):
            return "File does not exist: \(path)"
        case .graphNodeSourceMissing:
            return "This graph node does not include a source file."
        case .graphNodeSourceOutsideVault(let path):
            return "Graph node source is outside the configured vault: \(path)"
        case .graphNodeSourceFileMissing(let path):
            return "Source file does not exist: \(path)"
        case .commandNotConfigured(let name):
            return "\(name) is not configured."
        case .commandTimedOut(let name, let seconds):
            return "\(name) timed out after \(seconds)s."
        case .invalidPort(let port):
            return "Invalid server port: \(port)"
        case .portBusy(let port):
            return "Port \(port) is already in use by another process."
        case .processFailed(let message):
            return message
        }
    }
}

extension TimeInterval {
    var formattedSeconds: String {
        String(format: "%.1fs", self)
    }
}

extension Date {
    var formattedRelative: String {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: self, relativeTo: Date())
    }
}
