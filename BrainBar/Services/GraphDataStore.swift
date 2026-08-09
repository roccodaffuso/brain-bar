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

    private struct RadarNodeDraft: Sendable {
        let id: String
        let contentData: Data
        let community: String
        let sourceFile: String?
        let status: String?
        let category: String?
        let hasExplicitAttention: Bool
    }

    private enum RadarEdgeDraft: Sendable {
        case explicit(id: String, source: String, target: String)
        case idless(source: String, target: String, relation: String, attributesData: Data)
    }

    private struct RadarSeedDraft: Sendable {
        let graphDigest: String
        let semanticFingerprint: String
        let vaultURL: URL
        let nodes: [RadarNodeDraft]
        let edges: [RadarEdgeDraft]
    }

    private struct PreparedGraph: Sendable {
        let handle: GraphDataHandle
        let rawData: Data
        let metadataSeeds: [NodeMetadataSeed]
        let radarDraft: RadarSeedDraft
    }

    private struct CachedGraph {
        let generation: UUID
        let handle: GraphDataHandle
        let rawData: Data
        let metadataTask: Task<Data, Never>
        let radarTask: Task<GraphChangeRadarSeed, Never>
    }

    private var requestToken = 0
    private var activeTask: Task<Result<PreparedGraph, GraphDataValidationCode>, Never>?
    private var cachedGraph: CachedGraph?
    private let dataLoader: DataLoader
    private let radarTaskHook: @Sendable () async -> Void

    init(dataLoader: @escaping DataLoader = { url in
        await Task.detached(priority: .userInitiated) {
            try? Data(contentsOf: url)
        }.value
    }, radarTaskHook: @escaping @Sendable () async -> Void = {}) {
        self.dataLoader = dataLoader
        self.radarTaskHook = radarTaskHook
    }

    func prepare(url: URL, policy: GraphDataPreparePolicy) async -> GraphDataLoadResult {
        requestToken += 1
        let token = requestToken
        activeTask?.cancel()

        if policy == .normal,
           let cachedGraph,
           let sourceSignature = Self.sourceSignatureSync(for: url),
           sourceSignature == cachedGraph.handle.sourceSignature {
            activeTask = nil
            return .ready(cachedGraph.handle)
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
            let radarTaskHook = self.radarTaskHook
            let radarTask = Task.detached(priority: .utility) {
                await radarTaskHook()
                return Self.radarSeed(from: prepared.radarDraft)
            }
            cachedGraph?.metadataTask.cancel()
            cachedGraph?.radarTask.cancel()
            cachedGraph = CachedGraph(
                generation: UUID(),
                handle: prepared.handle,
                rawData: prepared.rawData,
                metadataTask: metadataTask,
                radarTask: radarTask
            )
            return .ready(prepared.handle)
        case .failure(let code):
            return .failed(code)
        }
    }

    func resource(for handle: GraphDataHandle, kind: GraphDataResourceKind) async -> Data? {
        guard let cachedGraph, cachedGraph.handle == handle else {
            return nil
        }
        let generation = cachedGraph.generation
        switch kind {
        case .graph:
            return cachedGraph.rawData
        case .metadata:
            let metadata = await cachedGraph.metadataTask.value
            guard let currentGraph = self.cachedGraph,
                  currentGraph.generation == generation,
                  currentGraph.handle == handle
            else {
                return nil
            }
            return metadata
        }
    }

    func radarSeed(for handle: GraphDataHandle) async -> GraphChangeRadarSeed? {
        guard let cachedGraph, cachedGraph.handle == handle else {
            return nil
        }
        let generation = cachedGraph.generation
        let seed = await cachedGraph.radarTask.value
        guard let currentGraph = self.cachedGraph,
              currentGraph.generation == generation,
              currentGraph.handle == handle
        else {
            return nil
        }
        return seed
    }

    func invalidate() {
        requestToken += 1
        activeTask?.cancel()
        activeTask = nil
        cachedGraph?.metadataTask.cancel()
        cachedGraph?.radarTask.cancel()
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
        var radarNodes: [RadarNodeDraft] = []
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
            guard let canonical = canonicalNodeData(node, id: id) else {
                return .failure(.invalidShape)
            }
            nodeFingerprints.append(digest(canonical))
            guard let contentData = radarNodeContentData(node) else {
                return .failure(.invalidShape)
            }
            radarNodes.append(
                .init(
                    id: id,
                    contentData: contentData,
                    community: firstString(in: node, keys: ["community", "community_name", "group", "cluster"]) ?? "Unassigned",
                    sourceFile: stringValue(node["source_file"]),
                    status: firstString(in: node, keys: ["status"]),
                    category: firstString(in: node, keys: ["category", "type"]),
                    hasExplicitAttention: hasExplicitAttention(in: node)
                )
            )
        }

        var explicitEdgeIDs = Set<String>()
        var edgeFingerprints: [String] = []
        var radarEdges: [RadarEdgeDraft] = []
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
                radarEdges.append(.explicit(id: id, source: source, target: target))
            } else {
                guard let attributesData = radarEdgeAttributesData(edge) else {
                    return .failure(.invalidShape)
                }
                radarEdges.append(
                    .idless(
                        source: source,
                        target: target,
                        relation: firstString(in: edge, keys: ["relation", "context", "type"]) ?? "",
                        attributesData: attributesData
                    )
                )
            }

            guard let canonical = canonicalEdgeData(edge, source: source, target: target) else {
                return .failure(.invalidShape)
            }
            edgeFingerprints.append(digest(canonical))
        }

        nodeFingerprints.sort()
        edgeFingerprints.sort()
        let semanticFingerprint = digest(
            semanticFingerprintMaterial(
                nodeFingerprints: nodeFingerprints,
                edgeFingerprints: edgeFingerprints
            )
        )
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
                radarDraft: .init(
                    graphDigest: handle.digest,
                    semanticFingerprint: handle.semanticFingerprint,
                    vaultURL: vaultURL,
                    nodes: radarNodes,
                    edges: radarEdges
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

    private static func canonicalEdgeData(_ edge: [String: Any], source: String, target: String) -> Data? {
        if edge["source"] as? String == source,
           edge["target"] as? String == target,
           edge["from"] == nil,
           edge["to"] == nil {
            return try? JSONSerialization.data(withJSONObject: edge, options: [.sortedKeys])
        }
        var normalized = edge
        normalized.removeValue(forKey: "source")
        normalized.removeValue(forKey: "from")
        normalized.removeValue(forKey: "target")
        normalized.removeValue(forKey: "to")
        normalized["source"] = source
        normalized["target"] = target
        return try? JSONSerialization.data(withJSONObject: normalized, options: [.sortedKeys])
    }

    private static func canonicalNodeData(_ node: [String: Any], id: String) -> Data? {
        if node["id"] as? String == id {
            return try? JSONSerialization.data(withJSONObject: node, options: [.sortedKeys])
        }
        var normalized = node
        normalized["id"] = id
        return try? JSONSerialization.data(withJSONObject: normalized, options: [.sortedKeys])
    }

    private static func radarNodeContentData(_ node: [String: Any]) -> Data? {
        var normalized = node
        ["id", "community", "community_name", "group", "cluster"].forEach { normalized.removeValue(forKey: $0) }
        return canonicalRadarJSONData(normalized)
    }

    private static func radarEdgeAttributesData(_ edge: [String: Any]) -> Data? {
        var attributes = edge
        ["id", "source", "from", "target", "to", "relation", "context", "type"].forEach { attributes.removeValue(forKey: $0) }
        return canonicalRadarJSONData(attributes)
    }

    private static func canonicalRadarJSONData(_ object: Any) -> Data? {
        switch object {
        case let dictionary as [String: Any]:
            var result = Data("{".utf8)
            for (index, key) in dictionary.keys.sorted().enumerated() {
                guard let value = dictionary[key],
                      let canonicalValue = canonicalRadarJSONData(value)
                else {
                    return nil
                }
                if index > 0 {
                    result.append(UInt8(ascii: ","))
                }
                result.append(contentsOf: canonicalRadarString(key).utf8)
                result.append(UInt8(ascii: ":"))
                result.append(canonicalValue)
            }
            result.append(UInt8(ascii: "}"))
            return result
        case let array as [Any]:
            var result = Data("[".utf8)
            for (index, value) in array.enumerated() {
                guard let canonicalValue = canonicalRadarJSONData(value) else {
                    return nil
                }
                if index > 0 {
                    result.append(UInt8(ascii: ","))
                }
                result.append(canonicalValue)
            }
            result.append(UInt8(ascii: "]"))
            return result
        case let string as String:
            return Data(canonicalRadarString(string).utf8)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                return Data((number.boolValue ? "true" : "false").utf8)
            }
            return number.doubleValue.isFinite ? Data(number.stringValue.utf8) : nil
        case _ as NSNull:
            return Data("null".utf8)
        default:
            return nil
        }
    }

    private static func semanticFingerprintMaterial(
        nodeFingerprints: [String],
        edgeFingerprints: [String]
    ) -> Data {
        var material = Data()
        material.reserveCapacity((nodeFingerprints.count + edgeFingerprints.count) * 70 + 64)
        material.append(contentsOf: "nodes:\(nodeFingerprints.count)\n".utf8)
        for (index, fingerprint) in nodeFingerprints.enumerated() {
            if index > 0 {
                material.append(UInt8(ascii: "\n"))
            }
            material.append(contentsOf: "node:\(fingerprint)".utf8)
        }
        material.append(UInt8(ascii: "\n"))
        material.append(contentsOf: "edges:\(edgeFingerprints.count)\n".utf8)
        for (index, fingerprint) in edgeFingerprints.enumerated() {
            if index > 0 {
                material.append(UInt8(ascii: "\n"))
            }
            material.append(contentsOf: "edge:\(fingerprint)".utf8)
        }
        return material
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

    private static func radarSeed(from draft: RadarSeedDraft) -> GraphChangeRadarSeed {
        let resolvedVaultURL = draft.vaultURL.resolvingSymlinksInPath().standardizedFileURL
        var nodes: [GraphChangeRadarSeed.Node] = []
        nodes.reserveCapacity(draft.nodes.count)
        for (index, node) in draft.nodes.enumerated() {
            guard index % 256 != 0 || !Task.isCancelled else {
                return .init(
                    graphDigest: draft.graphDigest,
                    semanticFingerprint: draft.semanticFingerprint,
                    nodes: [],
                    edges: []
                )
            }
            nodes.append(
                .init(
                    id: node.id,
                    contentHash: digest(node.contentData),
                    community: node.community,
                    sourcePath: radarSourcePath(node.sourceFile, resolvedVaultURL: resolvedVaultURL),
                    status: node.status,
                    category: node.category,
                    hasExplicitAttention: node.hasExplicitAttention
                )
            )
        }

        var edges: [GraphChangeRadarSeed.Edge] = []
        var idlessEdges: [String: [(source: String, target: String, relation: String)]] = [:]
        for (index, edge) in draft.edges.enumerated() {
            guard index % 256 != 0 || !Task.isCancelled else {
                return .init(
                    graphDigest: draft.graphDigest,
                    semanticFingerprint: draft.semanticFingerprint,
                    nodes: [],
                    edges: []
                )
            }
            switch edge {
            case let .explicit(id, source, target):
                edges.append(.init(identity: "id:\(id)", source: source, target: target))
            case let .idless(source, target, relation, attributesData):
                let semanticKey = [source, target, relation, String(decoding: attributesData, as: UTF8.self)]
                    .joined(separator: "\u{1F}")
                idlessEdges[semanticKey, default: []].append((source, target, relation))
            }
        }
        for grouped in idlessEdges {
            let digest = digest(Data(grouped.key.utf8))
            for (ordinal, edge) in grouped.value.sorted(by: { ($0.source, $0.target, $0.relation) < ($1.source, $1.target, $1.relation) }).enumerated() {
                edges.append(.init(identity: "semantic:\(digest):\(ordinal)", source: edge.source, target: edge.target))
            }
        }
        return .init(
            graphDigest: draft.graphDigest,
            semanticFingerprint: draft.semanticFingerprint,
            nodes: nodes.sorted { $0.id < $1.id },
            edges: edges.sorted { $0.identity < $1.identity }
        )
    }

    private static func radarSourcePath(_ sourceFile: String?, resolvedVaultURL: URL) -> String? {
        guard let sourceFile,
              let fileURL = resolvedVaultFileURL(sourceFile, resolvedVaultURL: resolvedVaultURL)
        else {
            return nil
        }
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
        resolvedVaultFileURL(
            sourceFile,
            resolvedVaultURL: vaultURL.resolvingSymlinksInPath().standardizedFileURL
        )
    }

    private static func resolvedVaultFileURL(_ sourceFile: String, resolvedVaultURL: URL) -> URL? {
        guard !sourceFile.hasPrefix("/"),
              !sourceFile.split(separator: "/").contains(where: { $0 == ".." })
        else {
            return nil
        }
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
