import AppKit
import SwiftUI

struct GraphShellView: View {
    enum Mode {
        case popover
        case focus

        var isFocus: Bool {
            switch self {
            case .popover:
                return false
            case .focus:
                return true
            }
        }

        var showsFocusButton: Bool {
            switch self {
            case .popover:
                return true
            case .focus:
                return false
            }
        }
    }

    let model: AppModel
    let mode: Mode
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 0) {
            header
            if mode.isFocus {
                graphSurface
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                if shouldShowFooter {
                    footer
                        .padding(.horizontal, 14)
                        .padding(.vertical, 7)
                        .background {
                            Rectangle()
                                .fill(BrainBarTheme.chrome)
                                .overlay(alignment: .top) {
                                    Rectangle()
                                        .fill(BrainBarTheme.borderSubtle)
                                        .frame(height: 1)
                                }
                        }
                }
            } else {
                VStack(spacing: 8) {
                    graphSurface
                    if shouldShowFooter {
                        footer
                    }
                }
                .padding(contentPadding)
            }
        }
        .background(BrainBarTheme.frame)
        .ignoresSafeArea(.container, edges: mode.isFocus ? .top : [])
    }

    private var header: some View {
        GraphChromeBar(
            model: model,
            mode: mode,
            shows3DControls: model.graphViewMode == .threeD && usesExperimental3DRenderer,
            openSettings: openSettings,
            openFocusWindow: openFocusWindow
        )
    }

    private var contentPadding: CGFloat {
        mode == .popover ? 12 : 14
    }

    @ViewBuilder
    private var graphSurface: some View {
        if model.status.vaultPath.isEmpty {
            EmptyGraphStateView(
                title: "Connect your local graph",
                detail: "Choose a Markdown or Obsidian vault, then let BrainBar check for Graphify output.",
                systemImage: "folder.badge.questionmark",
                buttonTitle: "Choose Vault",
                buttonSystemImage: "folder",
                steps: ["Choose Vault", "Check Graphify Output", "Refresh Graph"]
            ) {
                openSettings()
            }
        } else if !model.status.graphOutputExists {
            EmptyGraphStateView(
                title: "Graphify output not found",
                detail: "BrainBar is connected to the vault. Generate graphify-out/graph.json to see the graph here.",
                systemImage: "point.3.connected.trianglepath.dotted",
                buttonTitle: model.isRefreshingGraph ? "Refreshing..." : "Refresh Graph",
                buttonSystemImage: "arrow.triangle.2.circlepath",
                steps: ["Vault connected", "Graph file missing", "Run Refresh Graph"]
            ) {
                Task {
                    await model.refreshGraph()
                }
            }
        } else if model.status.graphJSONExists, !model.status.graphHtmlExists, !mode.isFocus {
            EmptyGraphStateView(
                title: "Graphify graph ready",
                detail: "BrainBar found graphify-out/graph.json. Open the 3D Focus Window to explore it.",
                systemImage: "point.3.connected.trianglepath.dotted",
                buttonTitle: "Open 3D Graph",
                buttonSystemImage: "macwindow",
                steps: ["Vault connected", "Graph JSON found", "Open 3D graph"]
            ) {
                openFocusWindow()
            }
        } else if let graphURL = model.graphFileURL, let readAccessURL = model.graphReadAccessURL {
            if mode.isFocus {
                activeGraphView(graphURL: graphURL, readAccessURL: readAccessURL)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(BrainBarTheme.canvasAdjacent)
            } else {
                activeGraphView(graphURL: graphURL, readAccessURL: readAccessURL)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(BrainBarTheme.canvasAdjacent)
                    .clipShape(.rect(cornerRadius: 10))
                    .overlay {
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(BrainBarTheme.border, lineWidth: 1)
                    }
            }
        } else {
            EmptyGraphStateView(
                title: "Graph unavailable",
                detail: "BrainBar could not resolve the graph file path.",
                systemImage: "exclamationmark.triangle",
                buttonTitle: "Refresh Status",
                buttonSystemImage: "arrow.clockwise"
            ) {
                Task {
                    await model.refreshStatus()
                }
            }
        }
    }

    @ViewBuilder
    private func activeGraphView(graphURL: URL, readAccessURL: URL) -> some View {
        if mode.isFocus,
           model.status.graphJSONExists,
           (model.graphViewMode == .threeD || !model.status.graphHtmlExists),
           usesExperimental3DRenderer {
            Graph3DWebView(
                readAccessURL: readAccessURL,
                reloadToken: model.graphReloadToken,
                sourceLens: model.graphSourceLens,
                resetCameraToken: model.graph3DResetToken,
                viewportCommand: model.graphViewportCommand,
                agentActivitySnapshot: model.agentActivitySnapshot,
                onDiagnostic: model.reportGraphRendererIssue,
                onOpenNode: model.openGraphNode
            )
        } else {
            ZStack(alignment: .topLeading) {
                GraphWebView(
                    fileURL: graphURL,
                    readAccessURL: readAccessURL,
                    reloadToken: model.graphReloadToken,
                    sourceLens: model.graphSourceLens,
                    reviewQueueStatus: model.reviewQueueStatus,
                    agentActivitySnapshot: model.agentActivitySnapshot,
                    viewportCommand: model.graphViewportCommand,
                    onOpenNode: model.openGraphNode
                )

                if mode.isFocus, model.graphViewMode == .threeD {
                    ThreeDFallbackBadge()
                        .padding(12)
                }
            }
        }
    }

    private var usesExperimental3DRenderer: Bool {
        true
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 14) {
                InlineStatus(text: vaultDisplayName, systemImage: "externaldrive")
                if model.isRefreshingGraph {
                    Button {
                        Task {
                            await model.refreshGraph()
                        }
                    } label: {
                        InlineStatus(text: model.graphRefreshSummary, systemImage: "arrow.triangle.2.circlepath")
                    }
                    .buttonStyle(.plain)
                    .disabled(model.isRefreshingGraph)
                    .help("Refresh Graphify graph")
                }
                if model.config.commands.brainCheck != nil, model.lastBrainCheck != nil {
                    InlineStatus(text: model.lastBrainCheck?.summary ?? "Brain Check not run", systemImage: "checkmark.seal")
                }
                Spacer(minLength: 0)
            }

            if let error = model.errorMessage, !error.isEmpty {
                ErrorBanner(message: error)
            }
        }
    }

    private var shouldShowFooter: Bool {
        if let error = model.errorMessage, !error.isEmpty {
            return true
        }
        if model.isRefreshingGraph {
            return true
        }
        if model.config.commands.brainCheck != nil, model.lastBrainCheck != nil {
            return true
        }
        return false
    }

    private var vaultDisplayName: String {
        guard !model.status.vaultPath.isEmpty else {
            return "No vault"
        }
        let url = URL(fileURLWithPath: model.status.vaultPath)
        return url.lastPathComponent.isEmpty ? model.status.vaultPath : url.lastPathComponent
    }

    private func openSettings() {
        openWindow(id: "settings")
        BrainBarWindowController.bringSettingsToFront()
    }

    private func openFocusWindow() {
        openWindow(id: "graph-focus")
        BrainBarWindowController.bringFocusGraphToFront()
        BrainBarWindowController.dismissMenuBarWindow()
    }
}

