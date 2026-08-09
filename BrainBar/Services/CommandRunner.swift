import Foundation
import Darwin

struct CommandRunner: Sendable {
    // One MiB retains actionable diagnostics without allowing a single command to grow memory without bound.
    private static let maximumRetainedOutputBytes = 1_048_576
    private static let timeoutGraceSeconds = 1
    private static let postTerminationDrainGraceMilliseconds = 250

    func run(_ spec: CommandSpec, name: String, vaultURL: URL?, timeoutSeconds: Int? = nil) async throws -> CommandResult {
        let startedAt = Date()
        let process = Process()
        let stdout = Pipe()
        let stderr = Pipe()

        if spec.executable.contains("/") {
            process.executableURL = URL(fileURLWithPath: spec.executable)
            process.arguments = spec.arguments
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [spec.executable] + spec.arguments
        }
        process.environment = Self.effectiveEnvironment()

        if let workingDirectory = spec.workingDirectory, !workingDirectory.isEmpty {
            if workingDirectory == "vault" {
                process.currentDirectoryURL = vaultURL
            } else if workingDirectory.hasPrefix("/") {
                process.currentDirectoryURL = URL(fileURLWithPath: workingDirectory)
            }
        }

        process.standardOutput = stdout
        process.standardError = stderr

        return try await withCheckedThrowingContinuation { continuation in
            let completion = CommandRunCompletion(
                commandName: name,
                startedAt: startedAt,
                continuation: continuation,
                maximumRetainedOutputBytes: Self.maximumRetainedOutputBytes
            )
            startDraining(stdout, stream: .stdout, completion: completion)
            startDraining(stderr, stream: .stderr, completion: completion)

            process.terminationHandler = { process in
                guard completion.processDidTerminate(exitCode: process.terminationStatus) else {
                    return
                }
                // Background descendants are not managed; inherited stream descriptors are bounded after direct-process exit.
                Task {
                    try? await Task.sleep(for: .milliseconds(Self.postTerminationDrainGraceMilliseconds))
                    guard completion.beginForcedStreamClosureIfNeeded() else {
                        return
                    }
                    stopDraining(stdout)
                    stopDraining(stderr)
                    completion.finishForcedStreamClosure()
                }
            }

            do {
                try process.run()
                if let timeoutSeconds, timeoutSeconds > 0 {
                    Task {
                        try? await Task.sleep(for: .seconds(timeoutSeconds))
                        guard !Task.isCancelled, process.isRunning, completion.beginTimeout(after: timeoutSeconds) else {
                            return
                        }
                        if process.isRunning {
                            process.terminate()
                        }
                        try? await Task.sleep(for: .seconds(Self.timeoutGraceSeconds))
                        if process.isRunning, process.processIdentifier > 0 {
                            Darwin.kill(process.processIdentifier, SIGKILL)
                        }
                    }
                }
            } catch {
                stopDraining(stdout)
                stopDraining(stderr)
                completion.processDidFailToLaunch(error)
            }
        }
    }

    private func startDraining(_ pipe: Pipe, stream: CommandOutputStream, completion: CommandRunCompletion) {
        pipe.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            if data.isEmpty {
                handle.readabilityHandler = nil
                completion.streamDidReachEOF(stream)
            } else {
                completion.receive(data, from: stream)
            }
        }
    }

    private func stopDraining(_ pipe: Pipe) {
        pipe.fileHandleForReading.readabilityHandler = nil
        try? pipe.fileHandleForReading.close()
    }

    static func effectiveEnvironment(
        base: [String: String] = ProcessInfo.processInfo.environment
    ) -> [String: String] {
        var environment = base
        let localBin = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".local/bin")
            .path
        let fallbackPath = [
            environment["PATH"],
            localBin,
            "/opt/homebrew/bin",
            "/usr/local/bin",
            "/usr/bin",
            "/bin",
            "/usr/sbin",
            "/sbin"
        ]
        .compactMap { $0 }
        .joined(separator: ":")
        environment["PATH"] = fallbackPath
        return environment
    }

    static func resolvedExecutableURL(
        _ executable: String,
        environment: [String: String] = effectiveEnvironment()
    ) -> URL? {
        let executable = executable.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !executable.isEmpty else {
            return nil
        }
        if executable.contains("/") {
            return URL(fileURLWithPath: executable).standardizedFileURL
        }
        let directories = (environment["PATH"] ?? "").split(separator: ":")
        for directory in directories {
            let candidate = URL(fileURLWithPath: String(directory), isDirectory: true)
                .appendingPathComponent(executable)
                .standardizedFileURL
            if FileManager.default.fileExists(atPath: candidate.path) {
                return candidate
            }
        }
        return nil
    }
}

private enum CommandOutputStream {
    case stdout
    case stderr
}

