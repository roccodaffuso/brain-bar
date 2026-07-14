import AppKit
import Foundation

struct VaultStatusService: Sendable {
    func status(for config: BrainBarConfig) async -> VaultStatus {
        guard let vaultURL = vaultURL(for: config) else {
            return .empty
        }

        let vaultExists = directoryExists(vaultURL)
        async let branchTask = vaultExists ? runGit(["branch", "--show-current"], in: vaultURL) : nil
        async let dirtyOutputTask = vaultExists ? runGit(["status", "--porcelain"], in: vaultURL) : nil
        let (branch, dirtyOutput) = await (branchTask, dirtyOutputTask)
        let isGitRepo = branch != nil || dirtyOutput != nil
        let graphURL = resolvedURL(config.graphHtmlRelativePath, in: vaultURL)
        let graphExists = FileManager.default.fileExists(atPath: graphURL.path)
        let graphJSONURL = graphURL.deletingLastPathComponent().appendingPathComponent("graph.json")
        let graphJSONExists = FileManager.default.fileExists(atPath: graphJSONURL.path)

        return VaultStatus(
            vaultPath: vaultURL.path,
            vaultExists: vaultExists,
            dashboardExists: FileManager.default.fileExists(atPath: resolvedURL(config.projectDashboardRelativePath, in: vaultURL).path),
            graphHtmlExists: graphExists,
            graphHtmlModifiedAt: graphExists ? modificationDate(for: graphURL) : nil,
            graphJSONExists: graphJSONExists,
            graphJSONModifiedAt: graphJSONExists ? modificationDate(for: graphJSONURL) : nil,
            graphReportExists: FileManager.default.fileExists(atPath: resolvedURL(config.graphReportRelativePath, in: vaultURL).path),
            gitBranch: branch?.trimmingCharacters(in: .whitespacesAndNewlines),
            gitDirty: isGitRepo ? !(dirtyOutput?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true) : nil
        )
    }

    func vaultURL(for config: BrainBarConfig) -> URL? {
        let path = config.vaultPath.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !path.isEmpty else {
            return nil
        }
        return URL(fileURLWithPath: path).standardizedFileURL
    }

    func resolvedURL(_ relativePath: String, in vaultURL: URL) -> URL {
        if relativePath.hasPrefix("/") {
            return URL(fileURLWithPath: relativePath).standardizedFileURL
        }
        return vaultURL.appendingPathComponent(relativePath).standardizedFileURL
    }

    func openVault(_ config: BrainBarConfig) throws {
        let vaultURL = try requireVaultURL(config)
        NSWorkspace.shared.activateFileViewerSelecting([vaultURL])
    }

    func openRelativeFile(_ relativePath: String, config: BrainBarConfig) throws {
        let vaultURL = try requireVaultURL(config)
        let fileURL = resolvedURL(relativePath, in: vaultURL)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw BrainBarError.fileMissing(fileURL.path)
        }

        if config.useObsidianURLScheme, let obsidianURL = obsidianURL(for: fileURL) {
            NSWorkspace.shared.open(obsidianURL)
        } else {
            NSWorkspace.shared.open(fileURL)
        }
    }

    func graphNodeOpenURL(for sourceFile: String?, config: BrainBarConfig) throws -> URL {
        let fileURL = try resolvedGraphNodeSourceURL(sourceFile, config: config)
        if config.useObsidianURLScheme,
           fileURL.isMarkdownFile,
           let obsidianURL = obsidianURL(for: fileURL) {
            return obsidianURL
        }
        return fileURL
    }

    func openGraphNodeSource(_ sourceFile: String?, config: BrainBarConfig) throws {
        NSWorkspace.shared.open(try graphNodeOpenURL(for: sourceFile, config: config))
    }

    func resolvedGraphNodeSourceURL(_ sourceFile: String?, config: BrainBarConfig) throws -> URL {
        let source = sourceFile?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !source.isEmpty else {
            throw BrainBarError.graphNodeSourceMissing
        }

        let vaultURL = try requireVaultURL(config)
        let fileURL = resolvedURL(source, in: vaultURL).standardizedFileURL
        guard fileURL.isContained(in: vaultURL) else {
            throw BrainBarError.graphNodeSourceOutsideVault(source)
        }
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            throw BrainBarError.graphNodeSourceFileMissing(fileURL.relativePath(in: vaultURL) ?? source)
        }
        return fileURL
    }

    private func requireVaultURL(_ config: BrainBarConfig) throws -> URL {
        guard let vaultURL = vaultURL(for: config) else {
            throw BrainBarError.vaultNotConfigured
        }
        guard directoryExists(vaultURL) else {
            throw BrainBarError.vaultMissing(vaultURL.path)
        }
        return vaultURL
    }

    private func directoryExists(_ url: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: url.path, isDirectory: &isDirectory) && isDirectory.boolValue
    }

    private func modificationDate(for url: URL) -> Date? {
        let attributes = try? FileManager.default.attributesOfItem(atPath: url.path)
        return attributes?[.modificationDate] as? Date
    }

    private func obsidianURL(for fileURL: URL) -> URL? {
        var components = URLComponents()
        components.scheme = "obsidian"
        components.host = "open"
        components.queryItems = [URLQueryItem(name: "path", value: fileURL.path)]
        return components.url
    }

    private func runGit(_ arguments: [String], in directory: URL) async -> String? {
        let spec = CommandSpec(executable: "git", arguments: arguments, workingDirectory: directory.path)
        let result = try? await CommandRunner().run(spec, name: "git", vaultURL: nil)
        guard let result, result.exitCode == 0 else {
            return nil
        }
        return result.stdout
    }
}

private extension URL {
    var isMarkdownFile: Bool {
        let fileExtension = pathExtension.lowercased()
        return fileExtension == "md" || fileExtension == "markdown"
    }

    func isContained(in directory: URL) -> Bool {
        let directoryPath = directory.standardizedFileURL.path
        let filePath = standardizedFileURL.path
        return filePath == directoryPath || filePath.hasPrefix(directoryPath + "/")
    }

    func relativePath(in directory: URL) -> String? {
        let directoryPath = directory.standardizedFileURL.path
        let filePath = standardizedFileURL.path
        guard filePath == directoryPath || filePath.hasPrefix(directoryPath + "/") else {
            return nil
        }
        if filePath == directoryPath {
            return URL(fileURLWithPath: filePath).lastPathComponent
        }
        return String(filePath.dropFirst(directoryPath.count + 1))
    }
}