struct FocusGraphView: View {
    let model: AppModel

    var body: some View {
        GraphShellView(model: model, mode: .focus)
            .frame(minWidth: 900, minHeight: 560)
            .background(GraphWindowChromeConfigurator())
            .task {
                await model.refreshStatus()
            }
    }
}

private struct GraphWindowChromeConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        configure(window: view.window)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        configure(window: nsView.window)
    }

    private func configure(window: NSWindow?) {
        DispatchQueue.main.async {
            guard let window else {
                return
            }
            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.titlebarSeparatorStyle = .none
            window.isMovableByWindowBackground = true
            window.styleMask.insert(.fullSizeContentView)
        }
    }
}

private struct GraphChromeBar: View {
    let model: AppModel
    let mode: GraphShellView.Mode
    let shows3DControls: Bool
    let openSettings: () -> Void
    let openFocusWindow: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 8) {
                VaultStatusText(text: model.status.gitDescription)
                    .help("Git status for the configured vault")
                    .accessibilityHint("Git status for the configured vault, not the BrainBar app repository")
            }
            .layoutPriority(1)

            if mode.isFocus, model.status.graphJSONExists, model.status.graphHtmlExists {
                GraphModeSwitcher(
                    selectedMode: model.graphViewMode,
                    onSelect: model.setGraphViewMode
                )
            }

            if (mode.isFocus && model.status.graphJSONExists && model.graphViewMode == .threeD)
                || (!mode.isFocus && model.status.graphHtmlExists) {
                GraphSourceLensMenu(
                    selectedLens: model.graphSourceLens,
                    onSelect: model.setGraphSourceLens
                )
            }

            Spacer(minLength: 10)

            if mode.isFocus, model.status.graphOutputExists {
                GraphViewportControls(
                    showsTopView: shows3DControls,
                    onZoomOut: model.zoomGraphOut,
                    onZoomIn: model.zoomGraphIn,
                    onFit: model.fitGraphView,
                    onTopView: model.resetGraph3DCamera,
                    onResetTilt: model.resetGraph3DTilt
                )
            }

            HStack(spacing: 4) {
                GraphActionMenu(model: model)

                ChromeIconButton(systemImage: "gearshape", help: "Settings") {
                    openSettings()
                }

                if mode.showsFocusButton {
                    ChromeIconButton(systemImage: "macwindow", help: "Open Focus Window") {
                        openFocusWindow()
                    }
                }

                ChromeIconButton(systemImage: model.isRefreshingGraph ? "hourglass" : "arrow.clockwise", help: "Refresh status") {
                    Task {
                        await model.refreshStatus()
                    }
                }
            }
        }
        .padding(.leading, mode.isFocus ? 84 : 12)
        .padding(.trailing, mode.isFocus ? 14 : 12)
        .frame(height: mode.isFocus ? 40 : nil)
        .background {
            Rectangle()
                .fill(BrainBarTheme.chrome)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(BrainBarTheme.borderSubtle)
                        .frame(height: 1)
                }
        }
    }
}

