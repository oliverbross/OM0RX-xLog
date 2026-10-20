import Foundation
import XCTest
@testable import XContestCore

final class ContestCallsignAssistanceTests: XCTestCase {
    private let context = ContestAssistanceContext(sessionID: "session-a", workspaceGeneration: "generation-a", requestID: "request-a")
    private let provenance = ContestSCPProvenance(sourceID: "fixture-master-scp", version: "7c8b499-oracle",
        sourceURL: "https://www.supercheckpartial.com/downloads/MASTER.SCP", retrievedAtUTC: Date(timeIntervalSince1970: 1_760_745_600))

    private func fixtureData() throws -> Data {
        try Data(contentsOf: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("SourceFixtures/master-scp-focused.txt"))
    }

    func testPinnedRapidFuzzOracleOrderingScoresAndPrefixPenalty() async throws {
        let index = try ContestSCPIndex(importing: fixtureData(), provenance: provenance)
        let result = try await index.matches(query: "k1ab", context: context)
        XCTAssertEqual(result.matches.map(\.callsign), ["K1AB", "K1ABC", "K1ABD", "XK1AB", "N1AB"])
        for (actual, expected) in zip(result.matches.map(\.score), [100, 88.88888888888889, 88.88888888888889, 71, 60]) {
            XCTAssertEqual(actual, expected, accuracy: 0.000_001)
        }
        XCTAssertEqual(result.matches.map(\.isPrefixMatch), [true, true, true, false, false])
        XCTAssertFalse(result.isPartial)
        XCTAssertEqual(result.evaluatedRecordCount, 10)
    }

    func testImportNormalizesDeduplicatesAndComputesVerifiedDigest() throws {
        let data = try fixtureData()
        let index = try ContestSCPIndex(importing: data, provenance: provenance,
            expectedSHA256: "6510d5f2076e8bec2e268290a24a5f6d963a2d6d30a4701e8dd667394b383855")
        XCTAssertEqual(index.dataset.recordCount, 10)
        XCTAssertEqual(index.dataset.duplicateCount, 1)
        XCTAssertEqual(index.dataset.byteCount, data.count)
        XCTAssertEqual(index.dataset.digestVerification, .matchedExpectedSHA256)
    }

