import Foundation
import CryptoKit
import XCTest
@testable import XLogCore

final class CQWWPinnedCTYResolutionTests: XCTestCase {
    private struct Endpoint: Decodable, Equatable {
        let adif: Int
        let entityName: String
        let continent: String
        let cqZone: Int
    }

    private struct Fixture: Decodable {
        struct PinnedCTY: Decodable { let runtimeVersion: String }
        struct ResolverExpectation: Decodable {
            let callsign: String
            let endpoint: Endpoint
        }
        let pinnedCTY: PinnedCTY
        let resolverExpectations: [ResolverExpectation]
    }

    func testBundledResolverProducesReviewedCQWWSpecialEndpoints() throws {
        let fixture = try loadFixture()
        let csv = try CTYResolver.bundledCSV()
        XCTAssertEqual(SHA256.hash(data: Data(csv.utf8)).map { String(format: "%02x", $0) }.joined(),
                       "e5d907fb16842cfa3dd8502c20ebe6bfc2039c6f5b2cc73f9ea6d3f5915f6d6d")
        XCTAssertEqual(fnvVersion(csv), fixture.pinnedCTY.runtimeVersion)
        let resolver = try CTYResolver.bundled()
        let date = Date(timeIntervalSince1970: 1_800_000_000)

        for expected in fixture.resolverExpectations {
            let resolved = try XCTUnwrap(resolver.resolve(expected.callsign, at: date), expected.callsign)
            XCTAssertEqual(Endpoint(adif: resolved.adif, entityName: resolved.name,
                                    continent: resolved.continent, cqZone: resolved.cqZone),
                           expected.endpoint, expected.callsign)
        }
        XCTAssertEqual(try XCTUnwrap(resolver.resolve("DL1AAA/MM", at: date)).name,
                       "FED. REP. OF GERMANY")
    }

    private func loadFixture() throws -> Fixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("../XContestCoreTests/SourceFixtures/cqww-2026-country-authority.json")
            .standardizedFileURL
        return try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
    }

    private func fnvVersion(_ value: String) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in value.utf8 { hash = (hash ^ UInt64(byte)) &* 1_099_511_628_211 }
        return String(format: "bundled-cty-fnv64-%016llx", hash)
    }
}
