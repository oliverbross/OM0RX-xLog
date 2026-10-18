import Foundation

public enum ContestPackagedDefinitionError: Error, Equatable {
    case missingResource(String)
    case invalidManifest(String)
    case invalidDefinition(String)
    case digestMismatch(String)
    case identityMismatch(String)
}

private struct ContestPackagedDynamicKey: CodingKey {
    let stringValue: String
    let intValue: Int?
    init?(stringValue: String) { self.stringValue = stringValue; intValue = nil }
    init?(intValue: Int) { stringValue = String(intValue); self.intValue = intValue }
}

private func rejectUnknownPackagedKeys<Key: CodingKey & CaseIterable>(
    from decoder: Decoder, allowedBy _: Key.Type
) throws where Key.AllCases: Collection {
    let values = try decoder.container(keyedBy: ContestPackagedDynamicKey.self)
    let allowed = Set(Key.allCases.map(\.stringValue))
    let unknown = values.allKeys.map(\.stringValue).filter { !allowed.contains($0) }.sorted()
    guard unknown.isEmpty else {
        throw DecodingError.dataCorrupted(.init(
            codingPath: decoder.codingPath,
            debugDescription: "Unknown packaged definition keys: \(unknown.joined(separator: ", "))."))
    }
}

private struct ContestPackagedDefinitionManifest: Decodable {
    struct Entry: Decodable {
        struct Identity: Decodable {
            let id: String
            let version: String
            let edition: String
            let sourceRevision: String
            private enum CodingKeys: String, CodingKey, CaseIterable { case id, version, edition, sourceRevision }
            init(from decoder: Decoder) throws {
                try rejectUnknownPackagedKeys(from: decoder, allowedBy: CodingKeys.self)
                let values = try decoder.container(keyedBy: CodingKeys.self)
                id = try values.decode(String.self, forKey: .id)
                version = try values.decode(String.self, forKey: .version)
                edition = try values.decode(String.self, forKey: .edition)
                sourceRevision = try values.decode(String.self, forKey: .sourceRevision)
            }
        }
        let file: String
        let sha256: String
        let identity: Identity
        private enum CodingKeys: String, CodingKey, CaseIterable { case file, sha256, identity }
        init(from decoder: Decoder) throws {
            try rejectUnknownPackagedKeys(from: decoder, allowedBy: CodingKeys.self)
            let values = try decoder.container(keyedBy: CodingKeys.self)
            file = try values.decode(String.self, forKey: .file)
            sha256 = try values.decode(String.self, forKey: .sha256)
            identity = try values.decode(Identity.self, forKey: .identity)
        }
    }
    let schemaVersion: Int
    let definitions: [Entry]
    private enum CodingKeys: String, CodingKey, CaseIterable { case schemaVersion, definitions }
    init(from decoder: Decoder) throws {
        try rejectUnknownPackagedKeys(from: decoder, allowedBy: CodingKeys.self)
        let values = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try values.decode(Int.self, forKey: .schemaVersion)
        definitions = try values.decode([Entry].self, forKey: .definitions)
    }
}

/// Loads the fixed, reviewed archive catalog from data resources. It does not
/// discover arbitrary files and never evaluates code or adapter identifiers.
public enum ContestPackagedDefinitionLoader {
    public static let bundledManifestSHA256 = "8ddcedf31e30fbc3b59249361db4740f16ac6725efcd8a8be291e78a2f1a9502"
    private static let manifestName = "manifest.json"
    private static let maximumManifestBytes = 64 * 1024
    private static let maximumDefinitionBytes = 256 * 1024
    private static let maximumDefinitions = 128

    private struct LogicalIdentity: Hashable {
        let id: String
        let version: String
        let edition: String
    }

    public static func bundledEntries() throws -> [ContestDeclarativeCatalogEntry] {
        guard let resourceURL = Bundle.module.resourceURL else {
            throw ContestPackagedDefinitionError.missingResource("XContestCore resource bundle")
        }
        return try load(from: resourceURL.appendingPathComponent("ContestDefinitions", isDirectory: true),
                        expectedManifestSHA256: bundledManifestSHA256)
    }

