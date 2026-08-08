import Foundation

enum SetupDoctorSeverity: String, Equatable, Sendable {
    case ready
    case info
    case warning
    case error
}

enum SetupDoctorCode: String, Equatable, Sendable {
    case noConfiguration
    case invalidConfiguration
    case vaultMissing
    case vaultUnreadable
    case graphJSONMissing
    case graphJSONUnreadable
    case graphJSONInvalid
    case graphJSONInvalidShape
    case graphJSONReady
    case graphJSONOnly
    case graphHTMLReady
    case graphHTMLMissing
    case graphReportReady
    case graphReportMissing
    case commandReady
    case commandUnavailable
    case commandNotExecutable
    case refreshFailed
    case staleOutput
}

enum SetupDoctorAction: String, Equatable, Sendable {
    case none
    case chooseVault
    case editSettings
    case copyRefreshCommand
    case refreshGraph
}

struct SetupDoctorFinding: Identifiable, Equatable, Sendable {
    var id: String
    var code: SetupDoctorCode
    var severity: SetupDoctorSeverity
    var title: String
    var evidence: String
    var remediation: String
    var action: SetupDoctorAction
    var blocksSaving: Bool
}

struct SetupDoctorCommandStatus: Identifiable, Equatable, Sendable {
    var id: String
    var name: String
    var commandLine: String
    var resolvedExecutablePath: String?
    var workingDirectoryPath: String?
    var available: Bool
}

struct SetupDoctorReport: Equatable, Sendable {
    var findings: [SetupDoctorFinding]
    var commands: [SetupDoctorCommandStatus]
    var effectivePATH: String
    var inspectedAt: Date

    var canSave: Bool {
        !findings.contains(where: \.blocksSaving)
    }

    var refreshCommandLine: String? {
        commands.first(where: { $0.id == "refreshGraph" })?.commandLine
    }
}

struct SetupDoctorSaveResult: Equatable, Sendable {
    var report: SetupDoctorReport
    var saved: Bool
}

struct SetupDoctorService: Sendable {
    var environment: [String: String]

    init(environment: [String: String] = ProcessInfo.processInfo.environment) {
        self.environment = environment
    }

    func inspect(
        config: BrainBarConfig,
        lastGraphRefresh: CommandResult?,
        inspectedAt: Date = Date()
    ) async -> SetupDoctorReport {
        let environment = environment
        return await Task.detached(priority: .userInitiated) {
            Self.buildReport(
                config: config,
                lastGraphRefresh: lastGraphRefresh,
                inspectedAt: inspectedAt,
                environment: environment
            )
        }.value
    }

    private static func buildReport(
        config: BrainBarConfig,
        lastGraphRefresh: CommandResult?,
        inspectedAt: Date,
        environment: [String: String]
    ) -> SetupDoctorReport {
        let fileManager = FileManager.default
        let effectiveEnvironment = CommandRunner.effectiveEnvironment(base: environment)
        let vaultPath = config.vaultPath.trimmingCharacters(in: .whitespacesAndNewlines)
        var findings: [SetupDoctorFinding] = []

        if !(1...65_535).contains(config.serverPort) {
            findings.append(finding(
                id: "invalid-server-port",
                code: .invalidConfiguration,
                severity: .error,
                title: "Invalid server port",
                evidence: "Configured port: \(config.serverPort).",
                remediation: "Choose a port from 1 through 65535 in Advanced settings.",
                action: .editSettings,
                blocksSaving: true
            ))
        }

        if config.graphHtmlRelativePath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            findings.append(finding(
                id: "invalid-graph-path",
                code: .invalidConfiguration,
                severity: .error,
                title: "Graph output path is empty",
                evidence: "BrainBar derives graph.json from the Graph HTML location.",
                remediation: "Set Graph HTML to a path such as graphify-out/graph.html.",
                action: .editSettings,
                blocksSaving: true
            ))
        }

