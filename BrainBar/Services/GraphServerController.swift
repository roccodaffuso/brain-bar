import Foundation

@MainActor
final class GraphServerController {
    private var process: Process?

    var isRunning: Bool {
        process?.isRunning == true
    }

    func graphURL(for config: BrainBarConfig) -> URL? {
        guard config.serverPort > 0, config.serverPort < 65_536 else {
            return nil
        }
        return URL(string: "http://127.0.0.1:\(config.serverPort)/\(config.graphHtmlRelativePath)")
    }

    func start(vaultURL: URL, port: Int) async throws {
        guard port > 0, port < 65_536 else {
            throw BrainBarError.invalidPort(port)
        }
        if isRunning {
            return
        }
        if await isPortResponding(port) {
            throw BrainBarError.portBusy(port)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [
            "-m", "http.server", "\(port)",
            "--bind", "127.0.0.1",
            "--directory", vaultURL.path
        ]
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
        self.process = process
    }

    func stop() {
        guard let process else {
            return
        }
        if process.isRunning {
            process.terminate()
        }
        self.process = nil
    }

    private func isPortResponding(_ port: Int) async -> Bool {
        guard let url = URL(string: "http://127.0.0.1:\(port)/") else {
            return false
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 1
        do {
            _ = try await URLSession.shared.data(for: request)
            return true
        } catch {
            return false
        }
    }
}