    public static func load(from directory: URL, expectedManifestSHA256: String? = nil) throws
        -> [ContestDeclarativeCatalogEntry] {
        let manifestURL = directory.appendingPathComponent(manifestName, isDirectory: false)
        let manifestData = try readBoundedRegularFile(
            manifestURL, maximumBytes: maximumManifestBytes, missing: .missingResource(manifestName),
            invalid: .invalidManifest("manifest must be a bounded regular file"))
        if let expectedManifestSHA256,
           ContestSCPIndex.sha256(manifestData) != expectedManifestSHA256 {
            throw ContestPackagedDefinitionError.digestMismatch(manifestName)
        }
        do { try StrictJSONDuplicateKeyValidator.validate(manifestData) }
        catch { throw ContestPackagedDefinitionError.invalidManifest("duplicate or malformed JSON key") }
        let manifest: ContestPackagedDefinitionManifest
        do { manifest = try JSONDecoder().decode(ContestPackagedDefinitionManifest.self, from: manifestData) }
        catch { throw ContestPackagedDefinitionError.invalidManifest(String(describing: error)) }
        guard manifest.schemaVersion == 1,
              (1...maximumDefinitions).contains(manifest.definitions.count) else {
            throw ContestPackagedDefinitionError.invalidManifest("unsupported version or definition count")
        }
        let files = manifest.definitions.map(\.file)
        guard Set(files).count == files.count, files == files.sorted(), files.allSatisfy(validFilename) else {
            throw ContestPackagedDefinitionError.invalidManifest("definition filenames must be unique, sorted, and safe")
        }
        let expectedFiles = Set(files + [manifestName])
        let directoryValues = try? directory.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard directoryValues?.isDirectory == true, directoryValues?.isSymbolicLink != true,
              let actualURLs = try? FileManager.default.contentsOfDirectory(
                at: directory, includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey],
                options: []) else {
            throw ContestPackagedDefinitionError.invalidManifest("resource directory is unavailable or unsafe")
        }
        guard Set(actualURLs.map(\.lastPathComponent)) == expectedFiles else {
            throw ContestPackagedDefinitionError.invalidManifest("resource directory contains missing or unlisted files")
        }
        var entries: [ContestDeclarativeCatalogEntry] = []
        for record in manifest.definitions {
            let url = directory.appendingPathComponent(record.file, isDirectory: false)
            guard url.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL else {
                throw ContestPackagedDefinitionError.invalidManifest("unsafe definition path")
            }
            let data = try readBoundedRegularFile(
                url, maximumBytes: maximumDefinitionBytes, missing: .missingResource(record.file),
                invalid: .invalidDefinition("\(record.file): must be a bounded regular file"))
            guard ContestSCPIndex.sha256(data) == record.sha256 else {
                throw ContestPackagedDefinitionError.digestMismatch(record.file)
            }
            do { try StrictJSONDuplicateKeyValidator.validate(data) }
            catch { throw ContestPackagedDefinitionError.invalidDefinition("\(record.file): duplicate or malformed JSON key") }
            let draft: ContestDefinitionDraft
            do { draft = try JSONDecoder().decode(ContestDefinitionDraft.self, from: data) }
            catch { throw ContestPackagedDefinitionError.invalidDefinition("\(record.file): \(error)") }
            guard try hasExactDecodedShape(data, draft: draft) else {
                throw ContestPackagedDefinitionError.invalidDefinition(
                    "\(record.file): unknown, duplicate, or noncanonical fields")
            }
            let entry: ContestDeclarativeCatalogEntry
            do { entry = try .init(definition: draft.materialized()) }
            catch { throw ContestPackagedDefinitionError.invalidDefinition("\(record.file): \(error)") }
            let expected = record.identity
            guard entry.identity.id == expected.id, entry.identity.version == expected.version,
                  entry.identity.edition == expected.edition,
                  entry.identity.sourceRevision == expected.sourceRevision else {
                throw ContestPackagedDefinitionError.identityMismatch(
                    "\(record.file): expected \(expected.sourceRevision), materialized \(entry.identity.sourceRevision)")
            }
            entries.append(entry)
        }
        let identities = entries.map(\.identity)
        let logical = identities.map { LogicalIdentity(id: $0.id, version: $0.version, edition: $0.edition) }
        guard Set(identities).count == identities.count, Set(logical).count == logical.count else {
            throw ContestPackagedDefinitionError.identityMismatch("duplicate or conflicting catalog identity")
        }
        return entries.sorted {
            ($0.identity.id, $0.identity.version, $0.identity.edition, $0.identity.sourceRevision) <
            ($1.identity.id, $1.identity.version, $1.identity.edition, $1.identity.sourceRevision)
        }
    }

    private static func validFilename(_ value: String) -> Bool {
        let bytes = Array(value.utf8)
        guard (1...96).contains(bytes.count), value.hasSuffix(".runtime-draft.json") else { return false }
        return bytes.allSatisfy { (97...122).contains($0) || (48...57).contains($0) || $0 == 95 || $0 == 45 || $0 == 46 }
    }

    private static func readBoundedRegularFile(
        _ url: URL, maximumBytes: Int, missing: ContestPackagedDefinitionError,
        invalid: ContestPackagedDefinitionError
    ) throws -> Data {
        let values: URLResourceValues
        do {
            values = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey])
        } catch {
            throw missing
        }
        guard values.isRegularFile == true, values.isSymbolicLink != true,
              let size = values.fileSize, (1...maximumBytes).contains(size) else { throw invalid }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: maximumBytes + 1) ?? Data()
            guard data.count == size, (1...maximumBytes).contains(data.count) else { throw invalid }
            return data
        } catch let error as ContestPackagedDefinitionError {
            throw error
        } catch {
            throw missing
        }
    }

    private static func hasExactDecodedShape(_ data: Data, draft: ContestDefinitionDraft) throws -> Bool {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let encoded = try encoder.encode(draft)
        func normalized(_ value: Data) throws -> Data {
            guard var object = try JSONSerialization.jsonObject(with: value) as? [String: Any] else {
                return Data()
            }
            for key in ["supportedBands", "supportedModes"] {
                if let values = object[key] as? [String] { object[key] = values.sorted() }
            }
            return try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])
        }
        return try normalized(data) == normalized(encoded)
    }
}

