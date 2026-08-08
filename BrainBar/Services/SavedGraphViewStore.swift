import Foundation

struct SavedGraphView: Codable, Equatable, Identifiable, Sendable {
    static let currentSchemaVersion = 1

    var schemaVersion = currentSchemaVersion
    var id: UUID
    var name: String
    var createdAt: Date
    var mode: GraphViewMode
    var session: GraphSessionState

    var normalized: SavedGraphView? {
        guard schemaVersion == Self.currentSchemaVersion else {
            return nil
        }
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty else {
            return nil
        }
        var view = self
        view.name = String(trimmedName.prefix(80))
        view.session = session.normalized
        return view
    }
}

private struct SavedGraphViewDocument: Codable {
    static let currentSchemaVersion = 1

    var schemaVersion = currentSchemaVersion
    var views: [SavedGraphView]
}

actor SavedGraphViewStore {
    private let fileManager: FileManager
    private let fileURL: URL

    init(fileManager: FileManager = .default, fileURL: URL? = nil) {
        self.fileManager = fileManager
        if let fileURL {
            self.fileURL = fileURL.standardizedFileURL
        } else {
            let appSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            self.fileURL = appSupport.appendingPathComponent("BrainBar/saved-graph-views.json")
        }
    }

    func load() throws -> [SavedGraphView] {
        guard fileManager.fileExists(atPath: fileURL.path) else {
            return []
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let document = try decoder.decode(SavedGraphViewDocument.self, from: Data(contentsOf: fileURL))
        guard document.schemaVersion == SavedGraphViewDocument.currentSchemaVersion else {
            return []
        }
        return document.views.compactMap(\.normalized)
            .sorted { $0.createdAt > $1.createdAt }
    }

    func save(_ view: SavedGraphView) throws -> [SavedGraphView] {
        guard let normalized = view.normalized else {
            return try load()
        }
        var views = try load().filter { $0.id != normalized.id }
        views.insert(normalized, at: 0)
        try write(views)
        return views
    }

    func delete(id: UUID) throws -> [SavedGraphView] {
        let views = try load().filter { $0.id != id }
        try write(views)
        return views
    }

    private func write(_ views: [SavedGraphView]) throws {
        try fileManager.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try encoder.encode(SavedGraphViewDocument(views: views)).write(to: fileURL, options: .atomic)
    }
}