    func testImportRejectsMalformedOversizedAndMismatchedData() throws {
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data([0xff]), provenance: provenance)) { XCTAssertEqual($0 as? ContestSCPError, .invalidUTF8) }
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data("K1ABC\nBAD CALL\n".utf8), provenance: provenance)) { XCTAssertEqual($0 as? ContestSCPError, .invalidRecord(line: 2)) }
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data("K1ABC\nß1\n".utf8), provenance: provenance)) { XCTAssertEqual($0 as? ContestSCPError, .invalidRecord(line: 2)) }
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data("K1ABC\nN1ABC\n".utf8), provenance: provenance,
            limits: .init(maximumBytes: 128, maximumRecords: 1, maximumLineBytes: 32))) { XCTAssertEqual($0 as? ContestSCPError, .tooManyRecords) }
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data("K1ABC\n".utf8), provenance: provenance, expectedSHA256: String(repeating: "0", count: 64))) {
            XCTAssertEqual($0 as? ContestSCPError, .digestMismatch)
        }
    }

    func testImportTraversesNewlinesIncrementallyAndBoundsRawLinesBeforeTrimming() throws {
        let accepted = Data([0xef, 0xbb, 0xbf] + Array("!!Order,1,1\r\n# note\r\n K1ABC \r\n\r\nN1ABC".utf8))
        let index = try ContestSCPIndex(importing: accepted, provenance: provenance,
            limits: .init(maximumBytes: 256, maximumRecords: 10, maximumLineBytes: 16))
        XCTAssertEqual(index.dataset.recordCount, 2)
        for raw in ["#" + String(repeating: "x", count: 16), String(repeating: " ", count: 17)] {
            XCTAssertThrowsError(try ContestSCPIndex(importing: Data((raw + "\nK1ABC").utf8), provenance: provenance,
                limits: .init(maximumBytes: 256, maximumRecords: 10, maximumLineBytes: 16))) {
                XCTAssertEqual($0 as? ContestSCPError, .invalidRecord(line: 1))
            }
        }
    }

    func testProvenanceRejectsNonfiniteRetrievalDate() {
        let invalid = ContestSCPProvenance(sourceID: "fixture", version: "1", retrievedAtUTC: Date(timeIntervalSinceReferenceDate: .infinity))
        XCTAssertThrowsError(try ContestSCPIndex(importing: Data("K1ABC\n".utf8), provenance: invalid)) {
            XCTAssertEqual($0 as? ContestSCPError, .invalidProvenance)
        }
    }

    func testQueryLimitsAndPartialResultsAreExplicit() async throws {
        let index = try ContestSCPIndex(importing: fixtureData(), provenance: provenance)
        let partial = try await index.matches(query: "K1", context: context,
            options: .init(limit: 2, maximumEvaluations: 3))
        XCTAssertTrue(partial.isPartial)
        XCTAssertEqual(partial.evaluatedRecordCount, 3)
        XCTAssertEqual(partial.matches.map(\.callsign), ["K1AB"])
        await XCTAssertThrowsErrorAsync(try await index.matches(query: "K", context: context)) { XCTAssertEqual($0 as? ContestSCPError, .invalidQuery) }
        await XCTAssertThrowsErrorAsync(try await index.matches(query: "ß1", context: context)) { XCTAssertEqual($0 as? ContestSCPError, .invalidQuery) }
        await XCTAssertThrowsErrorAsync(try await index.matches(query: "K1", context: context, options: .init(limit: 21))) { XCTAssertEqual($0 as? ContestSCPError, .invalidOptions) }
    }

    func testSelectionRequiresExactContextAndMembershipAndReturnsOnlyCallsign() async throws {
        let index = try ContestSCPIndex(importing: fixtureData(), provenance: provenance)
        let result = try await index.matches(query: "K1AB", context: context)
        let first = try XCTUnwrap(result.matches.first)
        XCTAssertEqual(try index.selectedCallsign(matchID: first.matchID, from: result, expectedContext: context), "K1AB")
        XCTAssertThrowsError(try index.selectedCallsign(matchID: first.matchID, from: result,
            expectedContext: .init(sessionID: context.sessionID, workspaceGeneration: context.workspaceGeneration, requestID: "request-b"))) {
            XCTAssertEqual($0 as? ContestSCPError, .staleContext)
        }
        XCTAssertThrowsError(try index.selectedCallsign(matchID: "invented", from: result, expectedContext: context)) {
            XCTAssertEqual($0 as? ContestSCPError, .unknownMatch)
        }
    }

    func testSelectionRejectsTamperedAndCrossDatasetResults() async throws {
        let index = try ContestSCPIndex(importing: fixtureData(), provenance: provenance)
        let result = try await index.matches(query: "K1AB", context: context)
        let first = try XCTUnwrap(result.matches.first)
        let tampered = ContestSCPQueryResult(context: result.context, normalizedQuery: result.normalizedQuery,
            matches: [ContestSCPMatch(matchID: first.matchID, callsign: "ATTACKER", score: first.score, isPrefixMatch: first.isPrefixMatch)],
            dataset: result.dataset, evaluatedRecordCount: result.evaluatedRecordCount, isPartial: result.isPartial)
        XCTAssertThrowsError(try index.selectedCallsign(matchID: first.matchID, from: tampered, expectedContext: context)) {
            XCTAssertEqual($0 as? ContestSCPError, .unknownMatch)
        }
        let other = try ContestSCPIndex(importing: fixtureData(), provenance: .init(sourceID: "other-source", version: "1"))
        XCTAssertThrowsError(try other.selectedCallsign(matchID: first.matchID, from: result, expectedContext: context)) {
            XCTAssertEqual($0 as? ContestSCPError, .staleContext)
        }
    }

    func testCancellationStopsLargeCatalogSearch() async throws {
        let data = Data((0..<100_000).map { String(format: "K%05dX\n", $0) }.joined().utf8)
        let index = try ContestSCPIndex(importing: data, provenance: provenance)
        let task = Task { try await index.matches(query: "K999", context: context) }
        task.cancel()
        do { _ = try await task.value; XCTFail("cancelled search completed") }
        catch is CancellationError { }
    }

    func testFullBoundedHundredThousandRecordCatalogIsDeterministic() async throws {
        let data = Data((0..<100_000).map { String(format: "K%05dX\n", $0) }.joined().utf8)
        let index = try ContestSCPIndex(importing: data, provenance: provenance)
        let first = try await index.matches(query: "K54321", context: context)
        let second = try await index.matches(query: "K54321", context: context)
        XCTAssertEqual(first, second)
        XCTAssertEqual(first.evaluatedRecordCount, 100_000)
        XCTAssertFalse(first.isPartial)
        XCTAssertEqual(first.matches.first?.callsign, "K54321X")
    }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T,
                                          _ handler: (Error) -> Void = { _ in }) async {
    do { _ = try await expression(); XCTFail("Expected error") } catch { handler(error) }
}
