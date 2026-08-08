import AppKit
import CryptoKit
import Foundation
import Testing
import WebKit
@testable import BrainBar

struct Graph2DOfflineRuntimeTests {
    @Test("Graphify 2D loads the pinned Vis runtime without network", .timeLimit(.minutes(1)))
    @MainActor
    func loadsPinnedVisRuntimeOffline() async throws {
        let vendorURL = try #require(
            Bundle.main.url(
                forResource: "vis-network.min",
                withExtension: "js",
                subdirectory: "Graph2D/Vendor/vis-network-9.1.6"
            )
        )
        let vendorData = try Data(contentsOf: vendorURL)
        let checksum = SHA256.hash(data: vendorData).map { String(format: "%02x", $0) }.joined()
        #expect(checksum == "576bb887733eb01bb52ee75b90ef46d818454de5fddb5b616fb8a298d307ca12")

        let vendorScript = try #require(GraphWebView.userScripts().first)
        #expect(vendorScript.injectionTime == .atDocumentStart)
        #expect(vendorScript.source.contains("Object.defineProperty(window, \"vis\""))

        let controller = WKUserContentController()
        controller.addUserScript(vendorScript)
        let contentRuleInstalled = await withCheckedContinuation { continuation in
            Graph2DOfflineRuntime.installContentRule(in: controller) { installed in
                continuation.resume(returning: installed)
            }
        }
        #expect(contentRuleInstalled)

        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("brainbar-2d-offline-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let htmlURL = directory.appendingPathComponent("graph.html")
        try Self.graphifyShapedHTML.write(to: htmlURL, atomically: true, encoding: .utf8)

        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        let webView = WKWebView(
            frame: NSRect(x: 0, y: 0, width: 800, height: 600),
            configuration: configuration
        )
        let host = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 800, height: 600),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        host.contentView = webView
        host.orderFrontRegardless()
        defer {
            webView.stopLoading()
            host.close()
        }

        webView.loadFileURL(htmlURL, allowingReadAccessTo: directory)
        let clock = ContinuousClock()
        let deadline = clock.now.advanced(by: .seconds(15))
        var probe: [String: Any]?
        while clock.now < deadline {
            if let value = try? await webView.evaluateJavaScript("JSON.stringify(window.__brainBarOfflineProbe || null)"),
               let json = value as? String,
               json != "null",
               let data = json.data(using: .utf8) {
                let candidate = try JSONSerialization.jsonObject(with: data) as? [String: Any]
                probe = candidate
                if let stage = candidate?["stage"] as? String, stage == "ready" || stage == "error" {
                    break
                }
            }
            try await Task.sleep(for: .milliseconds(50))
        }

        let result = try #require(probe)
        #expect(result["stage"] as? String == "ready")
        #expect(result["visAvailable"] as? Bool == true)
        #expect(result["nodeCount"] as? Int == 2)
        #expect(result["edgeCount"] as? Int == 1)
        #expect(result["networkAvailable"] as? Bool == true)
        #expect(result["error"] == nil)

        webView.loadHTMLString("<html></html>", baseURL: nil)
        try await Task.sleep(for: .milliseconds(100))
        webView.stopLoading()
        host.close()
    }

    private static let graphifyShapedHTML = #"""
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <script>
          window.__brainBarOfflineProbe = {
            stage: "head"
          };
          window.addEventListener("error", event => {
            window.__brainBarOfflineProbe = {
              stage: "error",
              error: String(event.error?.message || event.message || "unknown")
            };
          });
        </script>
        <script src="https://unpkg.com/vis-network@9.1.6/standalone/umd/vis-network.min.js"></script>
        <style>html, body, #graph { width: 100%; height: 100%; margin: 0; }</style>
      </head>
      <body>
        <div id="graph"></div>
        <script>
          try {
            const nodes = new vis.DataSet([
              { id: "one", label: "One" },
              { id: "two", label: "Two" }
            ]);
            const edges = new vis.DataSet([
              { id: "one-two", from: "one", to: "two" }
            ]);
            window.network = new vis.Network(
              document.getElementById("graph"),
              { nodes, edges },
              { physics: false }
            );
            window.__brainBarOfflineProbe = {
              stage: "ready",
              visAvailable: typeof vis.Network === "function",
              nodeCount: nodes.length,
              edgeCount: edges.length,
              networkAvailable: typeof window.network.getConnectedNodes === "function"
            };
          } catch (error) {
            window.__brainBarOfflineProbe = {
              stage: "error",
              error: String(error?.message || error),
              visType: typeof window.vis,
              dataSetType: typeof window.vis?.DataSet,
              networkType: typeof window.vis?.Network,
              bootstrapError: window.__brainBarOfflineVisRuntimeError || null,
              visKeys: Object.keys(window.vis || {}).sort().join(",")
            };
          }
        </script>
      </body>
    </html>
    """#
}
