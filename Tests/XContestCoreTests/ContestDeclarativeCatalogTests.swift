import XCTest
@testable import XContestCore

final class ContestDeclarativeCatalogTests: XCTestCase {
    func testBuiltInArchiveCatalogIsDeterministicAndCanonical() throws {
        let first = try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries()
        let second = try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries()
        XCTAssertEqual(first.count, 8)
        XCTAssertEqual(first.map(\.identity), second.map(\.identity))
        XCTAssertEqual(first.map(\.canonicalDefinitionData), second.map(\.canonicalDefinitionData))
        XCTAssertEqual(Set(first.map { $0.identity.id }), [
            "ten-ten-winterPhone", "ten-ten-springCW", "ten-ten-summerPhone", "ten-ten-fallCW",
            "cwops-cwt", "cwops-open", "icwc-mst", "k1usn-sst",
        ])
        for entry in first {
            XCTAssertEqual(entry.identity.sourceRevision, entry.definitionDigest)
            XCTAssertEqual(entry.definition.draft.exportPolicy, .operatorArchive)
            XCTAssertEqual(try entry.definition.canonicalStorageData(), entry.canonicalDefinitionData)
            XCTAssertEqual(entry.rule.metadata.identity, entry.identity)
        }
    }
}