private struct GraphActionMenu: View {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow
    @State private var isReviewQueuePopoverPresented = false

    var body: some View {
        Menu {
            Section("Graph") {
                Button {
                    Task {
                        await model.refreshGraph()
                    }
                } label: {
                    Label(model.isRefreshingGraph ? "Refreshing..." : "Refresh Graph", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(model.isRefreshingGraph)

                Button {
                    model.reloadGraphView()
                } label: {
                    Label("Reload View", systemImage: "arrow.clockwise")
                }

                Button {
                    model.showGraphHealth()
                } label: {
                    Label("Graph Health", systemImage: "stethoscope")
                }

                if model.status.graphHtmlExists {
                    Button {
                        model.openGraph()
                    } label: {
                        Label("Open Externally", systemImage: "safari")
                    }
                }
            }

            SystemStatusMenu(model: model)

            Section("Vault") {
                Button {
                    model.openVault()
                } label: {
                    Label("Open Vault Folder", systemImage: "folder")
                }

                if model.status.dashboardExists {
                    Button {
                        model.openProjectDashboard()
                    } label: {
                        Label("Open Dashboard", systemImage: "doc.text")
                    }
                } else {
                    Button {
                        openSettings()
                    } label: {
                        Label("Configure Dashboard Path", systemImage: "doc.badge.gearshape")
                    }
                }

                if model.status.graphReportExists {
                    Button {
                        model.openGraphifyReport()
                    } label: {
                        Label("Open Report", systemImage: "doc.richtext")
                    }
                } else {
                    Button {
                        openSettings()
                    } label: {
                        Label("Configure Report Path", systemImage: "doc.badge.gearshape")
                    }
                }
            }

            Section("Checks") {
                Button {
                    isReviewQueuePopoverPresented = true
                } label: {
                    Label("Review Queue...", systemImage: "tray.full")
                }

                if model.config.commands.brainCheck == nil {
                    Button {
                        openSettings()
                    } label: {
                        Label("Configure Brain Check", systemImage: "checkmark.seal")
                    }
                } else {
                    Button {
                        Task {
                            await model.runBrainCheck()
                        }
                    } label: {
                        Label(model.isRunningBrainCheck ? "Checking..." : "Run Brain Check", systemImage: "checkmark.seal")
                    }
                    .disabled(model.isRunningBrainCheck)
                }
            }

            Section("Advanced") {
                Button {
                    Task {
                        await model.startOrStopGraphServer()
                    }
                } label: {
                    Label(model.graphServerRunning ? "Stop Local Server" : "Start Local Server", systemImage: model.graphServerRunning ? "stop.circle" : "play.circle")
                }

                Button {
                    copyToPasteboard(model.configPath)
                } label: {
                    Label("Copy Config Path", systemImage: "doc.on.doc")
                }
            }

            Divider()

            Button {
                openSettings()
            } label: {
                Label("Settings", systemImage: "gearshape")
            }

            Button("Quit") {
                NSApplication.shared.terminate(nil)
            }
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 15, weight: .medium))
                    .frame(width: 28, height: 28)
                    .contentShape(.rect(cornerRadius: 8))

                if let badgeColor = reviewQueueBadgeColor {
                    Circle()
                        .fill(badgeColor)
                        .frame(width: 6, height: 6)
                        .overlay {
                            Circle()
                                .stroke(BrainBarTheme.chrome, lineWidth: 1.2)
                        }
                        .offset(x: -2, y: 3)
                }
            }
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .foregroundStyle(BrainBarTheme.secondaryText)
        .background(BrainBarTheme.panel.opacity(0.001), in: .rect(cornerRadius: 8))
        .help("Actions")
        .popover(isPresented: $isReviewQueuePopoverPresented, arrowEdge: .top) {
            ReviewQueuePopover(model: model, onConfigure: openSettings)
                .frame(width: 360)
        }
    }

