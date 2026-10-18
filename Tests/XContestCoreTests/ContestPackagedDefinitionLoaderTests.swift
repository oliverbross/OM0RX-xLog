import Foundation
import XCTest
@testable import XContestCore

final class ContestPackagedDefinitionLoaderTests: XCTestCase {
    func testBundledCatalogExactlyMatchesReviewedArchiveFactories() throws {
        let expected = try TenTenSeasonalVariant.allCases.map {
            try ContestDeclarativeCatalogEntry(definition: TenTenDeclarativeDefinitions.archiveDefinition(for: $0))
        } + CWUniqueCallContestVariant.allCases.map {
            try ContestDeclarativeCatalogEntry(definition: CWUniqueCallDeclarativeDefinitions.archiveDefinition(for: $0))
        } + [try ContestDeclarativeCatalogEntry(definition: SSTDeclarativeDefinition.definition())]
        let expectedSorted = expected.sorted { $0.identity.id < $1.identity.id }
        let actual = try ContestPackagedDefinitionLoader.bundledEntries()
        XCTAssertEqual(actual.map(\.identity), expectedSorted.map(\.identity))
        XCTAssertEqual(try actual.map { try $0.definition.canonicalStorageData() },
                       try expectedSorted.map { try $0.definition.canonicalStorageData() })
        XCTAssertEqual(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries().map(\.identity),
                       expectedSorted.map(\.identity))
    }

