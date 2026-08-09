import Foundation

enum AgentActivityCodexInstallStatus: Equatable, Sendable {
    case installed
    case codexSkillsDirectoryMissing
    case existingUnmanagedSkill

    var message: String {
        switch self {
        case .installed:
            return "Codex integration installed"
        case .codexSkillsDirectoryMissing:
            return "Codex skills directory not found"
        case .existingUnmanagedSkill:
            return "A non-BrainBar skill already exists at this path"
        }
    }
}

struct AgentActivityCodexInstaller {
    private static let agentsBeginMarker = "<!-- BEGIN BRAINBAR AGENT TRACE -->"
    private static let agentsEndMarker = "<!-- END BRAINBAR AGENT TRACE -->"

    private let fileManager: FileManager
    private let homeURL: URL
    private let sourceURL: URL?

    init(
        fileManager: FileManager = .default,
        homeURL: URL = FileManager.default.homeDirectoryForCurrentUser,
        sourceURL: URL? = Bundle.main.resourceURL?
            .appendingPathComponent("AgentIntegrations", isDirectory: true)
            .appendingPathComponent("Codex", isDirectory: true)
            .appendingPathComponent("brainbar-agent-trace", isDirectory: true)
    ) {
        self.fileManager = fileManager
        self.homeURL = homeURL
        self.sourceURL = sourceURL
    }

    var skillsDirectoryURL: URL {
        homeURL.appendingPathComponent(".codex/skills", isDirectory: true)
    }

    var targetURL: URL {
        skillsDirectoryURL.appendingPathComponent("brainbar-agent-trace", isDirectory: true)
    }

    var markerURL: URL {
        targetURL.appendingPathComponent(".brainbar-managed")
    }

    var agentsURL: URL {
        homeURL.appendingPathComponent(".codex/AGENTS.md")
    }

    func codexSkillsDirectoryExists() -> Bool {
        directoryExists(at: skillsDirectoryURL)
    }

    func isInstalled() -> Bool {
        fileManager.fileExists(atPath: targetURL.appendingPathComponent("SKILL.md").path)
            && fileManager.fileExists(atPath: markerURL.path)
            && agentsInstructionsInstalled()
    }

    func install() throws -> AgentActivityCodexInstallStatus {
        guard codexSkillsDirectoryExists() else {
            return .codexSkillsDirectoryMissing
        }
        guard let sourceURL, directoryExists(at: sourceURL) else {
            throw BrainBarError.fileMissing("Codex Agent Activity integration")
        }

        if directoryExists(at: targetURL) {
            guard fileManager.fileExists(atPath: markerURL.path) else {
                return .existingUnmanagedSkill
            }
            try fileManager.removeItem(at: targetURL)
        }

        try fileManager.copyItem(at: sourceURL, to: targetURL)
        try "BrainBar-managed Codex Agent Activity integration\n".write(
            to: markerURL,
            atomically: true,
            encoding: .utf8
        )
        try installAgentsInstructions()
        return .installed
    }

    func agentsInstructionsInstalled() -> Bool {
        guard
            let text = try? String(contentsOf: agentsURL, encoding: .utf8)
        else {
            return false
        }
        return text.contains(Self.agentsBeginMarker) && text.contains(Self.agentsEndMarker)
    }

    private func installAgentsInstructions() throws {
        let existingText = (try? String(contentsOf: agentsURL, encoding: .utf8)) ?? ""
        let managedBlock = agentsManagedBlock()
        let updatedText: String
        if let beginRange = existingText.range(of: Self.agentsBeginMarker),
           let endRange = existingText.range(of: Self.agentsEndMarker, range: beginRange.upperBound..<existingText.endIndex) {
            updatedText = String(existingText[..<beginRange.lowerBound])
                + managedBlock
                + String(existingText[endRange.upperBound...])
        } else {
            let separator = existingText.isEmpty || existingText.hasSuffix("\n") ? "" : "\n"
            updatedText = existingText + separator + managedBlock
        }
        try fileManager.createDirectory(
            at: agentsURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try updatedText.write(to: agentsURL, atomically: true, encoding: .utf8)
    }

    private func agentsManagedBlock() -> String {
        """
        \(Self.agentsBeginMarker)
        When working on local project or vault files that BrainBar can visualize, emit metadata-only Agent Activity events for meaningful reads, writes, focus changes, closeouts, and decisions.

        Preferred helper:
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace`

        Examples:
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace read "path/to/file.md" --reason "loaded project context"`
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace write "path/to/file.md" --reason "updated durable note"`
        `${HOME}/Applications/BrainBar.app/Contents/Resources/bin/brainbar-trace focus "path/to/file.md" --reason "active working file"`

        Schema v2 optionally accepts `--workflow-id`, `--workflow-title`, and `--path-role source|output`. Use only declared values; omit `--path-role` for a touched path.

        Trace metadata only. Never trace note contents, prompts, raw transcripts, stdout/stderr, secrets, credentials, build artifacts, dependency caches, temporary files, or files under `.git`.
        \(Self.agentsEndMarker)

        """
    }

    private func directoryExists(at url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return fileManager.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }
}
