import AppKit
import SwiftUI

struct SettingsView: View {
    let model: AppModel
    @State private var draft: SettingsDraft
    @State private var saveMessage: String?
    @State private var saveSucceeded = false
    @State private var isSavingAndCheckingReviewQueue = false
    @State private var setupDoctorReport: SetupDoctorReport?
    @State private var isRunningSetupDoctor = false
    @State private var setupDoctorRequestID = 0
    @State private var selectedSection: SettingsSection = .vault

    init(model: AppModel) {
        self.model = model
        _draft = State(initialValue: SettingsDraft(config: model.config))
    }

    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(SettingsSection.allCases) { section in
                    SettingsSidebarButton(
                        section: section,
                        isSelected: selectedSection == section
                    ) {
                        selectedSection = section
                    }
                }
                Spacer(minLength: 0)
                SettingsFooter()
            }
            .padding(12)
            .frame(width: 196)
            .background(BrainBarTheme.chrome)
            .overlay(alignment: .trailing) {
                Rectangle()
                    .fill(BrainBarTheme.borderSubtle)
                    .frame(width: 1)
            }

            VStack(spacing: 0) {
                HStack {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(selectedSection.title)
                            .font(.title3.weight(.semibold))
                            .foregroundStyle(BrainBarTheme.primaryText)
                        Text(selectedSection.detail)
                            .font(.caption)
                            .foregroundStyle(BrainBarTheme.secondaryText)
                    }
                    Spacer(minLength: 0)
                    if let saveMessage {
                        SettingsSaveStatus(message: saveMessage, succeeded: saveSucceeded)
                    }
                    Button("Reload") {
                        draft = SettingsDraft(config: model.config)
                        saveMessage = nil
                        setupDoctorReport = nil
                    }
                    Button("Save") {
                        saveDraft()
                    }
                    .keyboardShortcut(.defaultAction)
                    .disabled(isRunningSetupDoctor)
                }
                .padding(.horizontal, 22)
                .padding(.vertical, 16)
                .background(BrainBarTheme.frame)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(BrainBarTheme.borderSubtle)
                        .frame(height: 1)
                }

                ScrollView {
                    selectedSectionContent
                        .padding(22)
                        .frame(maxWidth: 680, alignment: .leading)
                }
                .scrollContentBackground(.hidden)
                .background(BrainBarTheme.frame)
            }
        }
        .frame(minWidth: 760, minHeight: 520)
        .background(BrainBarTheme.frame)
        .onChange(of: draft) {
            setupDoctorRequestID += 1
            setupDoctorReport = nil
            isRunningSetupDoctor = false
        }
    }

    @ViewBuilder
    private var selectedSectionContent: some View {
        switch selectedSection {
        case .vault:
            VStack(alignment: .leading, spacing: 14) {
                SettingsCard {
                    HStack {
                        TextField("Vault path", text: $draft.vaultPath)
                        Button {
                            chooseVault()
                        } label: {
                            Image(systemName: "folder")
                        }
                        .help("Choose vault folder")
                    }
                    SettingsHelpText("Config: \(model.configPath)")
                        .textSelection(.enabled)
                    SettingsHelpText("BrainBar stays local-first: this path is saved only in your local config.")
                }
                SetupDoctorCard(
                    report: setupDoctorReport,
                    isRunning: isRunningSetupDoctor,
                    canRefresh: draft.config == model.config,
                    onRun: runSetupDoctor,
                    onCopyRefreshCommand: copyRefreshCommand,
                    onRefreshGraph: refreshGraphFromDoctor
                )
            }
        case .graph:
            SettingsCard {
                TextField("Project dashboard", text: $draft.projectDashboardRelativePath)
                TextField("Graph HTML", text: $draft.graphHtmlRelativePath)
                TextField("Graphify report", text: $draft.graphReportRelativePath)
                Divider().overlay(BrainBarTheme.borderSubtle)
                TextField("Refresh executable", text: $draft.refreshExecutable)
                TextField("Refresh arguments", text: $draft.refreshArguments)
                SettingsHelpText("Graph paths are relative to the vault. The default refresh command is graphify update .")
            }
        case .checks:
            VStack(alignment: .leading, spacing: 14) {
                SettingsCard(title: "Brain Check") {
                    TextField("Brain check executable", text: $draft.brainCheckExecutable)
                        .help("Optional. Leave empty to disable Brain Check.")
                    TextField("Brain check arguments", text: $draft.brainCheckArguments)
                        .help("Runs inside the configured vault. Example: scripts/brain_check.py --strict")
                    SettingsHelpText("Optional local hook. Leave executable empty to show Configure Brain Check instead of a runnable check.")
                }
                SettingsCard(title: "Review Queue") {
                    Toggle("Enable Review Queue", isOn: $draft.reviewQueueEnabled)
                    TextField("Status command executable", text: $draft.reviewQueuePreflightExecutable)
                        .help("Optional preflight command. It must print JSON and should not modify files.")
                        .disabled(!draft.reviewQueueEnabled)
                    TextField("Status command arguments", text: $draft.reviewQueuePreflightArguments)
                        .disabled(!draft.reviewQueueEnabled)
                    HStack {
                        Button("Use Demo Status") {
                            draft.reviewQueueEnabled = true
                            draft.reviewQueuePreflightExecutable = "/bin/echo"
                            draft.reviewQueuePreflightArguments = "{\"pending_count\":2,\"items\":[\"First item\",\"Second item\"]}"
                            draft.reviewQueueBackgroundWatcherEnabled = false
                        }
                        .controlSize(.small)
                        Spacer()
                        Button(isSavingAndCheckingReviewQueue ? "Checking..." : "Save & Check") {
                            saveAndCheckReviewQueue()
                        }
                        .controlSize(.small)
                        .disabled(!draft.canRunReviewQueueStatus || isSavingAndCheckingReviewQueue)
                    }
                    Divider().overlay(BrainBarTheme.borderSubtle)
                    TextField("Manual action command executable", text: $draft.reviewQueueManualExecutable)
                        .help("Optional action. BrainBar only runs this when you click Run Action.")
                        .disabled(!draft.reviewQueueEnabled)
                    TextField("Manual action command arguments", text: $draft.reviewQueueManualArguments)
                        .disabled(!draft.reviewQueueEnabled)
                    Toggle("Background watcher", isOn: $draft.reviewQueueBackgroundWatcherEnabled)
                        .disabled(!draft.canEnableReviewQueueWatcher)
                    Stepper(value: $draft.reviewQueueWatcherIntervalSeconds, in: 300...3_600, step: 300) {
                        TextField("Watcher interval seconds", value: $draft.reviewQueueWatcherIntervalSeconds, format: .number)
                    }
                    .disabled(!draft.reviewQueueBackgroundWatcherEnabled || !draft.reviewQueueEnabled)
                    Stepper(value: $draft.reviewQueueTimeoutSeconds, in: 1...60) {
                        TextField("Command timeout seconds", value: $draft.reviewQueueTimeoutSeconds, format: .number)
                    }
                    .disabled(!draft.reviewQueueEnabled)
                    SettingsHelpText("Status commands are read-only JSON checks. Manual action commands never run automatically.")
                }
            }
        case .agentActivity:
            SettingsCard {
                Toggle("Enable agent event tracing", isOn: $draft.agentActivityEventTracingEnabled)
                    .onChange(of: draft.agentActivityEventTracingEnabled) { _, _ in
                        saveDraft()
                    }
                Toggle("Enable local file watcher", isOn: $draft.agentActivityFileActivityEnabled)
                    .onChange(of: draft.agentActivityFileActivityEnabled) { _, _ in saveDraft() }
                Stepper(value: $draft.agentActivityRetentionDays, in: 1...90) {
                    TextField("Retention days", value: $draft.agentActivityRetentionDays, format: .number)
                }
                SettingsHelpText("Completed workflows share this Agent Activity retention; BrainBar does not use a separate workflow database.")
                TextField("Excluded folders or globs (one per line)", text: $draft.agentActivityExclusions, axis: .vertical)
                    .lineLimit(3...6)
                SettingsHelpText("Default exclusions: hidden paths, .git, graphify-out, and .brainbar. Globs use * and ? and match normalized vault-relative paths.")
                SettingsHelpText("Retained metadata fields: \(AgentActivityPrivacyPreview.retainedFields.joined(separator: ", ")). \(AgentActivityPrivacyPreview.excludedContentDescription)")
                LabeledContent("Event log") {
                    Text(model.agentActivitySnapshot.eventLogPath)
                        .textSelection(.enabled)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                LabeledContent("Last event") {
                    Text(model.agentActivitySnapshot.lastEventAt?.formatted(date: .abbreviated, time: .standard) ?? "None")
                        .foregroundStyle(BrainBarTheme.secondaryText)
                }
                LabeledContent("Codex integration") {
                    AgentIntegrationStatusValue(
                        imageName: "AgentCodexIcon",
                        accent: BrainBarTheme.accent,
                        status: model.agentActivitySnapshot.codexIntegrationInstalled ? "Installed" : "Not installed",
                        statusColor: model.agentActivitySnapshot.codexIntegrationInstalled ? BrainBarTheme.success : BrainBarTheme.secondaryText
                    )
                }
                LabeledContent("Claude integration") {
                    AgentIntegrationStatusValue(
                        imageName: "AgentClaudeIcon",
                        accent: BrainBarTheme.warning,
                        status: claudeIntegrationStatusText,
                        statusColor: claudeIntegrationStatusColor
                    )
                }
                HStack {
                    Button("Install Codex Integration") {
                        model.installCodexAgentActivityIntegration()
                    }
                    Button("Install Claude Integration") {
                        model.installClaudeAgentActivityIntegration()
                    }
                    Button("Write Test Event") {
                        model.writeAgentActivityTestEvent()
                    }
                    Button("Open Event Log") {
                        model.openAgentActivityLog()
                    }
                    Button("Clear Agent Activity", role: .destructive) {
                        model.clearAgentActivity()
                    }
                }
                .controlSize(.small)
                if let message = model.lastAgentActivityActionMessage {
                    SettingsHelpText(message)
                }
                SettingsHelpText("Clear deletes Agent Activity and workflow-derived history.")
            }
        case .advanced:
            SettingsCard {
                Stepper(value: $draft.serverPort, in: 1...65_535) {
                    TextField("Local server port", value: $draft.serverPort, format: .number)
                }
                Toggle("Use Obsidian URL scheme", isOn: $draft.useObsidianURLScheme)
                Toggle("Notifications", isOn: $draft.notificationsEnabled)
                SettingsHelpText("The local server is a fallback/debug option. The main graph view loads the HTML directly inside BrainBar.")
            }
        }
    }

    private var claudeIntegrationStatusText: String {
        if model.agentActivitySnapshot.claudeIntegrationInstalled {
            return "Installed"
        }
        if model.agentActivitySnapshot.claudeIntegrationPartial {
            return "Partial"
        }
        return "Not installed"
    }

    private var claudeIntegrationStatusColor: Color {
        if model.agentActivitySnapshot.claudeIntegrationInstalled {
            return BrainBarTheme.success
        }
        if model.agentActivitySnapshot.claudeIntegrationPartial {
            return BrainBarTheme.warning
        }
        return BrainBarTheme.secondaryText
    }

    private func chooseVault() {
        NSApplication.shared.activate(ignoringOtherApps: true)
        BrainBarWindowController.bringSettingsToFront()
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.level = .floating

        if let settingsWindow = BrainBarWindowController.settingsWindow() {
            panel.beginSheetModal(for: settingsWindow) { response in
                guard response == .OK, let url = panel.url else {
                    return
                }
                draft.vaultPath = url.path
            }
        } else if panel.runModal() == .OK, let url = panel.url {
            draft.vaultPath = url.path
        }
    }

    private func clearSaveMessageAfterDelay() {
        Task {
            try? await Task.sleep(for: .seconds(2))
            saveMessage = nil
        }
    }

    private func saveDraft() {
        Task {
            _ = await validateAndSaveDraft()
        }
    }

    private func runSetupDoctor() {
        let config = draft.config
        setupDoctorRequestID += 1
        let requestID = setupDoctorRequestID
        isRunningSetupDoctor = true
        Task {
            let report = await model.inspectSetup(for: config)
            guard requestID == setupDoctorRequestID else {
                return
            }
            setupDoctorReport = report
            isRunningSetupDoctor = false
        }
    }

    private func validateAndSaveDraft() async -> Bool {
        let config = draft.config
        setupDoctorRequestID += 1
        let requestID = setupDoctorRequestID
        isRunningSetupDoctor = true
        let result = await model.validateAndSaveConfig(config)
        guard requestID == setupDoctorRequestID else {
            return false
        }
        setupDoctorReport = result.report
        isRunningSetupDoctor = false
        if !result.report.canSave {
            selectedSection = .vault
        }
        saveSucceeded = result.saved
        saveMessage = result.saved ? "Saved" : (result.report.canSave ? "Save failed" : "Fix setup issues")
        clearSaveMessageAfterDelay()
        return result.saved
    }

    private func saveAndCheckReviewQueue() {
        isSavingAndCheckingReviewQueue = true
        Task {
            guard await validateAndSaveDraft() else {
                isSavingAndCheckingReviewQueue = false
                return
            }
            await model.refreshReviewQueueStatus()
            isSavingAndCheckingReviewQueue = false
        }
    }

    private func copyRefreshCommand() {
        guard let command = setupDoctorReport?.refreshCommandLine else {
            return
        }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(command, forType: .string)
        saveSucceeded = true
        saveMessage = "Command copied"
        clearSaveMessageAfterDelay()
    }

    private func refreshGraphFromDoctor() {
        guard draft.config == model.config else {
            saveSucceeded = false
            saveMessage = "Save before refreshing"
            clearSaveMessageAfterDelay()
            return
        }
        Task {
            await model.refreshGraph()
            runSetupDoctor()
        }
    }
}