    func testManifestAndDefinitionDuplicateKeysAreRejected() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        try Data(#"{"schemaVersion":1,"schemaVersion":1,"definitions":[]}"#.utf8)
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))

        let draft = TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let encoded = try encoder.encode(draft)
        let duplicate = Data(#"{"id":"duplicate","#.utf8) + encoded.dropFirst()
        let filename = "duplicate.runtime-draft.json"
        try duplicate.write(to: directory.appendingPathComponent(filename))
        try manifestData(records: [manifestRecord(file: filename, data: duplicate,
                                                   identity: try draft.materialized().identity)])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
    }

    func testUnsafePathsUnknownManifestKeysAndConflictingIdentitiesAreRejected() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(draft)
        let identity = try draft.materialized().identity

        try manifestData(records: [manifestRecord(file: "../escape.runtime-draft.json", data: data,
                                                   identity: identity)])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))

        let unknown = #"{"definitions":[],"future":true,"schemaVersion":1}"#
        try Data(unknown.utf8).write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))

        var nestedUnknown = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        var scoring = try XCTUnwrap(nestedUnknown["scoring"] as? [String: Any])
        scoring["future"] = true
        nestedUnknown["scoring"] = scoring
        let unknownData = try JSONSerialization.data(withJSONObject: nestedUnknown, options: [.sortedKeys])
        let unknownFile = "unknown.runtime-draft.json"
        try unknownData.write(to: directory.appendingPathComponent(unknownFile))
        try manifestData(records: [manifestRecord(file: unknownFile, data: unknownData, identity: identity)])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
        try FileManager.default.removeItem(at: directory.appendingPathComponent(unknownFile))

        let first = "a.runtime-draft.json", second = "b.runtime-draft.json"
        try data.write(to: directory.appendingPathComponent(first))
        try data.write(to: directory.appendingPathComponent(second))
        try manifestData(records: [manifestRecord(file: first, data: data, identity: identity),
                                   manifestRecord(file: second, data: data, identity: identity)])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
    }

    func testExtraSymlinkOversizedAndOverCapacityResourcesAreRejected() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(draft)
        let identity = try draft.materialized().identity
        let filename = "definition.runtime-draft.json"
        try data.write(to: directory.appendingPathComponent(filename))
        let record = manifestRecord(file: filename, data: data, identity: identity)
        try manifestData(records: [record]).write(to: directory.appendingPathComponent("manifest.json"))

        try Data("extra".utf8).write(to: directory.appendingPathComponent("unlisted.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
        try FileManager.default.removeItem(at: directory.appendingPathComponent("unlisted.json"))

        try FileManager.default.removeItem(at: directory.appendingPathComponent(filename))
        try FileManager.default.createSymbolicLink(
            at: directory.appendingPathComponent(filename), withDestinationURL: URL(fileURLWithPath: "/dev/null"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
        try FileManager.default.removeItem(at: directory.appendingPathComponent(filename))

        let oversized = Data(repeating: 32, count: 256 * 1024 + 1)
        try oversized.write(to: directory.appendingPathComponent(filename))
        try manifestData(records: [manifestRecord(file: filename, data: oversized, identity: identity)])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))

        let tooMany = (0..<129).map { index -> [String: Any] in
            var item = record
            item["file"] = String(format: "definition-%03d.runtime-draft.json", index)
            return item
        }
        try manifestData(records: tooMany).write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory)) { error in
            XCTAssertEqual(error as? ContestPackagedDefinitionError,
                           .invalidManifest("unsupported version or definition count"))
        }
    }

    func testManifestCapacityAdmitsNinetyFourDistinctDefinitions() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let base = try JSONEncoder().encode(TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW))
        let baseObject = try XCTUnwrap(JSONSerialization.jsonObject(with: base) as? [String: Any])
        var records: [[String: Any]] = []
        for index in 0..<94 {
            var object = baseObject
            object["id"] = String(format: "capacity-%03d", index)
            let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            let draft = try JSONDecoder().decode(ContestDefinitionDraft.self, from: data)
            let filename = String(format: "capacity-%03d.runtime-draft.json", index)
            try data.write(to: directory.appendingPathComponent(filename))
            records.append(manifestRecord(file: filename, data: data,
                                          identity: try draft.materialized().identity))
        }
        let manifest = try manifestData(records: records)
        XCTAssertLessThanOrEqual(manifest.count, 64 * 1024)
        try manifest.write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertEqual(try ContestPackagedDefinitionLoader.load(from: directory).count, 94)
    }

    func testManifestHashAndDefinitionHashAreEnforced() throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let draft = TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW)
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        let data = try encoder.encode(draft)
        let filename = "definition.runtime-draft.json"
        try data.write(to: directory.appendingPathComponent(filename))
        let manifest = try manifestData(records: [manifestRecord(file: filename, data: data,
                                                                 identity: try draft.materialized().identity)])
        try manifest.write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(
            from: directory, expectedManifestSHA256: String(repeating: "0", count: 64)))
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: manifest) as? [String: Any])
        var definitions = try XCTUnwrap(object["definitions"] as? [[String: Any]])
        definitions[0]["sha256"] = String(repeating: "0", count: 64)
        object["definitions"] = definitions
        try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
            .write(to: directory.appendingPathComponent("manifest.json"))
        XCTAssertThrowsError(try ContestPackagedDefinitionLoader.load(from: directory))
    }

    func testDeclarativeADIFTargetsRejectWrongSidesAndDuplicates() throws {
        let original = try JSONEncoder().encode(TenTenDeclarativeDefinitions.archiveDraft(for: .fallCW))
        func mutated(_ change: (inout [[String: Any]], inout [[String: Any]]) -> Void) throws
            -> ContestDefinitionDraft {
            var root = try XCTUnwrap(JSONSerialization.jsonObject(with: original) as? [String: Any])
            var entry = try XCTUnwrap(root["entry"] as? [String: Any])
            var exchange = try XCTUnwrap(entry["exchange"] as? [String: Any])
            var sent = try XCTUnwrap(exchange["sentFields"] as? [[String: Any]])
            var received = try XCTUnwrap(exchange["receivedFields"] as? [[String: Any]])
            change(&sent, &received)
            exchange["sentFields"] = sent; exchange["receivedFields"] = received
            entry["exchange"] = exchange; root["entry"] = entry
            return try JSONDecoder().decode(ContestDefinitionDraft.self,
                                            from: JSONSerialization.data(withJSONObject: root))
        }
        XCTAssertThrowsError(try mutated { sent, _ in sent[0]["adifField"] = "NAME" }.materialized())
        XCTAssertThrowsError(try mutated { _, received in received[0]["adifField"] = "MY_NAME" }.materialized())
        XCTAssertThrowsError(try mutated { sent, _ in sent[1]["adifField"] = "MY_NAME" }.materialized())
        XCTAssertThrowsError(try mutated { _, received in received[1]["adifField"] = "NAME" }.materialized())
    }

    private func temporaryDirectory() throws -> URL {
        let result = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-packaged-definitions-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: result, withIntermediateDirectories: true)
        return result
    }

    private func manifestRecord(file: String, data: Data, identity: ContestRuleIdentity) -> [String: Any] {
        ["file": file, "sha256": ContestSCPIndex.sha256(data), "identity": [
            "id": identity.id, "version": identity.version, "edition": identity.edition,
            "sourceRevision": identity.sourceRevision,
        ]]
    }

    private func manifestData(records: [[String: Any]]) throws -> Data {
        try JSONSerialization.data(withJSONObject: ["schemaVersion": 1, "definitions": records],
                                   options: [.sortedKeys])
    }
}