        guard !vaultPath.isEmpty else {
            findings.append(finding(
                id: "no-configuration",
                code: .noConfiguration,
                severity: .error,
                title: "Choose a vault",
                evidence: "No vault path is configured.",
                remediation: "Choose the local vault folder BrainBar should inspect.",
                action: .chooseVault,
                blocksSaving: true
            ))
            return report(
                config: config,
                vaultURL: nil,
                findings: findings,
                effectiveEnvironment: effectiveEnvironment,
                inspectedAt: inspectedAt
            )
        }

        let vaultURL = URL(fileURLWithPath: vaultPath).standardizedFileURL
        var isDirectory: ObjCBool = false
        guard fileManager.fileExists(atPath: vaultURL.path, isDirectory: &isDirectory), isDirectory.boolValue else {
            findings.append(finding(
                id: "vault-missing",
                code: .vaultMissing,
                severity: .error,
                title: "Vault folder not found",
                evidence: vaultURL.path,
                remediation: "Choose an existing local vault folder.",
                action: .chooseVault,
                blocksSaving: true
            ))
            return report(
                config: config,
                vaultURL: vaultURL,
                findings: findings,
                effectiveEnvironment: effectiveEnvironment,
                inspectedAt: inspectedAt
            )
        }

        guard fileManager.isReadableFile(atPath: vaultURL.path) else {
            findings.append(finding(
                id: "vault-unreadable",
                code: .vaultUnreadable,
                severity: .error,
                title: "Vault is not readable",
                evidence: vaultURL.path,
                remediation: "Grant BrainBar read access to this folder, then run Setup Doctor again.",
                action: .chooseVault,
                blocksSaving: true
            ))
            return report(
                config: config,
                vaultURL: vaultURL,
                findings: findings,
                effectiveEnvironment: effectiveEnvironment,
                inspectedAt: inspectedAt
            )
        }

        let graphHTMLURL = resolvedURL(config.graphHtmlRelativePath, in: vaultURL)
        let graphJSONURL = graphHTMLURL.deletingLastPathComponent().appendingPathComponent("graph.json")
        let graphReportURL = resolvedURL(config.graphReportRelativePath, in: vaultURL)
        let graphHTMLExists = fileManager.fileExists(atPath: graphHTMLURL.path)
        let graphJSONExists = fileManager.fileExists(atPath: graphJSONURL.path)

        if graphJSONExists {
            if !fileManager.isReadableFile(atPath: graphJSONURL.path) {
                findings.append(finding(
                    id: "graph-json-unreadable",
                    code: .graphJSONUnreadable,
                    severity: .error,
                    title: "graph.json is not readable",
                    evidence: graphJSONURL.path,
                    remediation: "Grant read permission to graph.json, then run Setup Doctor again.",
                    action: .editSettings,
                    blocksSaving: false
                ))
            } else {
                findings.append(graphJSONFinding(at: graphJSONURL, graphHTMLExists: graphHTMLExists))
            }
        } else {
            findings.append(finding(
                id: "graph-json-missing",
                code: .graphJSONMissing,
                severity: .warning,
                title: "graph.json is missing",
                evidence: graphJSONURL.path,
                remediation: "Run Refresh Graph to generate Graphify output.",
                action: .refreshGraph,
                blocksSaving: false
            ))
        }

        findings.append(finding(
            id: graphHTMLExists ? "graph-html-ready" : "graph-html-missing",
            code: graphHTMLExists ? .graphHTMLReady : .graphHTMLMissing,
            severity: graphHTMLExists ? .ready : .info,
            title: graphHTMLExists ? "2D graph found" : "2D graph is optional",
            evidence: graphHTMLURL.path,
            remediation: graphHTMLExists
                ? "No action needed."
                : "BrainBar can use valid graph.json in 3D; generate graph.html only if you need the 2D Workbench.",
            action: .none,
            blocksSaving: false
        ))

        let reportExists = fileManager.fileExists(atPath: graphReportURL.path)
        findings.append(finding(
            id: reportExists ? "graph-report-ready" : "graph-report-missing",
            code: reportExists ? .graphReportReady : .graphReportMissing,
            severity: reportExists ? .ready : .info,
            title: reportExists ? "Graphify report found" : "Graphify report not found",
            evidence: graphReportURL.path,
            remediation: reportExists ? "No action needed." : "Refresh Graph if your Graphify setup produces a report.",
            action: reportExists ? .none : .refreshGraph,
            blocksSaving: false
        ))

