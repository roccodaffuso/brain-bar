import CryptoKit
import Foundation

enum GraphDataPreparePolicy: Equatable, Sendable {
    case normal
    case retry
}

enum GraphDataValidationCode: String, Error, Equatable, Sendable {
    case invalidJSON
    case invalidShape
    case missingNodeID
    case duplicateNodeID
    case missingEdgeID
    case duplicateEdgeID
    case missingEndpoint
}

struct GraphDataCounts: Equatable, Hashable, Sendable {
    let nodes: Int
    let edges: Int
}

struct GraphDataHandle: Equatable, Hashable, Sendable {
    let digest: String
    let semanticFingerprint: String
    let counts: GraphDataCounts
    let sourceSignature: String
}

enum GraphDataLoadResult: Equatable, Sendable {
    case ready(GraphDataHandle)
    case failed(GraphDataValidationCode)
    case superseded
}

enum GraphDataResourceKind: Sendable {
    case graph
    case metadata
}

actor GraphDataStore {
    typealias DataLoader = @Sendable (URL) async -> Data?

    private static let lowercaseHexDigits = Array("0123456789abcdef".utf8)

    private struct NodeMetadataSeed: Sendable {
        let id: String
        let sourceFile: String?
    }

    private struct PreparedGraph: Sendable {
        let handle: GraphDataHandle
        let rawData: Data
        let metadataSeeds: [NodeMetadataSeed]
        let radarSeed: GraphChangeRadarSeed
    }

    private struct CachedGraph {
        let prepared: PreparedGraph
        let metadataTask: Task<Data, Never>
    }

    private var requestToken = 0
    private var activeTask: Task<Result<PreparedGraph, GraphDataValidationCode>, Never>?
    private var cachedGraph: CachedGraph?
    private let dataLoader: DataLoader

    init(dataLoader: @escaping DataLoader = { url in
        await Task.detached(priority: .userInitiated) {
            try? Data(contentsOf: url)
        }.value
    }) {
        self.dataLoader = dataLoader
    }

    func prepare(url: URL, policy: GraphDataPreparePolicy) async -> GraphDataLoadResult {
        requestToken += 1
        let token = requestToken
        activeTask?.cancel()

        if policy == .normal,
           let cachedGraph,
           let sourceSignature = Self.sourceSignatureSync(for: url),
           sourceSignature == cachedGraph.prepared.handle.sourceSignature {
            activeTask = nil
            return .ready(cachedGraph.prepared.handle)
        }

        let dataLoader = self.dataLoader
        let task = Task.detached(priority: .userInitiated) {
            await Self.build(url: url, dataLoader: dataLoader)
        }
        activeTask = task
        let result = await task.value

        guard token == requestToken, !Task.isCancelled else {
            return .superseded
        }
        activeTask = nil

        switch result {
        case .success(let prepared):
            let metadataRootURL = url.deletingLastPathComponent().deletingLastPathComponent()
            let metadataTask = Task.detached(priority: .utility) {
                Self.metadataData(seeds: prepared.metadataSeeds, vaultURL: metadataRootURL)
            }
            cachedGraph?.metadataTask.cancel()
            cachedGraph = CachedGraph(prepared: prepared, metadataTask: metadataTask)
            return .ready(prepared.handle)
        case .failure(let code):
            return .failed(code)
        }
    }

    func resource(for handle: GraphDataHandle, kind: GraphDataResourceKind) async -> Data? {
        guard let cachedGraph, cachedGraph.prepared.handle == handle else {
            return nil
        }
        switch kind {
        case .graph:
            return cachedGraph.prepared.rawData
        case .metadata:
            let metadata = await cachedGraph.metadataTask.value
            guard let currentGraph = self.cachedGraph, currentGraph.prepared.handle == handle else {
                return nil
            }
            return metadata
        }
    }

    func radarSeed(for handle: GraphDataHandle) -> GraphChangeRadarSeed? {
        guard let cachedGraph, cachedGraph.prepared.handle == handle else {
            return nil
        }
        return cachedGraph.prepared.radarSeed
    }

    func invalidate() {
        requestToken += 1
        activeTask?.cancel()
        activeTask = nil
        cachedGraph?.metadataTask.cancel()
        cachedGraph = nil
    }

    private static func build(
        url: URL,
        dataLoader: @escaping DataLoader
    ) async -> Result<PreparedGraph, GraphDataValidationCode> {
        for _ in 0..<2 {
            guard !Task.isCancelled, let before = sourceSignatureSync(for: url) else {
                return .failure(.invalidJSON)
            }
            guard let data = await dataLoader(url), !Task.isCancelled else {
                return .failure(.invalidJSON)
            }
            guard let after = sourceSignatureSync(for: url), !Task.isCancelled else {
                return .failure(.invalidJSON)
            }
            guard before == after else {
                continue
            }

            guard let object = try? JSONSerialization.jsonObject(with: data) else {
                return .failure(.invalidJSON)
            }
            guard !Task.isCancelled else {
                return .failure(.invalidJSON)
            }
            let vaultURL = url.deletingLastPathComponent().deletingLastPathComponent()
            return validate(
                object: object,
                rawData: data,
                sourceSignature: after,
                vaultURL: vaultURL
            )
        }
        return .failure(.invalidJSON)
    }

    private static func validate(
        object: Any,
        rawData: Data,
        sourceSignature: String,
        vaultURL: URL
    ) -> Result<PreparedGraph, GraphDataValidationCode> {
        guard let root = object as? [String: Any] else {
            return .failure(.invalidShape)
        }
        guard let rawNodes = root["nodes"] as? [Any] else {
            return .failure(.invalidShape)
        }

        let hasEdges = root["edges"] != nil
        let hasLinks = root["links"] != nil
        guard hasEdges != hasLinks,
              let rawEdges = (hasEdges ? root["edges"] : root["links"]) as? [Any]
        else {
            return .failure(.invalidShape)
        }

        var nodeIDs = Set<String>()
        var metadataSeeds: [NodeMetadataSeed] = []
        var nodeFingerprints: [String] = []
        var radarNodes: [GraphChangeRadarSeed.Node] = []
        for (index, rawNode) in rawNodes.enumerated() {
            guard index % 256 != 0 || !Task.isCancelled else {
                return .failure(.invalidJSON)
            }
            guard let node = rawNode as? [String: Any] else {
                return .failure(.invalidShape)
            }
            guard let id = scalarID(node["id"]) else {
                return .failure(.missingNodeID)
            }
            guard nodeIDs.insert(id).inserted else {
                return .failure(.duplicateNodeID)
            }
            let sourceFile = stringValue(node["source_file"]) ?? stringValue(node["_source_file"])
            metadataSeeds.append(NodeMetadataSeed(id: id, sourceFile: sourceFile))
            guard let canonical = canonicalNode(node, id: id) else {
                return .failure(.invalidShape)
            }
            nodeFingerprints.append(digest(Data(canonical.utf8)))
            guard let contentHash = radarNodeContentHash(node) else {
                return .failure(.invalidShape)
            }
            radarNodes.append(
                .init(
                    id: id,
                    contentHash: contentHash,
                    community: firstString(in: node, keys: ["community", "community_name", "group", "cluster"]) ?? "Unassigned",
                    sourcePath: radarSourcePath(node["source_file"], vaultURL: vaultURL),
                    status: firstString(in: node, keys: ["status"]),
                    category: firstString(in: node, keys: ["category", "type"]),
                    hasExplicitAttention: hasExplicitAttention(in: node)
                )
            )
        }

        var explicitEdgeIDs = Set<String>()
        var edgeFingerprints: [String] = []
        var idlessEdges: [(semanticKey: String, source: String, target: String, relation: String)] = []
        var radarEdges: [GraphChangeRadarSeed.Edge] = []
        for (index, rawEdge) in rawEdges.enumerated() {
            guard index % 256 != 0 || !Task.isCancelled else {
                return .failure(.invalidJSON)
            }
            guard let edge = rawEdge as? [String: Any] else {
                return .failure(.invalidShape)
            }
            guard let source = endpointID(in: edge, primaryKey: "source", alternateKey: "from"),
                  let target = endpointID(in: edge, primaryKey: "target", alternateKey: "to"),
                  nodeIDs.contains(source), nodeIDs.contains(target)
            else {
                return .failure(.missingEndpoint)
            }

            if edge.keys.contains("id") {
                guard let id = scalarID(edge["id"]) else {
                    return .failure(.missingEdgeID)
                }
                guard explicitEdgeIDs.insert(id).inserted else {
                    return .failure(.duplicateEdgeID)
                }
                radarEdges.append(.init(identity: "id:\(id)", source: source, target: target))
            } else {
                guard let semanticKey = radarEdgeSemanticKey(edge, source: source, target: target) else {
                    return .failure(.invalidShape)
                }
                idlessEdges.append((semanticKey, source, target, firstString(in: edge, keys: ["relation", "context", "type"]) ?? ""))
            }

            guard let canonical = canonicalEdge(edge, source: source, target: target) else {
                return .failure(.invalidShape)
            }
            edgeFingerprints.append(digest(Data(canonical.utf8)))
        }

        for grouped in Dictionary(grouping: idlessEdges, by: \.semanticKey) {
            let digest = digest(Data(grouped.key.utf8))
            for (ordinal, edge) in grouped.value.sorted(by: { ($0.source, $0.target, $0.relation) < ($1.source, $1.target, $1.relation) }).enumerated() {
                radarEdges.append(.init(identity: "semantic:\(digest):\(ordinal)", source: edge.source, target: edge.target))
            }
        }

        nodeFingerprints.sort()
        edgeFingerprints.sort()
        let semanticMaterial = [
            "nodes:\(nodeFingerprints.count)",
            nodeFingerprints.map { "node:\($0)" }.joined(separator: "\n"),
            "edges:\(edgeFingerprints.count)",
            edgeFingerprints.map { "edge:\($0)" }.joined(separator: "\n")
        ].joined(separator: "\n")
        let semanticFingerprint = digest(Data(semanticMaterial.utf8))
        let counts = GraphDataCounts(nodes: rawNodes.count, edges: rawEdges.count)
        let handle = GraphDataHandle(
            digest: digest(rawData),
            semanticFingerprint: semanticFingerprint,
            counts: counts,
            sourceSignature: sourceSignature
        )
        return .success(
            PreparedGraph(
                handle: handle,
                rawData: rawData,
                metadataSeeds: metadataSeeds,
                radarSeed: .init(
                    graphDigest: handle.digest,
                    semanticFingerprint: handle.semanticFingerprint,
                    nodes: radarNodes.sorted { $0.id < $1.id },
                    edges: radarEdges.sorted { $0.identity < $1.identity }
                )
            )
        )
    }

    private static func scalarID(_ value: Any?) -> String? {
        guard let string = value as? String else {
            return nil
        }
        return string.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : string
    }

    private static func stringValue(_ value: Any?) -> String? {
        guard let string = value as? String else {
            return nil
        }
        let trimmed = string.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func endpointID(
        in edge: [String: Any],
        primaryKey: String,
        alternateKey: String
    ) -> String? {
        let values = [edge[primaryKey], edge[alternateKey]].compactMap { value -> String? in
            scalarID(value) ?? ((value as? [String: Any]).flatMap { scalarID($0["id"]) })
        }
        guard let first = values.first, values.dropFirst().allSatisfy({ $0 == first }) else {
            return nil
        }
        return first
    }

    private static func canonicalEdge(_ edge: [String: Any], source: String, target: String) -> String? {
        var normalized = edge
        normalized.removeValue(forKey: "source")
        normalized.removeValue(forKey: "from")
        normalized.removeValue(forKey: "target")
        normalized.removeValue(forKey: "to")
        normalized["source"] = source
        normalized["target"] = target
        guard
            let data = try? JSONSerialization.data(withJSONObject: normalized, options: [.sortedKeys]),
            let string = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return string
    }

    private static func canonicalNode(_ node: [String: Any], id: String) -> String? {
        var normalized = node
        normalized["id"] = id
        guard
            let data = try? JSONSerialization.data(withJSONObject: normalized, options: [.sortedKeys]),
            let string = String(data: data, encoding: .utf8)
        else {
            return nil
        }
        return string
    }

    private static func radarNodeContentHash(_ node: [String: Any]) -> String? {
        var normalized = node
        ["id", "community", "community_name", "group", "cluster"].forEach { normalized.removeValue(forKey: $0) }
        return canonicalRadarJSON(normalized).map { digest(Data($0.utf8)) }
    }

    private static func radarEdgeSemanticKey(_ edge: [String: Any], source: String, target: String) -> String? {
        var attributes = edge
        ["id", "source", "from", "target", "to", "relation", "context", "type"].forEach { attributes.removeValue(forKey: $0) }
        guard let body = canonicalRadarJSON(attributes) else {
            return nil
        }
        let relation = firstString(in: edge, keys: ["relation", "context", "type"]) ?? ""
        return [source, target, relation, body].joined(separator: "\u{1F}")
    }

    private static func canonicalRadarJSON(_ object: Any) -> String? {
        switch object {
        case let dictionary as [String: Any]:
            let members = dictionary.keys.sorted().compactMap { key -> String? in
                guard let value = dictionary[key],
                      let canonicalValue = canonicalRadarJSON(value)
                else {
                    return nil
                }
                let canonicalKey = canonicalRadarString(key)
                return "\(canonicalKey):\(canonicalValue)"
            }
            guard members.count == dictionary.count else {
                return nil
            }
            return "{\(members.joined(separator: ","))}"
        case let array as [Any]:
            let values = array.compactMap(canonicalRadarJSON)
            guard values.count == array.count else {
                return nil
            }
            return "[\(values.joined(separator: ","))]"
        case let string as String:
            return canonicalRadarString(string)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return number.boolValue ? "true" : "false"
            }
            return number.doubleValue.isFinite ? number.stringValue : nil
        case _ as NSNull:
            return "null"
        default:
            return nil
        }
    }

    private static func canonicalRadarString(_ string: String) -> String {
        var result = "\""
        for scalar in string.unicodeScalars {
            switch scalar.value {
            case 0x08: result += "\\b"
            case 0x09: result += "\\t"
            case 0x0A: result += "\\n"
            case 0x0C: result += "\\f"
            case 0x0D: result += "\\r"
            case 0x22: result += "\\\""
            case 0x5C: result += "\\\\"
            case 0..<0x20:
                let hexadecimal = String(scalar.value, radix: 16)
                result += "\\u" + String(repeating: "0", count: 4 - hexadecimal.count) + hexadecimal
            default: result.unicodeScalars.append(scalar)
            }
        }
        return result + "\""
    }

    private static func firstString(in object: [String: Any], keys: [String]) -> String? {
        for key in keys {
            if let value = stringValue(object[key]) {
                return value
            }
        }
        return nil
    }

    private static func hasExplicitAttention(in node: [String: Any]) -> Bool {
        if let pending = node["pending"] as? Bool, pending {
            return true
        }
        if let review = node["review"] as? Bool, review {
            return true
        }
        let values = [node["pending"], node["review"]].compactMap { stringValue($0) }
        if values.contains(where: { ["pending", "review", "true", "yes", "open"].contains($0.lowercased()) }) {
            return true
        }
        guard let status = firstString(in: node, keys: ["status"])?.lowercased() else {
            return false
        }
        return ["pending", "review", "needs_attention", "needs-attention", "needs attention", "open"].contains(status)
    }

    private static func radarSourcePath(_ value: Any?, vaultURL: URL) -> String? {
        guard let sourceFile = stringValue(value),
              let fileURL = resolvedVaultFileURL(sourceFile, vaultURL: vaultURL)
        else {
            return nil
        }
        let resolvedVaultURL = vaultURL.resolvingSymlinksInPath().standardizedFileURL
        let prefix = resolvedVaultURL.path.hasSuffix("/") ? resolvedVaultURL.path : resolvedVaultURL.path + "/"
        guard fileURL.path.hasPrefix(prefix) else {
            return nil
        }
        return String(fileURL.path.dropFirst(prefix.count)).replacingOccurrences(of: "\\", with: "/")
    }

    private static func sourceSignatureSync(for url: URL) -> String? {
        let resolvedURL = url.resolvingSymlinksInPath().standardizedFileURL
        guard let values = try? resolvedURL.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
              let modifiedAt = values.contentModificationDate,
              let fileSize = values.fileSize
        else {
            return nil
        }
        let nanoseconds = Int64(modifiedAt.timeIntervalSince1970 * 1_000_000_000)
        let sourceIdentity = digest(Data(resolvedURL.path.utf8))
        return digest(Data("\(sourceIdentity):\(nanoseconds):\(fileSize)".utf8))
    }

    private static func metadataData(seeds: [NodeMetadataSeed], vaultURL: URL) -> Data {
        var byNodeID: [String: [String: Any]] = [:]
        var bySourceFile: [String: [String: Any]] = [:]

        for (index, seed) in seeds.enumerated() {
            guard index % 256 != 0 || !Task.isCancelled else {
                return emptyMetadataData()
            }
            guard let sourceFile = seed.sourceFile,
                  let fileURL = resolvedVaultFileURL(sourceFile, vaultURL: vaultURL),
                  let modifiedAt = try? fileURL.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate?.timeIntervalSince1970
            else {
                continue
            }
            let entry: [String: Any] = ["source_file": sourceFile, "mtime": modifiedAt]
            byNodeID[seed.id] = entry
            bySourceFile[sourceFile] = entry
        }

        let payload: [String: Any] = ["byNodeId": byNodeID, "bySourceFile": bySourceFile]
        return (try? JSONSerialization.data(withJSONObject: payload)) ?? emptyMetadataData()
    }

    private static func emptyMetadataData() -> Data {
        Data("{\"byNodeId\":{},\"bySourceFile\":{}}".utf8)
    }

    private static func resolvedVaultFileURL(_ sourceFile: String, vaultURL: URL) -> URL? {
        guard !sourceFile.hasPrefix("/"),
              !sourceFile.split(separator: "/").contains(where: { $0 == ".." })
        else {
            return nil
        }
        let resolvedVaultURL = vaultURL.resolvingSymlinksInPath().standardizedFileURL
        let resolved = resolvedVaultURL
            .appendingPathComponent(sourceFile)
            .resolvingSymlinksInPath()
            .standardizedFileURL
        guard resolved.path.hasPrefix(resolvedVaultURL.path + "/") || resolved.path == resolvedVaultURL.path else {
            return nil
        }
        return resolved
    }

    private static func digest(_ data: Data) -> String {
        var hexadecimal = [UInt8]()
        hexadecimal.reserveCapacity(64)
        for byte in SHA256.hash(data: data) {
            hexadecimal.append(lowercaseHexDigits[Int(byte >> 4)])
            hexadecimal.append(lowercaseHexDigits[Int(byte & 0x0f)])
        }
        return String(decoding: hexadecimal, as: UTF8.self)
    }
}