private enum SettingsSection: String, CaseIterable, Identifiable {
    case vault
    case graph
    case checks
    case agentActivity
    case advanced

    var id: String { rawValue }

    var title: String {
        switch self {
        case .vault:
            return "Vault"
        case .graph:
            return "Graph"
        case .checks:
            return "Checks"
        case .agentActivity:
            return "Agent Activity"
        case .advanced:
            return "Advanced"
        }
    }

    var detail: String {
        switch self {
        case .vault:
            return "Local vault and config location."
        case .graph:
            return "Graphify output paths and refresh command."
        case .checks:
            return "Local checks and review queue commands."
        case .agentActivity:
            return "Metadata-only local activity tracing."
        case .advanced:
            return "Fallback server and optional app behaviors."
        }
    }

    var systemImage: String {
        switch self {
        case .vault:
            return "externaldrive"
        case .graph:
            return "point.3.connected.trianglepath.dotted"
        case .checks:
            return "checkmark.seal"
        case .agentActivity:
            return "waveform.path.ecg"
        case .advanced:
            return "slider.horizontal.3"
        }
    }
}

private struct SettingsSidebarButton: View {
    let section: SettingsSection
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label(section.title, systemImage: section.systemImage)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isSelected ? BrainBarTheme.primaryText : BrainBarTheme.secondaryText)
                .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
                .padding(.horizontal, 9)
                .contentShape(.rect(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .background(isSelected ? BrainBarTheme.elevated.opacity(0.72) : Color.clear, in: .rect(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(isSelected ? BrainBarTheme.border : .clear, lineWidth: 1)
        }
    }
}

private struct SettingsCard<Content: View>: View {
    var title: String?
    @ViewBuilder let content: Content

    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let title {
                Text(title)
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(BrainBarTheme.primaryText)
            }
            content
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(BrainBarTheme.chrome, in: .rect(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(BrainBarTheme.borderSubtle, lineWidth: 1)
        }
    }
}

private struct SettingsHelpText: View {
    let text: String

    init(_ text: String) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(BrainBarTheme.secondaryText)
    }
}

