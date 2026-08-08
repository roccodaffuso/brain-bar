import AppKit
import Foundation
import SwiftUI
import WebKit

struct Graph3DWebView: NSViewRepresentable {
    let readAccessURL: URL
    let graphDataStore: GraphDataStore
    let reloadToken: Int
    let sourceLens: GraphSourceLens
    var sessionState: GraphSessionState = GraphSessionState()
    let resetCameraToken: Int
    let viewportCommand: GraphViewportCommand?
    let cancellationRequest: GraphLoadCancellationRequest?
    let agentActivitySnapshot: AgentActivitySnapshot
    let workflowSelectionID: String?
    let onDiagnostic: @MainActor (String) -> Void
    let onLoadEvent: @MainActor (GraphRendererLoadEvent, Int) -> Void
    let onOpenNode: @MainActor (GraphNodeOpenRequest) -> Void
    var onSessionState: @MainActor (GraphSessionState) -> Void = { _ in }

    func makeCoordinator() -> Coordinator {
        Coordinator(
            graphDataStore: graphDataStore,
            onDiagnostic: onDiagnostic,
            onLoadEvent: onLoadEvent,
            onOpenNode: onOpenNode,
            onSessionState: onSessionState
        )
    }

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(context.coordinator, forURLScheme: "brainbar3d")
        configuration.userContentController.add(context.coordinator, name: "brainBarNodeAction")
        configuration.userContentController.add(context.coordinator, name: "brainBarGraphDiagnostic")
        configuration.userContentController.add(context.coordinator, name: "brainBarGraphSession")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.allowsMagnification = true
        webView.wantsLayer = true
        webView.layer?.backgroundColor = NSColor(red: 0.02, green: 0.025, blue: 0.04, alpha: 1).cgColor
        webView.setValue(true, forKey: "drawsBackground")
        webView.navigationDelegate = context.coordinator

        context.coordinator.sourceLens = sourceLens
        context.coordinator.sessionState = sessionState
        context.coordinator.resetCameraToken = resetCameraToken
        context.coordinator.graphResourceVersion = Self.graphResourceVersion(readAccessURL: readAccessURL)
        context.coordinator.agentActivitySnapshot = agentActivitySnapshot
        context.coordinator.workflowSelectionID = workflowSelectionID
        load(in: webView, context: context)
        context.coordinator.cancelGraphLoadIfNeeded(cancellationRequest, in: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        context.coordinator.onOpenNode = onOpenNode
        context.coordinator.onDiagnostic = onDiagnostic
        context.coordinator.onLoadEvent = onLoadEvent
        context.coordinator.onSessionState = onSessionState
        let didChangeLens = context.coordinator.sourceLens != sourceLens
        context.coordinator.sourceLens = sourceLens
        let graphResourceVersion = Self.graphResourceVersion(readAccessURL: readAccessURL)
        let didChangeGraph = context.coordinator.graphResourceVersion != graphResourceVersion
        context.coordinator.graphResourceVersion = graphResourceVersion
        let didLoad = load(in: webView, context: context, force: didChangeGraph)
        let didCancel = context.coordinator.cancelGraphLoadIfNeeded(cancellationRequest, in: webView)
        context.coordinator.pendingViewportCommand = viewportCommand
        let didChangeSession = context.coordinator.sessionState != sessionState
        context.coordinator.sessionState = sessionState
        if context.coordinator.agentActivitySnapshot != agentActivitySnapshot {
            context.coordinator.agentActivitySnapshot = agentActivitySnapshot
            if context.coordinator.graphReady {
                context.coordinator.applyAgentActivity(agentActivitySnapshot, in: webView)
            }
        }
        if context.coordinator.workflowSelectionID != workflowSelectionID {
            context.coordinator.workflowSelectionID = workflowSelectionID
            if context.coordinator.graphReady {
                context.coordinator.applyWorkflowSelection(in: webView)
            }
        }

        if didLoad || didCancel {
            return
        }

        if didChangeLens, context.coordinator.graphReady {
            context.coordinator.applyLens(sourceLens, in: webView)
        }

        if context.coordinator.resetCameraToken != resetCameraToken {
            context.coordinator.resetCameraToken = resetCameraToken
            context.coordinator.resetCamera(in: webView)
        }

        if didChangeSession, context.coordinator.graphReady {
            context.coordinator.applySessionStateIfNeeded(sessionState, in: webView)
        }

        context.coordinator.applyViewportCommandIfNeeded(viewportCommand, in: webView)
    }