        if let lastGraphRefresh, !lastGraphRefresh.succeeded {
            findings.append(finding(
                id: "refresh-failed",
                code: .refreshFailed,
                severity: .error,
                title: "Last graph refresh failed",
                evidence: "Exit code \(lastGraphRefresh.exitCode) at \(lastGraphRefresh.finishedAt.formatted(date: .abbreviated, time: .standard)).",
                remediation: "Review the configured command, copy it for a terminal check, then retry Refresh Graph.",
                action: .copyRefreshCommand,
                blocksSaving: false
            ))

            if let graphModifiedAt = modificationDate(for: graphJSONURL, fileManager: fileManager),
               graphModifiedAt < lastGraphRefresh.startedAt {
                findings.append(finding(
                    id: "stale-output",
                    code: .staleOutput,
                    severity: .warning,
                    title: "Graph output is stale",
                    evidence: "graph.json predates the failed refresh attempt at \(lastGraphRefresh.startedAt.formatted(date: .abbreviated, time: .standard)).",
                    remediation: "Fix the refresh command and run Refresh Graph successfully before relying on this output.",
                    action: .refreshGraph,
                    blocksSaving: false
                ))
            }
        }

        return report(
            config: config,
            vaultURL: vaultURL,
            findings: findings,
            effectiveEnvironment: effectiveEnvironment,
            inspectedAt: inspectedAt
        )
    }

    private static func graphJSONFinding(at url: URL, graphHTMLExists: Bool) -> SetupDoctorFinding {
        let data: Data
        do {
            data = try Data(contentsOf: url, options: [.mappedIfSafe])
        } catch {
            return finding(
                id: "graph-json-unreadable",
                code: .graphJSONUnreadable,
                severity: .error,
                title: "graph.json could not be read",
                evidence: url.path,
                remediation: "Grant read permission to graph.json, then run Setup Doctor again.",
                action: .editSettings,
                blocksSaving: false
            )
        }

        do {
            let object = try JSONSerialization.jsonObject(with: data)
            guard let graph = object as? [String: Any], graph["nodes"] is [Any] else {
                return finding(
                    id: "graph-json-invalid-shape",
                    code: .graphJSONInvalidShape,
                    severity: .error,
                    title: "graph.json has an invalid shape",
                    evidence: "Expected a JSON object containing a nodes array.",
                    remediation: "Regenerate graph.json with Graphify, then run Setup Doctor again.",
                    action: .refreshGraph,
                    blocksSaving: false
                )
            }
            let hasEdges = graph["edges"] is [Any]
            let hasLinks = graph["links"] is [Any]
            guard hasEdges != hasLinks else {
                return finding(
                    id: "graph-json-invalid-shape",
                    code: .graphJSONInvalidShape,
                    severity: .error,
                    title: "graph.json has an invalid shape",
                    evidence: "Expected exactly one edge array named edges or links.",
                    remediation: "Regenerate graph.json with Graphify, then run Setup Doctor again.",
                    action: .refreshGraph,
                    blocksSaving: false
                )
            }
            return finding(
                id: graphHTMLExists ? "graph-json-ready" : "graph-json-only",
                code: graphHTMLExists ? .graphJSONReady : .graphJSONOnly,
                severity: .ready,
                title: graphHTMLExists ? "Graph JSON is valid" : "JSON-only graph is ready",
                evidence: url.path,
                remediation: "No action needed.",
                action: .none,
                blocksSaving: false
            )
        } catch {
            return finding(
                id: "graph-json-invalid",
                code: .graphJSONInvalid,
                severity: .error,
                title: "graph.json is invalid JSON",
                evidence: "The configured graph.json could not be parsed.",
                remediation: "Regenerate graph.json with Graphify, then run Setup Doctor again.",
                action: .refreshGraph,
                blocksSaving: false
            )
        }
    }

    private static func report(
        config: BrainBarConfig,
        vaultURL: URL?,
        findings: [SetupDoctorFinding],
        effectiveEnvironment: [String: String],
        inspectedAt: Date
    ) -> SetupDoctorReport {
        var findings = findings
        let commandInputs: [(String, String, CommandSpec?)] = [
            ("refreshGraph", "Refresh Graph", config.commands.refreshGraph),
            ("brainCheck", "Brain Check", config.commands.brainCheck),
            ("reviewQueueStatus", "Review Queue Status", config.reviewQueue.preflightCommand),
            ("reviewQueueAction", "Review Queue Action", config.reviewQueue.manualCommand),
            ("git", "Git", CommandSpec(executable: "git", arguments: [], workingDirectory: "vault"))
        ]

        let commands = commandInputs.compactMap { id, name, spec -> SetupDoctorCommandStatus? in
            guard let spec else {
                return nil
            }
            let commandLine = displayCommand(spec)
            let resolvedURL = CommandRunner.resolvedExecutableURL(
                spec.executable,
                environment: effectiveEnvironment
            )
            let executableExists = resolvedURL.map { FileManager.default.fileExists(atPath: $0.path) } ?? false
            let executableAvailable = resolvedURL.map { FileManager.default.isExecutableFile(atPath: $0.path) } ?? false
            let code: SetupDoctorCode = executableAvailable ? .commandReady : (executableExists ? .commandNotExecutable : .commandUnavailable)
            let isRequired = id == "refreshGraph"
            findings.append(finding(
                id: "command-\(id)",
                code: code,
                severity: executableAvailable ? .ready : (isRequired ? .error : .warning),
                title: executableAvailable ? "\(name) command is ready" : "\(name) command is unavailable",
                evidence: resolvedURL?.path ?? "\(spec.executable) was not found in BrainBar's PATH.",
                remediation: executableAvailable
                    ? "No action needed."
                    : "Install the executable or enter its absolute executable path in Settings.",
                action: isRequired ? .copyRefreshCommand : .editSettings,
                blocksSaving: false
            ))
            return SetupDoctorCommandStatus(
                id: id,
                name: name,
                commandLine: commandLine,
                resolvedExecutablePath: resolvedURL?.path,
                workingDirectoryPath: workingDirectoryPath(for: spec, vaultURL: vaultURL),
                available: executableAvailable
            )
        }

        return SetupDoctorReport(
            findings: findings,
            commands: commands,
            effectivePATH: effectiveEnvironment["PATH"] ?? "",
            inspectedAt: inspectedAt
        )
    }

    private static func finding(
        id: String,
        code: SetupDoctorCode,
        severity: SetupDoctorSeverity,
        title: String,
        evidence: String,
        remediation: String,
        action: SetupDoctorAction,
        blocksSaving: Bool
    ) -> SetupDoctorFinding {
        SetupDoctorFinding(
            id: id,
            code: code,
            severity: severity,
            title: title,
            evidence: evidence,
            remediation: remediation,
            action: action,
            blocksSaving: blocksSaving
        )
    }

    private static func resolvedURL(_ path: String, in vaultURL: URL) -> URL {
        if path.hasPrefix("/") {
            return URL(fileURLWithPath: path).standardizedFileURL
        }
        return vaultURL.appendingPathComponent(path).standardizedFileURL
    }

    private static func workingDirectoryPath(for spec: CommandSpec, vaultURL: URL?) -> String? {
        guard let workingDirectory = spec.workingDirectory, !workingDirectory.isEmpty else {
            return nil
        }
        if workingDirectory == "vault" {
            return vaultURL?.path
        }
        return workingDirectory.hasPrefix("/") ? URL(fileURLWithPath: workingDirectory).standardizedFileURL.path : workingDirectory
    }

    private static func displayCommand(_ spec: CommandSpec) -> String {
        ([spec.executable] + spec.arguments).map(shellQuoted).joined(separator: " ")
    }

    private static func shellQuoted(_ argument: String) -> String {
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._/"))
        if !argument.isEmpty, argument.unicodeScalars.allSatisfy(allowed.contains) {
            return argument
        }
        return "'\(argument.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    private static func modificationDate(for url: URL, fileManager: FileManager) -> Date? {
        let attributes = try? fileManager.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }
}
