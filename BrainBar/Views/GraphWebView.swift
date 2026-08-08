import Foundation
import SwiftUI
import WebKit

struct GraphWebView: NSViewRepresentable {
    let fileURL: URL
    let readAccessURL: URL
    let reloadToken: Int
    let sourceLens: GraphSourceLens
    let reviewQueueStatus: ReviewQueueStatus
    let agentActivitySnapshot: AgentActivitySnapshot
    let workflowSelectionID: String?
    var sessionState: GraphSessionState = GraphSessionState()
    let viewportCommand: GraphViewportCommand?
    let cancellationRequest: GraphLoadCancellationRequest?
    let onLoadEvent: @MainActor (GraphRendererLoadEvent, Int) -> Void
    let onOpenNode: @MainActor (GraphNodeOpenRequest) -> Void
    var onSessionState: @MainActor (GraphSessionState) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(onLoadEvent: onLoadEvent, onOpenNode: onOpenNode, onSessionState: onSessionState)
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        for userScript in Self.userScripts() {
            configuration.userContentController.addUserScript(userScript)
        }
        configuration.userContentController.add(context.coordinator, name: "brainBarNodeAction")
        configuration.userContentController.add(context.coordinator, name: "brainBarGraphSession")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsMagnification = true
        webView.setValue(false, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator
        context.coordinator.sourceLens = sourceLens
        context.coordinator.sessionState = sessionState
        context.coordinator.reviewQueueScript = Self.reviewQueueTargetsScript(status: reviewQueueStatus)
        context.coordinator.agentActivitySnapshot = agentActivitySnapshot
        context.coordinator.workflowSelectionID = workflowSelectionID
        context.coordinator.pendingViewportCommand = viewportCommand
        let graphMetadataPayload = Self.graphMetadataPayload(readAccessURL: readAccessURL)
        context.coordinator.graphMetadataVersion = graphMetadataPayload.version
        context.coordinator.graphMetadataScript = graphMetadataPayload.script
        load(in: webView, context: context)
        context.coordinator.cancelGraphLoadIfNeeded(cancellationRequest, in: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onOpenNode = onOpenNode
        context.coordinator.onSessionState = onSessionState
        context.coordinator.onLoadEvent = onLoadEvent
        let didChangeLens = context.coordinator.sourceLens != sourceLens
        context.coordinator.sourceLens = sourceLens
        let graphMetadataPayload = Self.graphMetadataPayload(readAccessURL: readAccessURL)
        let didUpdateGraphMetadata = context.coordinator.graphMetadataVersion != graphMetadataPayload.version
        context.coordinator.graphMetadataVersion = graphMetadataPayload.version
        context.coordinator.graphMetadataScript = graphMetadataPayload.script
        let reviewQueueScript = Self.reviewQueueTargetsScript(status: reviewQueueStatus)
        let didUpdateReviewQueue = context.coordinator.reviewQueueScript != reviewQueueScript
        if didUpdateReviewQueue {
            context.coordinator.reviewQueueScript = reviewQueueScript
        }
        let didUpdateAgentActivity = context.coordinator.agentActivitySnapshot != agentActivitySnapshot
        if didUpdateAgentActivity {
            context.coordinator.agentActivitySnapshot = agentActivitySnapshot
        }
        let didUpdateWorkflowSelection = context.coordinator.workflowSelectionID != workflowSelectionID
        if didUpdateWorkflowSelection {
            context.coordinator.workflowSelectionID = workflowSelectionID
        }
        context.coordinator.pendingViewportCommand = viewportCommand
        let didChangeSession = context.coordinator.sessionState != sessionState
        context.coordinator.sessionState = sessionState

        let didLoad = load(in: webView, context: context)
        let didCancel = context.coordinator.cancelGraphLoadIfNeeded(cancellationRequest, in: webView)
        guard !didLoad, !didCancel, context.coordinator.graphReady else {
            return
        }

        if didUpdateReviewQueue {
            context.coordinator.applyReviewQueueTargets(in: webView)
        }
        if didUpdateAgentActivity {
            context.coordinator.applyAgentActivity(in: webView)
        }
        if didUpdateWorkflowSelection {
            context.coordinator.applyWorkflowSelection(in: webView)
        }
        context.coordinator.applyViewportCommandIfNeeded(viewportCommand, in: webView)
        if didChangeSession {
            context.coordinator.applySessionStateIfNeeded(sessionState, in: webView)
        }
        if didUpdateGraphMetadata || didChangeLens {
            context.coordinator.applyLens(sourceLens, in: webView)
        }
    }

    @discardableResult
    private func load(in webView: WKWebView, context: Context) -> Bool {
        context.coordinator.requestLoad(
            fileURL: fileURL,
            readAccessURL: readAccessURL,
            reloadToken: reloadToken,
            in: webView
        )
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        private struct PendingLoad {
            let fileURL: URL
            let readAccessURL: URL
            let attempt: Int
        }

        var loadedURL: URL?
        var activeNavigation: WKNavigation?
        var reloadToken = -1
        var sourceLens: GraphSourceLens = .all
        var graphMetadataVersion = ""
        var graphMetadataScript = ""
        var reviewQueueScript = ""
        var agentActivitySnapshot: AgentActivitySnapshot = .empty
        var workflowSelectionID: String?
        var pendingViewportCommand: GraphViewportCommand?
        var sessionState = GraphSessionState()
        private var lastAppliedSessionState: GraphSessionState?
        var graphReady = false
        var lastViewportCommandID = -1
        private var graphLoadAttempt = -1
        private var cancelledGraphLoadAttempt: Int?
        private var lastCancellationRequestID: Int?
        private var pendingLoad: PendingLoad?
        private var offlineRuntimeReady = false
        private var offlineRuntimePreparing = false
        var onLoadEvent: @MainActor (GraphRendererLoadEvent, Int) -> Void
        var onOpenNode: @MainActor (GraphNodeOpenRequest) -> Void
        var onSessionState: @MainActor (GraphSessionState) -> Void

        init(
            onLoadEvent: @escaping @MainActor (GraphRendererLoadEvent, Int) -> Void = { _, _ in },
            onOpenNode: @escaping @MainActor (GraphNodeOpenRequest) -> Void,
            onSessionState: @escaping @MainActor (GraphSessionState) -> Void = { _ in }
        ) {
            self.onLoadEvent = onLoadEvent
            self.onOpenNode = onOpenNode
            self.onSessionState = onSessionState
        }

        @discardableResult
        func requestLoad(
            fileURL: URL,
            readAccessURL: URL,
            reloadToken: Int,
            in webView: WKWebView
        ) -> Bool {
            guard loadedURL != fileURL || self.reloadToken != reloadToken else {
                return false
            }
            loadedURL = fileURL
            self.reloadToken = reloadToken
            beginGraphLoad(attempt: reloadToken)
            pendingLoad = PendingLoad(
                fileURL: fileURL,
                readAccessURL: readAccessURL,
                attempt: reloadToken
            )
            prepareOfflineRuntimeIfNeeded(in: webView)
            return true
        }

        private func prepareOfflineRuntimeIfNeeded(in webView: WKWebView) {
            if offlineRuntimeReady {
                startPendingLoad(in: webView)
                return
            }
            guard !offlineRuntimePreparing else {
                return
            }
            offlineRuntimePreparing = true
            Graph2DOfflineRuntime.installContentRule(
                in: webView.configuration.userContentController
            ) { [weak self, weak webView] _ in
                guard let self, let webView else {
                    return
                }
                self.offlineRuntimePreparing = false
                self.offlineRuntimeReady = true
                self.startPendingLoad(in: webView)
            }
        }

        private func startPendingLoad(in webView: WKWebView) {
            guard let pendingLoad else {
                return
            }
            self.pendingLoad = nil
            guard
                pendingLoad.attempt == graphLoadAttempt,
                !isGraphLoadCancelled(attempt: pendingLoad.attempt)
            else {
                return
            }
            activeNavigation = webView.loadFileURL(
                pendingLoad.fileURL,
                allowingReadAccessTo: pendingLoad.readAccessURL
            )
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let navigation, navigation === activeNavigation else {
                return
            }
            applyReviewQueueTargets(in: webView)
            applyAgentActivity(in: webView)
            applyWorkflowSelection(in: webView)
            applyLens(sourceLens, in: webView) { [weak self] error in
                guard let self, navigation === self.activeNavigation else {
                    return
                }
                guard error == nil else {
                    self.reportLoadFailure(.rendererFailed)
                    return
                }
                self.verifyRendererReadiness(in: webView, navigation: navigation)
            }
        }

        func webView(
            _ webView: WKWebView,
            didFailProvisionalNavigation navigation: WKNavigation!,
            withError error: Error
        ) {
            reportNavigationFailure(error, navigation: navigation)
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            reportNavigationFailure(error, navigation: navigation)
        }

        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            reportLoadFailure(.rendererFailed)
        }

        @discardableResult
        func cancelGraphLoadIfNeeded(
            _ request: GraphLoadCancellationRequest?,
            in webView: WKWebView
        ) -> Bool {
            guard let request, request.id != lastCancellationRequestID else {
                return false
            }
            lastCancellationRequestID = request.id
            guard request.attempt == graphLoadAttempt, !graphReady else {
                return false
            }
            cancelledGraphLoadAttempt = request.attempt
            activeNavigation = nil
            pendingLoad = nil
            graphReady = false
            webView.stopLoading()
            webView.evaluateJavaScript("window.stop();") { _, _ in }
            return true
        }

        func isGraphLoadCancelled(attempt: Int) -> Bool {
            cancelledGraphLoadAttempt == attempt
        }

        func applyReviewQueueTargets(in webView: WKWebView) {
            let script = """
            \(reviewQueueScript)
            if (window.brainBarApplyReviewQueueTargets) {
              window.brainBarApplyReviewQueueTargets(window.__brainBarReviewQueueTargets || []);
            }
            """
            webView.evaluateJavaScript(script)
        }

        func applyAgentActivity(in webView: WKWebView) {
            let script = """
            if (window.brainBarApplyAgentActivity2D) {
              window.brainBarApplyAgentActivity2D(\(GraphWebView.agentActivityJSON(agentActivitySnapshot)));
            }
            """
            webView.evaluateJavaScript(script)
        }

        func applyWorkflowSelection(in webView: WKWebView) {
            let value = GraphWebView.jsStringLiteral(workflowSelectionID ?? "")
            webView.evaluateJavaScript("if (window.brainBarApplyWorkflowHighlight2D) { window.brainBarApplyWorkflowHighlight2D(\(value)); }")
        }

        func applyViewportCommandIfNeeded(_ command: GraphViewportCommand?, in webView: WKWebView) {
            guard let command, lastViewportCommandID != command.id else {
                return
            }
            lastViewportCommandID = command.id
            let script: String
            switch command.kind {
            case .fit:
                script = "if (window.network && window.network.fit) { window.network.fit({ animation: { duration: 240, easingFunction: 'easeInOutQuad' } }); }"
            case .zoomIn:
                script = "if (window.network && window.network.moveTo) { const scale = window.network.getScale ? window.network.getScale() : 1; window.network.moveTo({ scale: scale * 1.18 }); }"
            case .zoomOut:
                script = "if (window.network && window.network.moveTo) { const scale = window.network.getScale ? window.network.getScale() : 1; window.network.moveTo({ scale: scale * 0.8474576271 }); }"
            case .topView, .resetTilt:
                script = ""
            case .graphHealth:
                script = "if (window.brainBarShowGraphHealth) { window.brainBarShowGraphHealth(); }"
            case .revealNode3D, .pathFromNode3D, .showCommunity3D:
                script = ""
            }
            guard !script.isEmpty else {
                return
            }
            webView.evaluateJavaScript(script)
        }

        func applyLens(
            _ lens: GraphSourceLens,
            in webView: WKWebView,
            completion: ((Error?) -> Void)? = nil
        ) {
            let script = """
            \(graphMetadataScript)
            window.__brainBarPendingGraphLens = "\(lens.rawValue)";
            if (window.brainBarApplyGraphLens) {
              window.brainBarApplyGraphLens("\(lens.rawValue)");
            }
            """
            let attempt = graphLoadAttempt
            webView.evaluateJavaScript(script) { [weak self] _, error in
                guard let self, attempt == self.graphLoadAttempt else {
                    return
                }
                if error != nil, completion == nil {
                    self.reportLoadFailure(.rendererFailed)
                }
                completion?(error)
            }
        }

        private func verifyRendererReadiness(in webView: WKWebView, navigation: WKNavigation) {
            let script = """
            (() => {
              const diagnostics = window.brainBarRendererDiagnostics2D;
              if (typeof diagnostics !== 'function') {
                return 'runtimeUnavailable';
              }
              const result = diagnostics();
              return result?.networkAvailable === true ? 'ready' : 'runtimeUnavailable';
            })()
            """
            webView.evaluateJavaScript(script) { [weak self] result, error in
                guard let self, navigation === self.activeNavigation else {
                    return
                }
                let readiness = error == nil ? result as? String : nil
                let isReady = readiness == "ready"
                let stateScript = isReady
                    ? "document.documentElement.classList.remove('brainbar-graph-preparing'); document.documentElement.classList.add('brainbar-graph-ready');"
                    : "document.documentElement.classList.remove('brainbar-graph-ready'); document.documentElement.classList.add('brainbar-graph-preparing');"
                webView.evaluateJavaScript(stateScript)
                if isReady {
                    self.graphReady = true
                    self.applyViewportCommandIfNeeded(self.pendingViewportCommand, in: webView)
                    self.applySessionStateIfNeeded(self.sessionState, in: webView)
                    self.emitLoadEvent(.ready)
                } else {
                    self.reportLoadFailure(
                        readiness == "runtimeUnavailable"
                            ? .twoDRuntimeUnavailable
                            : .rendererFailed
                    )
                }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else {
                return
            }

            if message.name == "brainBarGraphSession" {
                guard let state = GraphWebView.decodeGraphSessionState(body) else {
                    return
                }
                sessionState = state
                lastAppliedSessionState = state
                Task { @MainActor in
                    onSessionState(state)
                }
                return
            }

            guard message.name == "brainBarNodeAction" else {
                return
            }

            let request = GraphNodeOpenRequest(
                action: String(describing: body["action"] ?? ""),
                nodeId: String(describing: body["nodeId"] ?? ""),
                label: String(describing: body["label"] ?? ""),
                sourceFile: body["sourceFile"] as? String,
                communityId: body["communityId"] as? String,
                targetNodeId: body["targetNodeId"] as? String
            )
            Task { @MainActor in
                onOpenNode(request)
            }
        }

        func applySessionStateIfNeeded(_ state: GraphSessionState, in webView: WKWebView) {
            guard graphReady, lastAppliedSessionState != state else {
                return
            }
            lastAppliedSessionState = state
            let script = "if (window.brainBarApplyGraphSessionState) { window.brainBarApplyGraphSessionState(\(GraphWebView.graphSessionJSON(state))); }"
            webView.evaluateJavaScript(script)
        }

        func beginGraphLoad(attempt: Int) {
            graphLoadAttempt = attempt
            graphReady = false
            cancelledGraphLoadAttempt = nil
            emitLoadEvent(.loading)
        }

        private func reportNavigationFailure(_ error: Error, navigation: WKNavigation?) {
            guard let navigation, navigation === activeNavigation else {
                return
            }
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else {
                return
            }
            reportLoadFailure(.navigationFailed)
        }

        private func reportLoadFailure(_ reason: GraphLoadFailure) {
            graphReady = false
            guard !isGraphLoadCancelled(attempt: graphLoadAttempt) else {
                return
            }
            emitLoadEvent(.failed(reason))
        }

        private func emitLoadEvent(_ event: GraphRendererLoadEvent) {
            guard graphLoadAttempt >= 0 else {
                return
            }
            let attempt = graphLoadAttempt
            Task { @MainActor [onLoadEvent] in
                onLoadEvent(event, attempt)
            }
        }
    }
}

@MainActor
enum Graph2DOfflineRuntime {
    static let contentRuleIdentifier = "BrainBarGraph2DOfflineVisNetwork916"
    static let encodedContentRuleList = #"""
    [
      {
        "trigger": {
          "url-filter": "^https://unpkg\\.com/vis-network@9\\.1\\.6/standalone/umd/vis-network(?:\\.min)?\\.js(?:\\?.*)?$"
        },
        "action": { "type": "block" }
      }
    ]
    """#

    static func installContentRule(
        in controller: WKUserContentController,
        completion: @escaping @MainActor (Bool) -> Void
    ) {
        WKContentRuleListStore.default().compileContentRuleList(
            forIdentifier: contentRuleIdentifier,
            encodedContentRuleList: encodedContentRuleList
        ) { rule, _ in
            Task { @MainActor in
                if let rule {
                    controller.add(rule)
                }
                completion(rule != nil)
            }
        }
    }
}

enum GraphNodeFileMetadata {
    static func json(graphObject: Any, readAccessURL: URL) -> String {
        guard
            let graph = graphObject as? [String: Any],
            let nodes = graph["nodes"] as? [[String: Any]]
        else {
            return "{ \"byNodeId\": {}, \"bySourceFile\": {} }"
        }

        let vaultURL = readAccessURL.deletingLastPathComponent().standardizedFileURL
        var byNodeId: [String: [String: Any]] = [:]
        var bySourceFile: [String: [String: Any]] = [:]

        for node in nodes {
            guard
                let idValue = node["id"],
                let sourceFile = (node["source_file"] as? String) ?? (node["_source_file"] as? String),
                !sourceFile.isEmpty,
                let fileURL = resolvedVaultFileURL(sourceFile, vaultURL: vaultURL)
            else {
                continue
            }

            let resourceValues = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey])
            guard let modifiedAt = resourceValues?.contentModificationDate?.timeIntervalSince1970 else {
                continue
            }

            let entry: [String: Any] = [
                "source_file": sourceFile,
                "mtime": modifiedAt
            ]
            byNodeId[String(describing: idValue)] = entry
            bySourceFile[sourceFile] = entry
        }

        let payload: [String: Any] = [
            "byNodeId": byNodeId,
            "bySourceFile": bySourceFile
        ]
        guard
            let data = try? JSONSerialization.data(withJSONObject: payload),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{ \"byNodeId\": {}, \"bySourceFile\": {} }"
        }
        return json
    }

    private static func resolvedVaultFileURL(_ sourceFile: String, vaultURL: URL) -> URL? {
        guard
            !sourceFile.hasPrefix("/"),
            !sourceFile.split(separator: "/").contains(where: { $0 == ".." })
        else {
            return nil
        }
        let resolved = vaultURL.appendingPathComponent(sourceFile).standardizedFileURL
        guard resolved.path.hasPrefix(vaultURL.path + "/") || resolved.path == vaultURL.path else {
            return nil
        }
        return resolved
    }
}

struct GraphMetadataPayload: Equatable {
    let version: String
    let script: String
}

@MainActor
enum GraphMetadataPayloadCache {
    private static var scriptsByVersion: [String: String] = [:]

    static func payload(readAccessURL: URL) -> GraphMetadataPayload {
        let graphJSONURL = readAccessURL.appendingPathComponent("graph.json").standardizedFileURL
        let fileValues = try? graphJSONURL.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let modifiedAt = fileValues?.contentModificationDate?.timeIntervalSince1970
        let fileSize = fileValues?.fileSize
        let version: String
        if let modifiedAt, let fileSize {
            version = "\(graphJSONURL.path):\(modifiedAt):\(fileSize)"
        } else {
            version = "\(graphJSONURL.path):missing"
        }

        if let cached = cachedScript(for: version) {
            return GraphMetadataPayload(version: version, script: cached)
        }

        let script = buildScript(graphJSONURL: graphJSONURL, version: version, readAccessURL: readAccessURL)
        cache(script, for: version)
        return GraphMetadataPayload(version: version, script: script)
    }

    private static func cachedScript(for version: String) -> String? {
        scriptsByVersion[version]
    }

    private static func cache(_ script: String, for version: String) {
        scriptsByVersion[version] = script
        if scriptsByVersion.count > 6 {
            scriptsByVersion.remove(at: scriptsByVersion.startIndex)
        }
    }

    private static func buildScript(graphJSONURL: URL, version: String, readAccessURL: URL) -> String {
        guard
            let data = try? Data(contentsOf: graphJSONURL),
            let object = try? JSONSerialization.jsonObject(with: data),
            let normalizedData = try? JSONSerialization.data(withJSONObject: object),
            let json = String(data: normalizedData, encoding: .utf8)
        else {
            return """
            window.__brainBarGraphJSONVersion = \(GraphWebView.jsStringLiteral(version));
            window.__brainBarGraphJSON = null;
            window.__brainBarNodeFileMetadata = { byNodeId: {}, bySourceFile: {} };
            """
        }

        return """
        window.__brainBarGraphJSONVersion = \(GraphWebView.jsStringLiteral(version));
        window.__brainBarGraphJSON = \(json);
        window.__brainBarNodeFileMetadata = \(GraphNodeFileMetadata.json(graphObject: object, readAccessURL: readAccessURL));
        """
    }
}

extension GraphWebView {
    static func userScripts() -> [WKUserScript] {
        var scripts: [WKUserScript] = []
        if let visNetwork = bundledResourceString(
            name: "vis-network.min",
            extension: "js",
            subdirectory: "Graph2D/Vendor/vis-network-9.1.6"
        ) {
            scripts.append(
                WKUserScript(
                    source: offlineVisNetworkBootstrapScript(visNetwork),
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }
        if let css = bundledResourceString(name: "brainbar-graph-theme", extension: "css", subdirectory: "Graph2D") {
            scripts.append(
                WKUserScript(
                    source: styleInjectionScript(css: css),
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }
        if let evidence = bundledResourceString(name: "brainbar-graph-evidence", extension: "js", subdirectory: "GraphEvidence") {
            scripts.append(
                WKUserScript(
                    source: evidence,
                    injectionTime: .atDocumentStart,
                    forMainFrameOnly: true
                )
            )
        }
        if let runtime = bundledResourceString(name: "brainbar-graph-runtime", extension: "js", subdirectory: "Graph2D") {
            scripts.append(
                WKUserScript(
                    source: runtime,
                    injectionTime: .atDocumentEnd,
                    forMainFrameOnly: true
                )
            )
        }
        return scripts
    }

    static func offlineVisNetworkBootstrapScript(_ source: String) -> String {
        let sourceLiteral = jsStringLiteral(source)
        return """
        (() => {
          const source = \(sourceLiteral);
          let namespace;
          Object.defineProperty(window, "vis", {
            configurable: true,
            get() {
              if (namespace) {
                Object.defineProperty(window, "vis", {
                  configurable: true,
                  writable: true,
                  value: namespace
                });
                return namespace;
              }
              delete window.vis;
              try {
                Function(source).call(window);
                namespace = window.vis;
              } catch (_) {
                window.__brainBarOfflineVisRuntimeError = "Vis Network runtime unavailable";
                namespace = {};
              }
              Object.defineProperty(window, "vis", {
                configurable: true,
                writable: true,
                value: namespace
              });
              return namespace;
            },
            set(value) {
              namespace = value;
            }
          });
        })();
        """
    }

    static func graphMetadataPayload(readAccessURL: URL) -> GraphMetadataPayload {
        GraphMetadataPayloadCache.payload(readAccessURL: readAccessURL)
    }

    static func graphMetadataScript(readAccessURL: URL) -> String {
        graphMetadataPayload(readAccessURL: readAccessURL).script
    }

    static func reviewQueueTargetsScript(status: ReviewQueueStatus) -> String {
        let targets = status.items.compactMap { item -> [String: String]? in
            var target: [String: String] = [:]
            if let nodeId = item.nodeId, !nodeId.isEmpty {
                target["node_id"] = nodeId
            }
            if let sourceFile = item.sourceFile, !sourceFile.isEmpty {
                target["source_file"] = sourceFile
            }
            guard !target.isEmpty else {
                return nil
            }
            target["title"] = item.title
            return target
        }

        guard
            let data = try? JSONSerialization.data(withJSONObject: targets),
            let json = String(data: data, encoding: .utf8)
        else {
            return "window.__brainBarReviewQueueTargets = [];"
        }

        return "window.__brainBarReviewQueueTargets = \(json);"
    }

    static func agentActivityJSON(_ snapshot: AgentActivitySnapshot) -> String {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard
            let data = try? encoder.encode(snapshot),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    static func graphSessionJSON(_ state: GraphSessionState) -> String {
        guard
            let data = try? JSONEncoder().encode(state),
            let json = String(data: data, encoding: .utf8)
        else {
            return "{}"
        }
        return json
    }

    static func decodeGraphSessionState(_ object: [String: Any]) -> GraphSessionState? {
        guard
            JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object),
            let state = try? JSONDecoder().decode(GraphSessionState.self, from: data),
            state.schemaVersion == GraphSessionState.currentSchemaVersion
        else {
            return nil
        }
        return state.normalized
    }

    static func bundledResourceString(name: String, extension fileExtension: String, subdirectory: String) -> String? {
        guard
            let url = Bundle.main.url(forResource: name, withExtension: fileExtension, subdirectory: subdirectory),
            let contents = try? String(contentsOf: url, encoding: .utf8)
        else {
            assertionFailure("Missing bundled graph resource: \(subdirectory)/\(name).\(fileExtension)")
            return nil
        }
        return contents
    }

    static func styleInjectionScript(css: String) -> String {
        """
        (() => {
          const root = document.documentElement;
          root.classList.add('brainbar-graph-preparing');
          const existing = document.getElementById('brainbar-graph-theme');
          if (existing) {
            existing.remove();
          }
          const style = document.createElement('style');
          style.id = 'brainbar-graph-theme';
          style.textContent = \(jsStringLiteral(css));
          (document.head || root).appendChild(style);
        })();
        """
    }

    static func jsStringLiteral(_ value: String) -> String {
        guard
            let data = try? JSONSerialization.data(withJSONObject: [value]),
            let arrayLiteral = String(data: data, encoding: .utf8),
            arrayLiteral.hasPrefix("["),
            arrayLiteral.hasSuffix("]")
        else {
            return "\"\""
        }
        return String(arrayLiteral.dropFirst().dropLast())
    }
}