private struct SetupDoctorCard: View {
    let report: SetupDoctorReport?
    let isRunning: Bool
    let canRefresh: Bool
    let onRun: () -> Void
    let onCopyRefreshCommand: () -> Void
    let onRefreshGraph: () -> Void

    var body: some View {
        SettingsCard(title: "Setup Doctor") {
            HStack(alignment: .firstTextBaseline) {
                SettingsHelpText("Checks the vault, Graphify output, permissions, Git, and local command environment before saving.")
                Spacer(minLength: 12)
                Button(isRunning ? "Checking…" : report == nil ? "Run Diagnosis" : "Run Again") {
                    onRun()
                }
                .controlSize(.small)
                .disabled(isRunning)
            }

            if isRunning {
                ProgressView()
                    .controlSize(.small)
                    .accessibilityLabel("Setup Doctor is checking the configuration")
            } else if let report {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(report.findings) { finding in
                        SetupDoctorFindingRow(finding: finding)
                    }
                }

                Divider().overlay(BrainBarTheme.borderSubtle)

                VStack(alignment: .leading, spacing: 8) {
                    Text("Command environment")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(BrainBarTheme.primaryText)
                    ForEach(report.commands) { command in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(command.name)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(command.available ? BrainBarTheme.success : BrainBarTheme.error)
                            Text(command.resolvedExecutablePath ?? "Not resolved")
                                .font(.caption.monospaced())
                                .foregroundStyle(BrainBarTheme.secondaryText)
                                .textSelection(.enabled)
                            if let workingDirectory = command.workingDirectoryPath {
                                Text("Working directory: \(workingDirectory)")
                                    .font(.caption2.monospaced())
                                    .foregroundStyle(BrainBarTheme.secondaryText)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    Text("PATH: \(report.effectivePATH)")
                        .font(.caption2.monospaced())
                        .foregroundStyle(BrainBarTheme.secondaryText)
                        .textSelection(.enabled)
                }

                HStack {
                    Button("Copy Refresh Command", action: onCopyRefreshCommand)
                    Button("Refresh Graph", action: onRefreshGraph)
                        .disabled(!canRefresh)
                    Spacer(minLength: 0)
                    Text(report.canSave ? "Configuration can be saved" : "Resolve blocking issues before saving")
                        .font(.caption.weight(.medium))
                        .foregroundStyle(report.canSave ? BrainBarTheme.success : BrainBarTheme.error)
                }
                .controlSize(.small)
            }
        }
    }
}

private struct SetupDoctorFindingRow: View {
    let finding: SetupDoctorFinding

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: systemImage)
                .foregroundStyle(color)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                Text(finding.title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(BrainBarTheme.primaryText)
                Text(finding.evidence)
                    .font(.caption)
                    .foregroundStyle(BrainBarTheme.secondaryText)
                    .textSelection(.enabled)
                Text(finding.remediation)
                    .font(.caption)
                    .foregroundStyle(color)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(finding.severity.rawValue): \(finding.title). \(finding.evidence). \(finding.remediation)")
    }