    private var reviewQueueBadgeColor: Color? {
        guard model.config.reviewQueue.isEnabled,
              model.config.reviewQueue.preflightCommand != nil
        else {
            return nil
        }
        if model.reviewQueueStatus.errorMessage != nil {
            return BrainBarTheme.error
        }
        if let count = model.reviewQueueStatus.pendingCount, count > 0 {
            return BrainBarTheme.warning
        }
        return nil
    }

    private func openSettings() {
        openWindow(id: "settings")
        BrainBarWindowController.bringSettingsToFront()
    }

    private func copyToPasteboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}

private struct ReviewQueuePopover: View {
    let model: AppModel
    let onConfigure: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Review Queue")
                    .font(.headline.weight(.semibold))
                    .foregroundStyle(BrainBarTheme.primaryText)

                Spacer(minLength: 0)

                Text(statusPillText)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(statusColor.opacity(0.12), in: .capsule)
                    .overlay {
                        Capsule()
                            .stroke(statusColor.opacity(0.18), lineWidth: 1)
                    }
            }

            VStack(alignment: .leading, spacing: 5) {
                Text(summaryText)
                    .font(.callout.weight(.medium))
                    .foregroundStyle(BrainBarTheme.primaryText)
                    .lineLimit(1)
                    .truncationMode(.tail)

                if let checkedAt = model.reviewQueueStatus.lastCheckedAt {
                    Text("checked \(checkedAt.formattedRelative)")
                        .font(.caption)
                        .foregroundStyle(BrainBarTheme.secondaryText)
                        .lineLimit(1)
                }
            }

            HStack(spacing: 8) {
                if !model.config.reviewQueue.isEnabled || model.config.reviewQueue.preflightCommand == nil {
                    Button("Configure") {
                        onConfigure()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                } else {
                    Button(model.isCheckingReviewQueue ? "Checking..." : "Check now") {
                        Task {
                            await model.refreshReviewQueueStatus()
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(model.isCheckingReviewQueue)
                }

                if model.config.reviewQueue.manualCommand != nil {
                    Button(model.isRunningReviewQueueAction ? "Running..." : "Run action") {
                        Task {
                            await model.runReviewQueueAction()
                        }
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(model.isRunningReviewQueueAction)
                }

                Spacer(minLength: 0)
            }

            if model.reviewQueueStatus.items.isEmpty {
                Text(emptyStateText)
                    .font(.caption)
                    .foregroundStyle(BrainBarTheme.secondaryText)
                    .padding(.vertical, 2)
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(model.reviewQueueStatus.items.prefix(4)) { item in
                        ReviewQueueItemRow(item: item, model: model)
                    }
                }
            }
        }
        .padding(16)
        .background(BrainBarTheme.chrome)
    }

    private var statusColor: Color {
        if !model.config.reviewQueue.isEnabled || model.config.reviewQueue.preflightCommand == nil {
            return BrainBarTheme.secondaryText
        }
        if model.reviewQueueStatus.errorMessage != nil {
            return BrainBarTheme.error
        }
        if let count = model.reviewQueueStatus.pendingCount, count > 0 {
            return BrainBarTheme.warning
        }
        if model.reviewQueueStatus.pendingCount == 0 {
            return BrainBarTheme.success
        }
        return BrainBarTheme.secondaryText
    }

    private var statusPillText: String {
        if !model.config.reviewQueue.isEnabled {
            return "Off"
        }
        if model.config.reviewQueue.preflightCommand == nil {
            return "Setup"
        }
        if model.reviewQueueStatus.errorMessage != nil {
            return "Error"
        }
        if let count = model.reviewQueueStatus.pendingCount, count > 0 {
            return "\(count)"
        }
        if model.reviewQueueStatus.pendingCount == 0 {
            return "Clear"
        }
        return "Idle"
    }

    private var summaryText: String {
        if !model.config.reviewQueue.isEnabled {
            return "Review Queue is off"
        }
        if model.config.reviewQueue.preflightCommand == nil {
            return "Status command not configured"
        }
        return model.reviewQueueStatus.summary
    }

    private var emptyStateText: String {
        if !model.config.reviewQueue.isEnabled {
            return "Enable Review Queue in Settings to run a local status command."
        }
        if model.config.reviewQueue.preflightCommand == nil {
            return "Add a status command in Settings."
        }
        if model.reviewQueueStatus.pendingCount == 0 {
            return "No review items."
        }
        return "No review items loaded."
    }
}