    @discardableResult
    private func load(in webView: WKWebView, context: Context, force: Bool = false) -> Bool {
        guard force || context.coordinator.reloadToken != reloadToken else {
            return false
        }
        let wasLoaded = context.coordinator.reloadToken >= 0
        context.coordinator.reloadToken = reloadToken
        let policy: GraphDataPreparePolicy = wasLoaded || force ? .retry : .normal
        context.coordinator.prepareGraph(
            url: readAccessURL.appendingPathComponent("graph.json"),
            policy: policy,
            attempt: reloadToken,
            in: webView
        )
        return true
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKURLSchemeHandler {
        private final class SchemeTaskState {
            let task: WKURLSchemeTask
            let requestURL: URL
            var deliveryTask: Task<Void, Never>?
            var stopped = false
            var finished = false

            init(task: WKURLSchemeTask, requestURL: URL) {
                self.task = task
                self.requestURL = requestURL
            }
        }

        private struct SchemeResource: Sendable {
            let data: Data
            let mimeType: String
            let textEncodingName: String?
        }

        var indexURL: URL?
        var activeNavigation: WKNavigation?
        var reloadToken = -1
        var sourceLens: GraphSourceLens = .all
        var resetCameraToken = 0
        var lastViewportCommandID: Int?
        var pendingViewportCommand: GraphViewportCommand?
        var sessionState = GraphSessionState()
        private var lastAppliedSessionState: GraphSessionState?
        var graphResourceVersion = ""
        var graphReady = false
        private var graphLoadGeneration = 0
        private var graphLoadAttempt = -1
        private var cancelledGraphLoadAttempt: Int?
        private var lastCancellationRequestID: Int?
        private var failedGraphLoadGeneration: Int?
        private var schemeTasks: [ObjectIdentifier: SchemeTaskState] = [:]
        private var graphDataHandle: GraphDataHandle?
        private var prepareTask: Task<Void, Never>?
        private let graphDataStore: GraphDataStore
        var agentActivitySnapshot: AgentActivitySnapshot = .empty
        var workflowSelectionID: String?
        var onDiagnostic: @MainActor (String) -> Void
        var onLoadEvent: @MainActor (GraphRendererLoadEvent, Int) -> Void
        var onOpenNode: @MainActor (GraphNodeOpenRequest) -> Void
        var onSessionState: @MainActor (GraphSessionState) -> Void

        init(
            graphDataStore: GraphDataStore = GraphDataStore(),
            onDiagnostic: @escaping @MainActor (String) -> Void,
            onLoadEvent: @escaping @MainActor (GraphRendererLoadEvent, Int) -> Void = { _, _ in },
            onOpenNode: @escaping @MainActor (GraphNodeOpenRequest) -> Void,
            onSessionState: @escaping @MainActor (GraphSessionState) -> Void = { _ in }
        ) {
            self.graphDataStore = graphDataStore
            self.onDiagnostic = onDiagnostic
            self.onLoadEvent = onLoadEvent
            self.onOpenNode = onOpenNode
            self.onSessionState = onSessionState
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            guard let navigation, navigation === activeNavigation else {
                return
            }
            loadGraph(sourceLens, generation: graphLoadGeneration, in: webView)
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
            guard !isGraphLoadCancelled(attempt: graphLoadAttempt) else {
                return
            }
            Task { @MainActor [onDiagnostic] in
                onDiagnostic("3D graph renderer process terminated.")
            }
            reportLoadFailure(.rendererFailed)
        }

        func prepareGraph(
            url: URL,
            policy: GraphDataPreparePolicy,
            attempt: Int,
            in webView: WKWebView
        ) {
            let generation = beginGraphLoad(attempt: attempt)
            invalidateRendererWork(in: webView)
            prepareTask?.cancel()
            let graphDataStore = graphDataStore
            prepareTask = Task { @MainActor [weak self] in
                let result = await graphDataStore.prepare(url: url, policy: policy)
                guard let self, !Task.isCancelled,
                      self.graphLoadAttempt == attempt,
                      self.graphLoadGeneration == generation
                else {
                    return
                }
                self.prepareTask = nil
                switch result {
                case .ready(let handle):
                    self.graphDataHandle = handle
                    self.navigateToIndex(handle: handle, in: webView)
                case .failed(let code):
                    self.reportLoadFailure(.validation(code))
                case .superseded:
                    break
                }
            }
        }

        private func navigateToIndex(handle: GraphDataHandle, in webView: WKWebView) {
            var components = URLComponents()
            components.scheme = "brainbar3d"
            components.host = "resources"
            components.path = "/index.html"
            components.queryItems = [
                URLQueryItem(name: "lens", value: sourceLens.rawValue),
                URLQueryItem(name: "digest", value: handle.digest)
            ]
            guard let indexURL = components.url else {
                reportLoadFailure(.navigationFailed)
                return
            }
            self.indexURL = indexURL
            self.activeNavigation = webView.load(URLRequest(url: indexURL))
        }

        private func invalidateRendererWork(in webView: WKWebView) {
            activeNavigation = nil
            webView.stopLoading()
            let identifiers = schemeTasks.compactMap { identifier, state in
                isGraphDataSchemeRequest(state.requestURL) ? identifier : nil
            }
            for identifier in identifiers {
                guard let state = schemeTasks.removeValue(forKey: identifier) else {
                    continue
                }
                state.stopped = true
                state.deliveryTask?.cancel()
            }
            webView.evaluateJavaScript("window.brainBarAbortGraphLoad?.();") { _, _ in }
        }

        private func isGraphDataSchemeRequest(_ url: URL) -> Bool {
            url.path == "/graph.json" || url.path == "/graph-metadata.json"
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
            graphLoadGeneration += 1
            prepareTask?.cancel()
            prepareTask = nil
            invalidateRendererWork(in: webView)
            return true
        }

        func isGraphLoadCancelled(attempt: Int) -> Bool {
            cancelledGraphLoadAttempt == attempt
        }

        func loadGraph(_ lens: GraphSourceLens, generation: Int, in webView: WKWebView) {
            guard let graphDataHandle else {
                reportLoadFailure(.rendererFailed)
                return
            }
            let script = """
            window.__brainBarPendingGraphLens = "\(lens.rawValue)";
            window.__brainBarPendingGraphRequest = {
              graphURL: "brainbar3d://resources/graph.json?digest=\(graphDataHandle.digest)",
              metadataURL: "brainbar3d://resources/graph-metadata.json?digest=\(graphDataHandle.digest)",
              lens: "\(lens.rawValue)",
              generation: \(generation)
            };
            if (window.brainBarLoadGraphFromURL) {
              const request = window.__brainBarPendingGraphRequest;
              window.__brainBarPendingGraphRequest = null;
              void window.brainBarLoadGraphFromURL(request.graphURL, request.metadataURL, request.lens, request.generation);
            }
            """
            evaluate(script, in: webView, generation: generation)
        }

        func beginGraphLoad(attempt: Int? = nil) -> Int {
            graphLoadGeneration += 1
            graphReady = false
            cancelledGraphLoadAttempt = nil
            failedGraphLoadGeneration = nil
            if let attempt {
                graphLoadAttempt = attempt
            }
            emitLoadEvent(.loading)
            return graphLoadGeneration
        }

        func acceptsGraphReady(generation: Int, lens: GraphSourceLens) -> Bool {
            guard generation == graphLoadGeneration, lens == sourceLens else {
                return false
            }
            graphReady = true
            return true
        }

        func acceptsGraphReady(generation: Int) -> Bool {
            acceptsGraphReady(generation: generation, lens: sourceLens)
        }

        func acceptsRendererDiagnostic(generation: Int) -> Bool {
            generation == graphLoadGeneration
        }

        func applyAgentActivity(_ snapshot: AgentActivitySnapshot, in webView: WKWebView) {
            let script = """
            if (window.brainBarApplyAgentActivity) {
              window.brainBarApplyAgentActivity(\(Graph3DWebView.agentActivityJSON(snapshot)));
            }
            """
            evaluate(script, in: webView)
        }

        func applyWorkflowSelection(in webView: WKWebView) {
            let workflowID = Graph3DWebView.jsStringLiteral(workflowSelectionID ?? "")
            evaluate(
                "if (window.brainBarApplyWorkflowHighlight) { window.brainBarApplyWorkflowHighlight(\(workflowID)); }",
                in: webView
            )
        }

        func applyLens(_ lens: GraphSourceLens, in webView: WKWebView) {
            let generation = beginGraphLoad()
            let script = """
            window.__brainBarPendingGraphLens = "\(lens.rawValue)";
            if (window.brainBarApplyGraphLens) {
              void window.brainBarApplyGraphLens("\(lens.rawValue)", \(generation));
            }
            """
            evaluate(script, in: webView, generation: generation)
        }

        func resetCamera(in webView: WKWebView) {
            evaluate("if (window.brainBarResetCamera) { window.brainBarResetCamera(); }", in: webView)
        }

        func applyViewportCommandIfNeeded(_ command: GraphViewportCommand?, in webView: WKWebView) {
            guard graphReady, let command, lastViewportCommandID != command.id else {
                return
            }
            lastViewportCommandID = command.id
            let script: String
            switch command.kind {
            case .fit:
                script = "if (window.brainBarResetCamera) { window.brainBarResetCamera(); }"
            case .zoomIn:
                script = "if (window.brainBarZoom) { window.brainBarZoom(1.18); }"
            case .zoomOut:
                script = "if (window.brainBarZoom) { window.brainBarZoom(0.8474576271); }"
            case .topView:
                script = "if (window.brainBarTopView) { window.brainBarTopView(); }"
            case .resetTilt:
                script = "if (window.brainBarResetTilt) { window.brainBarResetTilt(); }"
            case .graphHealth:
                script = "if (window.brainBarShowGraphHealth) { window.brainBarShowGraphHealth(); }"
            case .revealNode3D:
                script = "if (window.brainBarRevealNode3D) { window.brainBarRevealNode3D(\(Graph3DWebView.jsStringLiteral(command.payload ?? ""))); }"
            case .pathFromNode3D:
                script = "if (window.brainBarStartPathFromNode3D) { window.brainBarStartPathFromNode3D(\(Graph3DWebView.jsStringLiteral(command.payload ?? ""))); }"
            case .showCommunity3D:
                script = "if (window.brainBarShowCommunity3D) { window.brainBarShowCommunity3D(\(Graph3DWebView.jsStringLiteral(command.payload ?? ""))); }"
            }
            evaluate(script, in: webView)
        }

        func evaluate(_ script: String, in webView: WKWebView, generation: Int? = nil) {
            let diagnosticGeneration = generation ?? graphLoadGeneration
            webView.evaluateJavaScript(script) { [weak self] _, error in
                guard let self, let error else {
                    return
                }
                guard diagnosticGeneration == self.graphLoadGeneration else {
                    return
                }
                self.reportDiagnostic(error.localizedDescription, generation: diagnosticGeneration)
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any] else {
                return
            }

            if message.name == "brainBarGraphDiagnostic" {
                if
                    String(describing: body["event"] ?? "") == "graphReady",
                    let generation = (body["generation"] as? NSNumber)?.intValue,
                    let rawLens = body["lens"] as? String,
                    let readyLens = GraphSourceLens(rawValue: rawLens),
                    let webView = message.webView
                {
                    if acceptsGraphReady(generation: generation, lens: readyLens) {
                        applyAgentActivity(agentActivitySnapshot, in: webView)
                        applyWorkflowSelection(in: webView)
                        applyViewportCommandIfNeeded(pendingViewportCommand, in: webView)
                        applySessionStateIfNeeded(sessionState, in: webView)
                        emitLoadEvent(.ready)
                    } else if generation == graphLoadGeneration {
                        applyLens(sourceLens, in: webView)
                    }
                    return
                }
                guard
                    let generation = (body["generation"] as? NSNumber)?.intValue,
                    acceptsRendererDiagnostic(generation: generation)
                else {
                    return
                }
                let diagnostic = String(describing: body["message"] ?? body["error"] ?? "")
                receiveRendererDiagnostic(message: diagnostic, generation: generation)
                return
            }

            if message.name == "brainBarGraphSession" {
                guard let state = Graph3DWebView.decodeGraphSessionState(body) else {
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
            evaluate(
                "if (window.brainBarApplyGraphSessionState) { window.brainBarApplyGraphSessionState(\(Graph3DWebView.graphSessionJSON(state))); }",
                in: webView
            )
        }

        private func reportNavigationFailure(_ error: Error, navigation: WKNavigation?) {
            guard let navigation, navigation === activeNavigation else {
                return
            }
            let nsError = error as NSError
            guard nsError.code != NSURLErrorCancelled else {
                return
            }
            Task { @MainActor [onDiagnostic] in
                onDiagnostic(error.localizedDescription)
            }
            reportLoadFailure(.navigationFailed)
        }

        func receiveRendererDiagnostic(message: String, generation: Int) {
            reportDiagnostic(message, generation: generation)
        }

        private func reportDiagnostic(_ message: String, generation: Int) {
            guard acceptsRendererDiagnostic(generation: generation) else {
                return
            }
            Task { @MainActor [onDiagnostic] in
                onDiagnostic(message)
            }
            if !graphReady {
                reportLoadFailure(.rendererFailed)
            }
        }

        func reportLoadFailure(_ failure: GraphLoadFailure) {
            graphReady = false
            guard graphLoadAttempt >= 0 else {
                return
            }
            guard !isGraphLoadCancelled(attempt: graphLoadAttempt) else {
                return
            }
            guard failedGraphLoadGeneration != graphLoadGeneration else {
                return
            }
            failedGraphLoadGeneration = graphLoadGeneration
            emitLoadEvent(.failed(failure))
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

        func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
            guard let requestURL = urlSchemeTask.request.url else {
                urlSchemeTask.didFailWithError(BrainBarError.fileMissing("3D graph resource"))
                return
            }
            let isMetadataRequest = requestURL.path == "/graph-metadata.json"
            let isGraphRequest = requestURL.path == "/graph.json"
            let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
            let state = SchemeTaskState(task: urlSchemeTask, requestURL: requestURL)
            schemeTasks[identifier] = state
            let bundledResourceURL = isMetadataRequest || isGraphRequest ? nil : bundleURL(for: requestURL)

            if isMetadataRequest || isGraphRequest {
                guard
                    let graphDataHandle,
                    URLComponents(url: requestURL, resolvingAgainstBaseURL: false)?
                        .queryItems?
                        .first(where: { $0.name == "digest" })?
                        .value == graphDataHandle.digest
                else {
                    finishSchemeTask(identifier, resource: nil)
                    return
                }
                let kind: GraphDataResourceKind = isMetadataRequest ? .metadata : .graph
                let graphDataStore = graphDataStore
                state.deliveryTask = Task { @MainActor [weak self] in
                    let data = await graphDataStore.resource(for: graphDataHandle, kind: kind)
                    guard !Task.isCancelled else {
                        return
                    }
                    let resource = data.map {
                        SchemeResource(
                            data: $0,
                            mimeType: "application/json",
                            textEncodingName: "utf-8"
                        )
                    }
                    self?.finishSchemeTask(identifier, resource: resource)
                }
                return
            }

            DispatchQueue.global(qos: .userInitiated).async {
                let resource: SchemeResource?
                if let bundledResourceURL {
                    resource = try? Self.fileResource(fileURL: bundledResourceURL)
                } else {
                    resource = nil
                }
                DispatchQueue.main.async { [weak self] in
                    self?.finishSchemeTask(identifier, resource: resource)
                }
            }
        }

        func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
            let identifier = ObjectIdentifier(urlSchemeTask as AnyObject)
            guard let state = schemeTasks.removeValue(forKey: identifier) else {
                return
            }
            state.stopped = true
            state.deliveryTask?.cancel()
        }

        private func finishSchemeTask(_ identifier: ObjectIdentifier, resource: SchemeResource?) {
            guard let state = schemeTasks[identifier], !state.stopped, !state.finished else {
                return
            }
            guard let resource else {
                schemeTasks.removeValue(forKey: identifier)
                state.finished = true
                state.deliveryTask = nil
                state.task.didFailWithError(BrainBarError.fileMissing("3D graph resource"))
                return
            }
            let response = URLResponse(
                url: state.requestURL,
                mimeType: resource.mimeType,
                expectedContentLength: resource.data.count,
                textEncodingName: resource.textEncodingName
            )
            state.task.didReceive(response)
            guard schemeTasks[identifier] === state, !state.stopped else {
                return
            }
            state.task.didReceive(resource.data)
            guard schemeTasks[identifier] === state, !state.stopped else {
                return
            }
            schemeTasks.removeValue(forKey: identifier)
            state.finished = true
            state.deliveryTask = nil
            state.task.didFinish()
        }

        private nonisolated static func fileResource(fileURL: URL) throws -> SchemeResource {
            let data = try Data(contentsOf: fileURL)
            return SchemeResource(
                data: data,
                mimeType: mimeType(for: fileURL.pathExtension),
                textEncodingName: fileURL.pathExtension == "html" ? "utf-8" : nil
            )
        }

        private func bundleURL(for url: URL?) -> URL? {
            guard let url else {
                return nil
            }
            let rawPath = url.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if rawPath == "GraphEvidence/brainbar-graph-evidence.js" {
                return Bundle.main.resourceURL?
                    .appendingPathComponent("GraphEvidence", isDirectory: true)
                    .appendingPathComponent("brainbar-graph-evidence.js")
            }
            let relativePath = rawPath.isEmpty ? "index.html" : rawPath
            return Bundle.main.resourceURL?
                .appendingPathComponent("Graph3D", isDirectory: true)
                .appendingPathComponent(relativePath)
        }

        private nonisolated static func mimeType(for pathExtension: String) -> String {
            switch pathExtension.lowercased() {
            case "html":
                return "text/html"
            case "css":
                return "text/css"
            case "js", "mjs":
                return "text/javascript"
            case "json":
                return "application/json"
            case "txt":
                return "text/plain"
            default:
                return "application/octet-stream"
            }
        }
    }
}

extension Graph3DWebView {
    @MainActor
    static func graphResourceVersion(readAccessURL: URL) -> String {
        let graphJSONURL = readAccessURL.appendingPathComponent("graph.json").standardizedFileURL
        let values = try? graphJSONURL.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        guard let modifiedAt = values?.contentModificationDate?.timeIntervalSince1970,
              let fileSize = values?.fileSize else {
            return "missing"
        }
        return "\(modifiedAt):\(fileSize)"
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