    private var systemImage: String {
        switch finding.severity {
        case .ready:
            return "checkmark.circle.fill"
        case .info:
            return "info.circle.fill"
        case .warning:
            return "exclamationmark.triangle.fill"
        case .error:
            return "xmark.octagon.fill"
        }
    }

    private var color: Color {
        switch finding.severity {
        case .ready:
            return BrainBarTheme.success
        case .info:
            return BrainBarTheme.accent
        case .warning:
            return BrainBarTheme.warning
        case .error:
            return BrainBarTheme.error
        }
    }
}

private struct SettingsFooter: View {
    private let repositoryURL = URL(string: "https://github.com/Nova1390/brain-bar")!
    private let releaseURL = URL(string: "https://github.com/Nova1390/brain-bar/releases/latest")!
    private let licenseURL = URL(string: "https://github.com/Nova1390/brain-bar/blob/main/LICENSE")!

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Link(destination: releaseURL) {
                Label("Release \(versionText)", systemImage: "tag")
            }

            Link(destination: repositoryURL) {
                Label {
                    Text("GitHub")
                } icon: {
                    Image("GitHubMark")
                        .resizable()
                        .renderingMode(.template)
                        .frame(width: 13, height: 13)
                }
            }

            Link("MIT License", destination: licenseURL)
        }
        .font(.caption)
        .foregroundStyle(BrainBarTheme.secondaryText)
        .buttonStyle(.link)
        .lineLimit(1)
        .truncationMode(.tail)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var versionText: String {
        let dictionary = Bundle.main.infoDictionary
        let version = dictionary?["CFBundleShortVersionString"] as? String ?? "dev"
        guard let build = dictionary?["CFBundleVersion"] as? String, !build.isEmpty else {
            return version
        }
        return "\(version) (\(build))"
    }
}