private final class CommandRunCompletion: @unchecked Sendable {
    private let lock = NSLock()
    private let commandName: String
    private let startedAt: Date
    private let continuation: CheckedContinuation<CommandResult, Error>
    private var stdout: BoundedCommandOutput
    private var stderr: BoundedCommandOutput
    private var stdoutReachedEOF = false
    private var stderrReachedEOF = false
    private var exitCode: Int32?
    private var timeoutSeconds: Int?
    private var streamsForceClosed = false
    private var completed = false

    init(
        commandName: String,
        startedAt: Date,
        continuation: CheckedContinuation<CommandResult, Error>,
        maximumRetainedOutputBytes: Int
    ) {
        self.commandName = commandName
        self.startedAt = startedAt
        self.continuation = continuation
        stdout = BoundedCommandOutput(maximumRetainedBytes: maximumRetainedOutputBytes)
        stderr = BoundedCommandOutput(maximumRetainedBytes: maximumRetainedOutputBytes)
    }

    func receive(_ data: Data, from stream: CommandOutputStream) {
        lock.lock()
        guard !completed, !streamsForceClosed else {
            lock.unlock()
            return
        }
        switch stream {
        case .stdout:
            stdout.append(data)
        case .stderr:
            stderr.append(data)
        }
        lock.unlock()
    }

    func streamDidReachEOF(_ stream: CommandOutputStream) {
        lock.lock()
        guard !streamsForceClosed else {
            lock.unlock()
            return
        }
        switch stream {
        case .stdout:
            stdoutReachedEOF = true
        case .stderr:
            stderrReachedEOF = true
        }
        let outcome = completedOutcomeIfReady()
        lock.unlock()
        resume(outcome)
    }

    func processDidTerminate(exitCode: Int32) -> Bool {
        lock.lock()
        self.exitCode = exitCode
        let outcome = completedOutcomeIfReady()
        let needsFinalDrain = outcome == nil && !completed && (!stdoutReachedEOF || !stderrReachedEOF)
        lock.unlock()
        resume(outcome)
        return needsFinalDrain
    }

    func beginTimeout(after timeoutSeconds: Int) -> Bool {
        lock.lock()
        guard !completed, self.timeoutSeconds == nil, exitCode == nil else {
            lock.unlock()
            return false
        }
        self.timeoutSeconds = timeoutSeconds
        lock.unlock()
        return true
    }

    func processDidFailToLaunch(_ error: Error) {
        lock.lock()
        guard !completed else {
            lock.unlock()
            return
        }
        completed = true
        lock.unlock()
        continuation.resume(throwing: BrainBarError.processFailed(error.localizedDescription))
    }

    func beginForcedStreamClosureIfNeeded() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        guard !completed, !streamsForceClosed, exitCode != nil, (!stdoutReachedEOF || !stderrReachedEOF) else {
            return false
        }
        streamsForceClosed = true
        return true
    }

    func finishForcedStreamClosure() {
        lock.lock()
        stdoutReachedEOF = true
        stderrReachedEOF = true
        let outcome = completedOutcomeIfReady()
        lock.unlock()
        resume(outcome)
    }

    private func completedOutcomeIfReady() -> CommandRunOutcome? {
        guard !completed, let exitCode, stdoutReachedEOF, stderrReachedEOF else {
            return nil
        }
        completed = true
        if let timeoutSeconds {
            return .timeout(BrainBarError.commandTimedOut(commandName, timeoutSeconds))
        }
        return .result(CommandResult(
            commandName: commandName,
            exitCode: exitCode,
            stdout: stdout.string,
            stderr: stderr.string,
            startedAt: startedAt,
            finishedAt: Date()
        ))
    }

    private func resume(_ outcome: CommandRunOutcome?) {
        guard let outcome else {
            return
        }
        switch outcome {
        case .result(let result):
            continuation.resume(returning: result)
        case .timeout(let error):
            continuation.resume(throwing: error)
        }
    }
}

private enum CommandRunOutcome {
    case result(CommandResult)
    case timeout(BrainBarError)
}

private struct BoundedCommandOutput {
    private static let truncationNotice = "\n[BrainBar: output truncated after 1048576 bytes]\n"

    private let maximumRetainedBytes: Int
    private var data = Data()
    private var isTruncated = false

    init(maximumRetainedBytes: Int) {
        self.maximumRetainedBytes = maximumRetainedBytes
    }

    mutating func append(_ chunk: Data) {
        let remaining = maximumRetainedBytes - data.count
        if remaining > 0 {
            data.append(chunk.prefix(remaining))
        }
        if chunk.count > remaining {
            isTruncated = true
        }
    }

    var string: String {
        guard isTruncated else {
            return String(data: data, encoding: .utf8) ?? ""
        }
        let notice = Data(Self.truncationNotice.utf8)
        let prefixLimit = max(0, maximumRetainedBytes - notice.count)
        let prefix = Data(data.prefix(prefixLimit))
        for trailingBytes in 0...min(3, prefix.count) {
            let candidate = Data(prefix.dropLast(trailingBytes))
            if let text = String(data: candidate, encoding: .utf8) {
                return text + Self.truncationNotice
            }
        }
        return Self.truncationNotice
    }
}