private enum StrictJSONDuplicateKeyValidator {
    static func validate(_ data: Data) throws {
        var parser = Parser(bytes: Array(data))
        try parser.parseValue(depth: 0)
        parser.skipWhitespace()
        guard parser.index == parser.bytes.count else { throw Error.invalid }
    }

    private enum Error: Swift.Error { case invalid, duplicate }
    private struct Parser {
        let bytes: [UInt8]
        var index = 0

        mutating func skipWhitespace() {
            while index < bytes.count, [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
        }
        mutating func parseValue(depth: Int) throws {
            guard depth <= 128 else { throw Error.invalid }
            skipWhitespace(); guard index < bytes.count else { throw Error.invalid }
            switch bytes[index] {
            case 123: try parseObject(depth: depth + 1)
            case 91: try parseArray(depth: depth + 1)
            case 34: _ = try parseString()
            case 116: try consume("true")
            case 102: try consume("false")
            case 110: try consume("null")
            default: try parseNumber()
            }
        }
        mutating func parseObject(depth: Int) throws {
            index += 1; skipWhitespace()
            if consumeIf(125) { return }
            var keys: Set<String> = []
            while true {
                skipWhitespace(); let key = try parseString()
                guard keys.insert(key).inserted else { throw Error.duplicate }
                skipWhitespace(); guard consumeIf(58) else { throw Error.invalid }
                try parseValue(depth: depth); skipWhitespace()
                if consumeIf(125) { return }
                guard consumeIf(44) else { throw Error.invalid }
            }
        }
        mutating func parseArray(depth: Int) throws {
            index += 1; skipWhitespace()
            if consumeIf(93) { return }
            while true {
                try parseValue(depth: depth); skipWhitespace()
                if consumeIf(93) { return }
                guard consumeIf(44) else { throw Error.invalid }
            }
        }
        mutating func parseString() throws -> String {
            guard index < bytes.count, bytes[index] == 34 else { throw Error.invalid }
            let start = index; index += 1
            var escaped = false
            while index < bytes.count {
                let byte = bytes[index]; index += 1
                if escaped { escaped = false; continue }
                if byte == 92 { escaped = true; continue }
                if byte == 34 {
                    return try JSONDecoder().decode(String.self, from: Data(bytes[start..<index]))
                }
                if byte < 32 { throw Error.invalid }
            }
            throw Error.invalid
        }
        mutating func parseNumber() throws {
            let start = index
            while index < bytes.count, [45, 43, 46, 69, 101].contains(bytes[index]) ||
                    (48...57).contains(bytes[index]) { index += 1 }
            guard index > start else { throw Error.invalid }
        }
        mutating func consume(_ text: String) throws {
            let expected = Array(text.utf8)
            guard index + expected.count <= bytes.count,
                  Array(bytes[index..<(index + expected.count)]) == expected else { throw Error.invalid }
            index += expected.count
        }
        mutating func consumeIf(_ byte: UInt8) -> Bool {
            guard index < bytes.count, bytes[index] == byte else { return false }
            index += 1; return true
        }
    }
}