private struct SettingsSaveStatus: View {
    let message: String
    let succeeded: Bool

    var body: some View {
        Label(message, systemImage: succeeded ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
            .font(.caption.weight(.medium))
            .foregroundStyle(succeeded ? BrainBarTheme.success : BrainBarTheme.error)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background((succeeded ? BrainBarTheme.success : BrainBarTheme.error).opacity(0.10), in: Capsule())
    }
}

private struct AgentIntegrationStatusValue: View {
    let imageName: String
    let accent: Color
    let status: String
    let statusColor: Color

    var body: some View {
        HStack(spacing: 8) {
            Image(imageName)
                .resizable()
                .scaledToFit()
                .clipShape(.rect(cornerRadius: 7))
                .frame(width: 23, height: 23)
                .background(accent.opacity(0.12), in: .rect(cornerRadius: 7))
                .overlay {
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(accent.opacity(0.22), lineWidth: 1)
                }
            Text(status)
                .fontWeight(.semibold)
                .foregroundStyle(statusColor)
        }
    }
}

private struct SettingsDraft: Equatable {
    var vaultPath: String
    var projectDashboardRelativePath: String
    var graphHtmlRelativePath: String
    var graphReportRelativePath: String
    var serverPort: Int
    var useObsidianURLScheme: Bool
    var notificationsEnabled: Bool
    var refreshExecutable: String
    var refreshArguments: String
    var brainCheckExecutable: String
    var brainCheckArguments: String
    var reviewQueueEnabled: Bool
    var reviewQueuePreflightExecutable: String
    var reviewQueuePreflightArguments: String
    var reviewQueueManualExecutable: String
    var reviewQueueManualArguments: String
    var reviewQueueBackgroundWatcherEnabled: Bool
    var reviewQueueWatcherIntervalSeconds: Int
    var reviewQueueTimeoutSeconds: Int
    var agentActivityEventTracingEnabled: Bool
    var agentActivityFileActivityEnabled: Bool
    var agentActivityExclusions: String
    var agentActivityRetentionDays: Int

