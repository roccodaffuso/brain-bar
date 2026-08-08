import Foundation

enum AgentActivityClaudeInstallStatus: Equatable, Sendable {
    case installed
    case partial
    case claudeDirectoryMissing
    case existingUnmanagedSkill

    var message: String {
        switch self {
        case .installed:
            return "Claude integration installed"
        case .partial:
            return "Claude instructions installed; skill source directory not found"
        case .claudeDirectoryMissing:
            return "Claude directory not found"
        case .existingUnmanagedSkill:
            return "A non-BrainBar Claude skill already exists at this path"
        }
    }
}

enum AgentActivityClaudeIntegrationState: Equatable, Sendable {
    case installed
    case partial
    case notInstalled
}

struct AgentActivityClaudeInstaller {
    private static let claudeBeginMarker = "<!-- BEGIN BRAINBAR AGENT TRACE -->"
    private static let claudeEndMarker = "<!-- END BRAINBAR AGENT TRACE -->"

    private let fileManager: FileManager
    private let homeURL: URL
    private let sourceURL: URL?

    init(
        fileManager: FileManager = .default,
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        sourceURL: URL? = Bundle.main.resourceURL?
            .appendingPathComponent("AgentIntegrations", isDirectory: true)
            .appendingPathComponent("Claude", isDirectory: true)
            .appendingPathComponent("brainbar-agent-trace", isDirectory: true)
    ) {
        self.fileManager = fileManager
        self.homeURL = homeURL
        self.sourceURL = sourceURL
    }

    var claudeDirectoryURL: URL {
        homeURL.appendingPathComponent(".claude", isDirectory: true)
    }

    var skillSourcesDirectoryURL: URL {
        claudeDirectoryURL.appendingPathComponent("skill-sources", isDirectory: true)
    }

    var targetURL: URL {
        skillSourcesDirectoryURL.appendingPathComponent("brainbar-agent-trace", isDirectory: true)
    }

    var markerURL: URL {
        targetURL.appendingPathComponent(".brainbar-managed")
    }

    var claudeInstructionsURL: URL {
        claudeDirectoryURL.appendingPathComponent("CLAUDE.md")
    }

    func skillSourcesDirectoryExists() -> Bool {
        directoryExists(at: skillSourcesDirectoryURL)
    }

    func installationState() -> AgentActivityClaudeIntegrationState {
        guard claudeInstructionsInstalled() else {
            return .notInstalled
        }
        if skillSourcesDirectoryExists() {
            return skillSourceInstalled() ? .installed : .partial
        }
        return .partial
    }

    func isInstalled() -> Bool {
        installationState() == .installed
    }

    func isPartiallyInstalled() -> Bool {
        installationState() == .partial
    }

    func install() throws -> AgentActivityClaudeInstallStatus {
        try installClaudeInstructions()

        guard skillSourcesDirectoryExists() else {
            return .partial
        }
        guard let sourceURL, directoryExists(at: sourceURL) else {
            throw BrainBarError.fileMissing("Claude Agent Activity integration")
        }

        if directoryExists(at: targetURL) {
            guard fileManager.fileExists(atPath: markerURL.path) else {
                return .existingUnmanagedSkill
            }
            try fileManager.removeItem(at: targetURL)
        }

        try fileManager.copyItem(at: sourceURL, to: targetURL)
        try "BrainBar-managed Claude Agent Activity integration\n".write(
            to: markerURL,
            atomically: true,
            encoding: .utf8
        )
        return .installed
    }

    func claudeInstructionsInstalled() -> Bool {
        guard
            let text = try? String(contentsOf: claudeInstructionsURL, encoding: .utf8)
        else {
            return false
        }
        return text.contains(Self.claudeBeginMarker) && text.contains(Self.claudeEndMarker)
    }

    private func skillSourceInstalled() -> Bool {
        fileManager.fileExists(atPath: targetURL.appendingPathComponent(".claude-plugin/plugin.json").path)
            && fileManager.fileExists(atPath: targetURL.appendingPathComponent("skills/brainbar-agent-trace/SKILL.md").path)
            && fileManager.fileExists(atPath: markerURL.path)
    }

    private func installClaudeInstructions() throws {
        let existingText = (try? String(contentsOf: claudeInstructionsURL, encoding: .utf8)) ?? ""
        let managedBlock = claudeManagedBlock()
        let updatedText: String
        if let beginRange = existingText.range(of: Self.claudeBeginMarker),
           let endRange = existingText.range(of: Self.claudeEndMarker, range: beginRange.upperBound..<existingText.endIndex) {
            updatedText = String(existingText[..<beginRange.lowerBound])
                + managedBlock
                + String(existingText[endRange.upperBound...])
        } else {
            let separator = existingText.isEmpty || existingText.hasSuffix("\n") ? "" : "\n"
            updatedText = existingText + separator + managedBlock
        }
        try fileManager.createDirectory(
            at: claudeInstructionsURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try updatedText.write(to: claudeInstructionsURL, atomically: true, encoding: .utf8)
    }

    private func claudeManagedBlock() -> String {
        """
        \(Self.claudeBeginMarker)
        When working on local project or vault files that BrainBar can visualize, emit metadata-only Agent Activity events for meaningful reads, writes, creates, deletes, focus changes, opens, graph refreshes, closeouts, and decisions.

        Preferred helper:
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`

        Examples:
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace read "path/to/file.md" --agent claude --reason "loaded project context"`
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace write "path/to/file.md" --agent claude --reason "updated durable note"`
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace focus "path/to/file.md" --agent claude --reason "active working file"`

        Supported actions are `read`, `write`, `create`, `delete`, `focus`, `open`, `graph_refresh`, `closeout`, and `decision`.

        Schema v2 optionally accepts `--workflow-id`, `--workflow-title`, and `--path-role source|output`. Use only declared values; omit `--path-role` for a touched path.

        Trace metadata only. Never trace note contents, prompts, raw transcripts, stdout/stderr, secrets, credentials, build artifacts, dependency caches, temporary files, or files under `.git`.
        \(Self.claudeEndMarker)

        """
    }

    private func directoryExists(at url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }
}