private struct ReviewQueueItemRow: View {
    let item: ReviewQueueItem
    let model: AppModel

    var body: some View {
        HStack(alignment: .center, spacing: 8) {
            Circle()
                .fill(BrainBarTheme.secondaryText.opacity(0.55))
                .frame(width: 5, height: 5)

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(BrainBarTheme.primaryText.opacity(0.88))
                    .lineLimit(1)
                if let detail = item.detail {
                    Text(detail)
                        .font(.caption)
                        .foregroundStyle(BrainBarTheme.secondaryText)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            if canRevealIn3D {
                Button("Reveal") {
                    model.openGraphNode(GraphNodeOpenRequest(
                        action: "revealIn3D",
                        nodeId: item.nodeId?.isEmpty == false ? item.nodeId! : (item.sourceFile ?? ""),
                        label: item.title,
                        sourceFile: item.sourceFile,
                        communityId: nil,
                        targetNodeId: nil
                    ))
                }
                .buttonStyle(.borderless)
                .controlSize(.small)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(BrainBarTheme.panel.opacity(0.58), in: .rect(cornerRadius: 8))
        .overlay {
            RoundedRectangle(cornerRadius: 8)
                .stroke(BrainBarTheme.borderSubtle, lineWidth: 1)
        }
    }

    private var canRevealIn3D: Bool {
        if let nodeId = item.nodeId, !nodeId.isEmpty {
            return true
        }
        if let sourceFile = item.sourceFile, !sourceFile.isEmpty {
            return true
        }
        return false
    }
}

private struct SystemStatusMenu: View {
    let model: AppModel
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        Menu {
            Section("Status") {
                Label(vaultStatusText, systemImage: vaultStatusIcon)
                Label(graphStatusText, systemImage: graphStatusIcon)
                Label(graphifyCommandText, systemImage: graphifyCommandIcon)
                Label(model.status.gitDescription, systemImage: "point.3.connected.trianglepath.dotted")
                Label(reviewQueueStatusText, systemImage: "tray.full")
                Label(brainCheckStatusText, systemImage: "checkmark.seal")
            }

            Section("Actions") {
                if model.status.vaultPath.isEmpty || !model.status.vaultExists {
                    Button {
                        openSettings()
                    } label: {
                        Label("Choose Vault", systemImage: "folder")
                    }
                }

                if model.status.vaultExists && !model.status.graphOutputExists {
                    Button {
                        Task {
                            await model.refreshGraph()
                        }
                    } label: {
                        Label(model.isRefreshingGraph ? "Refreshing..." : "Refresh Graph", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .disabled(model.isRefreshingGraph)
                }

                if !model.config.reviewQueue.isEnabled || model.config.reviewQueue.preflightCommand == nil || model.config.commands.brainCheck == nil {
                    Button {
                        openSettings()
                    } label: {
                        Label("Open Settings", systemImage: "gearshape")
                    }
                }
            }
        } label: {
            Label("System Status", systemImage: "checklist.checked")
        }
    }

    private var vaultStatusText: String {
        if model.status.vaultPath.isEmpty {
            return "Vault: not configured"
        }
        return model.status.vaultExists ? "Vault: connected" : "Vault: path missing"
    }

    private var vaultStatusIcon: String {
        model.status.vaultExists ? "checkmark.circle" : "exclamationmark.circle"
    }

    private var graphStatusText: String {
        model.status.graphOutputExists ? "Graph output: ready" : "Graph output: missing"
    }

    private var graphStatusIcon: String {
        model.status.graphOutputExists ? "checkmark.circle" : "exclamationmark.circle"
    }

    private var graphifyCommandText: String {
        let executable = model.config.commands.refreshGraph.executable.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !executable.isEmpty else {
            return "Graphify command: not configured"
        }
        return commandLooksAvailable(executable) ? "Graphify command: available" : "Graphify command: check PATH"
    }

    private var graphifyCommandIcon: String {
        commandLooksAvailable(model.config.commands.refreshGraph.executable) ? "checkmark.circle" : "exclamationmark.circle"
    }

    private var reviewQueueStatusText: String {
        guard model.config.reviewQueue.isEnabled else {
            return "Review Queue: off"
        }
        guard model.config.reviewQueue.preflightCommand != nil else {
            return "Review Queue: configure status"
        }
        return "Review Queue: \(model.reviewQueueStatus.summary)"
    }

    private var brainCheckStatusText: String {
        guard model.config.commands.brainCheck != nil else {
            return "Brain Check: not configured"
        }
        return "Brain Check: \(model.lastBrainCheck?.summary ?? "not run")"
    }

    private func openSettings() {
        openWindow(id: "settings")
        BrainBarWindowController.bringSettingsToFront()
    }

    private func commandLooksAvailable(_ executable: String) -> Bool {
        let trimmed = executable.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return false
        }

        if trimmed.contains("/") {
            return FileManager.default.isExecutableFile(atPath: trimmed)
        }

        let path = ProcessInfo.processInfo.environment["PATH"] ?? ""
        let candidates = (path.split(separator: ":").map(String.init) + [
            FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/bin").path,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin"
        ])

        return candidates.contains { directory in
            FileManager.default.isExecutableFile(atPath: URL(fileURLWithPath: directory).appendingPathComponent(trimmed).path)
        }
    }
}

private struct GraphSourceLensMenu: View {
    let selectedLens: GraphSourceLens
    let onSelect: (GraphSourceLens) -> Void

    var body: some View {
        Menu {
            ForEach(GraphSourceLens.allCases) { lens in
                Button {
                    onSelect(lens)
                } label: {
                    HStack {
                        Image(systemName: "checkmark")
                            .opacity(selectedLens == lens ? 1 : 0)
                        Text(lens.label)
                    }
                }
                .help(lens.help)
            }
        } label: {
            HStack(spacing: 6) {
                Text("Source")
                    .foregroundStyle(BrainBarTheme.secondaryText)
                Text(selectedLens.label)
                    .foregroundStyle(BrainBarTheme.primaryText.opacity(0.92))
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(BrainBarTheme.mutedText)
            }
            .font(.system(size: 12, weight: .semibold))
            .lineLimit(1)
            .padding(.horizontal, 8)
            .frame(height: 25)
            .contentShape(.rect(cornerRadius: 7))
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .background(BrainBarTheme.panel.opacity(0.24), in: .rect(cornerRadius: 7))
        .overlay {
            RoundedRectangle(cornerRadius: 7)
                .stroke(BrainBarTheme.borderSubtle, lineWidth: 1)
        }
        .help("Source lens: \(selectedLens.label)")
    }
}

private struct GraphModeSwitcher: View {
    let selectedMode: GraphViewMode
    let onSelect: (GraphViewMode) -> Void

    var body: some View {
        HStack(spacing: 2) {
            ForEach(GraphViewMode.allCases) { mode in
                GraphModeButton(
                    mode: mode,
                    isSelected: selectedMode == mode,
                    onSelect: onSelect
                )
            }
        }
        .padding(1)
        .background(BrainBarTheme.panel.opacity(0.24), in: .rect(cornerRadius: 7))
        .overlay {
            RoundedRectangle(cornerRadius: 7)
                .stroke(BrainBarTheme.borderSubtle, lineWidth: 1)
        }
    }
}

private struct GraphModeButton: View {
    let mode: GraphViewMode
    let isSelected: Bool
    let onSelect: (GraphViewMode) -> Void

    var body: some View {
        Button {
            onSelect(mode)
        } label: {
            Text(mode.label)
                .font(.system(size: 12, weight: .semibold))
                .lineLimit(1)
                .frame(width: 35, height: 23)
                .contentShape(.rect)
        }
        .buttonStyle(.plain)
        .foregroundColor(isSelected ? BrainBarTheme.primaryText : BrainBarTheme.secondaryText)
        .background {
            GraphModeSelectionBackground(isSelected: isSelected)
        }
        .help(mode.help)
        .accessibilityLabel(mode.label)
        .accessibilityHint(mode.help)
    }
}

private struct GraphModeSelectionBackground: View {
    let isSelected: Bool

    var body: some View {
        if isSelected {
            RoundedRectangle(cornerRadius: 6)
                .fill(BrainBarTheme.accent.opacity(0.13))
                .overlay {
                    RoundedRectangle(cornerRadius: 6)
                        .stroke(BrainBarTheme.accent.opacity(0.14), lineWidth: 1)
                }
        }
    }
}

private struct GraphViewportControls: View {
    let showsTopView: Bool
    let onZoomOut: () -> Void
    let onZoomIn: () -> Void
    let onFit: () -> Void
    let onTopView: () -> Void
    let onResetTilt: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            ChromeIconButton(systemImage: "minus.magnifyingglass", help: "Zoom out", action: onZoomOut)
            ChromeIconButton(systemImage: "plus.magnifyingglass", help: "Zoom in", action: onZoomIn)
            ChromeIconButton(systemImage: "arrow.up.left.and.down.right.magnifyingglass", help: "Fit graph", action: onFit)
            if showsTopView {
                ChromeIconButton(systemImage: "viewfinder", help: "Top view", action: onTopView)
                ChromeIconButton(systemImage: "rotate.3d", help: "Reset tilt", action: onResetTilt)
            }
        }
        .padding(.horizontal, 2)
    }
}

private struct ThreeDFallbackBadge: View {
    var body: some View {
        Label("3D paused", systemImage: "pause.circle")
            .font(.caption.weight(.semibold))
            .foregroundStyle(BrainBarTheme.secondaryText)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(BrainBarTheme.elevated.opacity(0.62), in: Capsule())
            .overlay {
                Capsule()
                    .stroke(BrainBarTheme.border, lineWidth: 1)
            }
            .help("Using the stable graph renderer while the 3D renderer is paused.")
    }
}

private struct InlineStatus: View {
    let text: String
    let systemImage: String

    var body: some View {
        if !text.isEmpty {
            Label(text, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(BrainBarTheme.secondaryText)
                .symbolRenderingMode(.hierarchical)
                .lineLimit(1)
                .truncationMode(.middle)
        }
    }
}

private struct VaultStatusText: View {
    let text: String

    var body: some View {
        if !text.isEmpty {
            HStack(spacing: 5) {
                Image(systemName: "point.3.connected.trianglepath.dotted")
                    .font(.system(size: 10, weight: .medium))
                    .symbolRenderingMode(.hierarchical)
                Text(text)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .font(.system(size: 12, weight: .semibold))
            .foregroundStyle(BrainBarTheme.secondaryText)
            .accessibilityLabel(text)
        }
    }
}

private struct ChromeIconButton: View {
    let systemImage: String
    let help: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 14, weight: .medium))
                .frame(width: 27, height: 27)
                .contentShape(.rect(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .foregroundStyle(BrainBarTheme.secondaryText)
        .background(BrainBarTheme.panel.opacity(0.001), in: .rect(cornerRadius: 7))
        .help(help)
    }
}

private struct EmptyGraphStateView: View {
    let title: String
    let detail: String
    let systemImage: String
    let buttonTitle: String
    let buttonSystemImage: String
    var steps: [String] = []
    let action: () -> Void

    var body: some View {
        VStack(spacing: 15) {
            Image(systemName: systemImage)
                .font(.system(size: 42, weight: .regular))
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            if !steps.isEmpty {
                HStack(spacing: 8) {
                    ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                        HStack(spacing: 5) {
                            Text("\(index + 1)")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(BrainBarTheme.secondaryText)
                                .frame(width: 17, height: 17)
                                .background(.white.opacity(0.08), in: Circle())
                            Text(step)
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .lineLimit(1)
            }
            Button(action: action) {
                Label(buttonTitle, systemImage: buttonSystemImage)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.small)
            .disabled(buttonTitle == "Refreshing...")
        }
        .padding(28)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(BrainBarTheme.panel.opacity(0.78), in: .rect(cornerRadius: 10))
        .overlay {
            RoundedRectangle(cornerRadius: 10)
                .stroke(BrainBarTheme.border, lineWidth: 1)
        }
    }
}

private struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.caption)
            .foregroundStyle(BrainBarTheme.error)
            .lineLimit(2)
            .textSelection(.enabled)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(BrainBarTheme.error.opacity(0.10), in: .rect(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(BrainBarTheme.error.opacity(0.16), lineWidth: 1)
            }
    }
}