    init(config: BrainBarConfig) {
        vaultPath = config.vaultPath
        projectDashboardRelativePath = config.projectDashboardRelativePath
        graphHtmlRelativePath = config.graphHtmlRelativePath
        graphReportRelativePath = config.graphReportRelativePath
        serverPort = config.serverPort
        useObsidianURLScheme = config.useObsidianURLScheme
        notificationsEnabled = config.notificationsEnabled
        refreshExecutable = config.commands.refreshGraph.executable
        refreshArguments = config.commands.refreshGraph.arguments.joined(separator: " ")
        brainCheckExecutable = config.commands.brainCheck?.executable ?? ""
        brainCheckArguments = config.commands.brainCheck?.arguments.joined(separator: " ") ?? ""
        let reviewQueue = config.reviewQueue.normalized
        reviewQueueEnabled = reviewQueue.isEnabled
        reviewQueuePreflightExecutable = reviewQueue.preflightCommand?.executable ?? ""
        reviewQueuePreflightArguments = reviewQueue.preflightCommand?.arguments.joined(separator: " ") ?? ""
        reviewQueueManualExecutable = reviewQueue.manualCommand?.executable ?? ""
        reviewQueueManualArguments = reviewQueue.manualCommand?.arguments.joined(separator: " ") ?? ""
        reviewQueueBackgroundWatcherEnabled = reviewQueue.backgroundWatcherEnabled
        reviewQueueWatcherIntervalSeconds = reviewQueue.watcherIntervalSeconds
        reviewQueueTimeoutSeconds = reviewQueue.timeoutSeconds
        agentActivityEventTracingEnabled = config.agentActivity.normalized.eventTracingEnabled
        agentActivityFileActivityEnabled = config.agentActivity.normalized.fileActivityEnabled
        agentActivityExclusions = config.agentActivity.normalized.fileActivityExclusions.joined(separator: "\n")
        agentActivityRetentionDays = config.agentActivity.normalized.retentionDays
    }

    var config: BrainBarConfig {
        BrainBarConfig(
            vaultPath: vaultPath,
            projectDashboardRelativePath: projectDashboardRelativePath,
            graphHtmlRelativePath: graphHtmlRelativePath,
            graphReportRelativePath: graphReportRelativePath,
            serverPort: serverPort,
            useObsidianURLScheme: useObsidianURLScheme,
            notificationsEnabled: notificationsEnabled,
            commands: CommandConfiguration(
                refreshGraph: CommandSpec(
                    executable: refreshExecutable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "graphify" : refreshExecutable,
                    arguments: splitArguments(refreshArguments),
                    workingDirectory: "vault"
                ),
                brainCheck: brainCheckExecutable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : CommandSpec(
                    executable: brainCheckExecutable,
                    arguments: splitArguments(brainCheckArguments),
                    workingDirectory: "vault"
                )
            ),
            reviewQueue: ReviewQueueConfiguration(
                isEnabled: reviewQueueEnabled,
                preflightCommand: commandSpec(
                    executable: reviewQueuePreflightExecutable,
                    arguments: reviewQueuePreflightArguments
                ),
                manualCommand: commandSpec(
                    executable: reviewQueueManualExecutable,
                    arguments: reviewQueueManualArguments
                ),
                backgroundWatcherEnabled: reviewQueueBackgroundWatcherEnabled,
                watcherIntervalSeconds: reviewQueueWatcherIntervalSeconds,
                timeoutSeconds: reviewQueueTimeoutSeconds
            ).normalized,
            agentActivity: AgentActivityConfiguration(
                eventTracingEnabled: agentActivityEventTracingEnabled,
                fileActivityEnabled: agentActivityFileActivityEnabled,
                fileActivityExclusions: agentActivityExclusions.split(whereSeparator: \.isNewline).map(String.init),
                retentionDays: agentActivityRetentionDays
            ).normalized
        ).normalized()
    }

    var canEnableReviewQueueWatcher: Bool {
        reviewQueueEnabled && !reviewQueuePreflightExecutable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canRunReviewQueueStatus: Bool {
        reviewQueueEnabled && !reviewQueuePreflightExecutable.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func splitArguments(_ text: String) -> [String] {
        text.split(separator: " ").map(String.init)
    }

    private func commandSpec(executable: String, arguments: String) -> CommandSpec? {
        let trimmedExecutable = executable.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedExecutable.isEmpty else {
            return nil
        }
        return CommandSpec(
            executable: trimmedExecutable,
            arguments: splitArguments(arguments),
            workingDirectory: "vault"
        )
    }
}
