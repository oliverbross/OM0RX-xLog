import Foundation
import XCTest
@testable import XContestCore

final class ContestCallHistoryTests: XCTestCase {
    private let provenance = ContestCallHistoryProvenance(
        sourceName: "history.txt", importedAtUTC: Date(timeIntervalSince1970: 1_760_000_000))

    func testPreservesAllKnownAndUnknownHeadersSourceBytesAndLogicalTrailingEmpties() throws {
        let names = ["Call", "Name", "Loc1", "Loc2", "Sect", "State", "CK", "BirthDate", "Exch1",
                     "Misc", "Power", "CqZone", "ITUZone", "UserText", "LastUpdateNote", "Exchange1", "County", "X-Å"]
        let text = "!!Order!!," + names.joined(separator: ",") + ",\r\nk1abc,Sam\r\n"
        let bytes = Data([0xef, 0xbb, 0xbf] + Array(text.utf8))
        let preview = ContestCallHistoryParser().preview(importing: bytes, provenance: provenance)
        XCTAssertTrue(preview.isCommittable)
        XCTAssertEqual(preview.sourceBytes, bytes)
        XCTAssertEqual(preview.sha256, "2b8b2c761bcc5947ebdb7902233916b49965de4f0a11f1cd2dd61c5c4b5f4835")
        XCTAssertEqual(preview.headers.map(\.originalName), names)
        XCTAssertEqual(Set(preview.headers.compactMap(\.knownKey)), Set(ContestCallHistoryKnownKey.allCases))
        XCTAssertNil(preview.headers.last?.knownKey)
        XCTAssertEqual(preview.rows.count, 1)
        XCTAssertEqual(preview.rows[0].values, ["k1abc", "Sam"])
        XCTAssertEqual(preview.rows[0].normalizedCallsign, "K1ABC")
        let dataset = try ContestCallHistoryParser().dataset(from: preview, generation: "generation-a")
        XCTAssertEqual(dataset.value(in: preview.rows[0], for: .name), "Sam")
        XCTAssertEqual(dataset.value(in: preview.rows[0], for: .county), "")
        XCTAssertEqual(dataset.value(in: preview.rows[0], for: .exch1), "")
        XCTAssertEqual(dataset.value(in: preview.rows[0], for: .exchange1), "")
    }

    func testCaseCanonicalizationCorrectsCQZoneButDoesNotAliasExchangeKeys() {
        let valid = preview("!!Order!!,Call,CQZone,Exch1,Exchange1\nK1ABC,5,A,B\n")
        XCTAssertTrue(valid.isCommittable)
        XCTAssertEqual(valid.headers.map(\.canonicalName), ["call", "cqzone", "exch1", "exchange1"])
        XCTAssertEqual(valid.headers.map(\.knownKey), [.call, .cqZone, .exch1, .exchange1])

        let duplicate = preview("!!Order!!,Call,CqZone,CQZone\nK1ABC,5,6\n")
        XCTAssertFalse(duplicate.isCommittable)
        XCTAssertTrue(duplicate.diagnostics.contains { $0.code == .duplicateHeader })
    }

    func testInvalidCallsAreRetainedUnindexableBeforeTrimAndDuplicatesStayInSourceOrder() throws {
        let nbsp = "\u{00a0}"
        let value = "!!Order!!,Call,UserText\nK1ABC,first\n k1abc ,second\n,blank\n\(nbsp)N1XYZ\(nbsp),unicode-space\nBAD CALL,invalid\n"
        let preview = self.preview(value)
        XCTAssertTrue(preview.isCommittable)
        XCTAssertTrue(preview.requiresAdvisoryConfirmation)
        XCTAssertEqual(preview.rows.count, 5)
        XCTAssertEqual(preview.rows.map(\.normalizedCallsign), ["K1ABC", "K1ABC", nil, nil, nil])
        XCTAssertEqual(preview.rows.map(\.indexingIssue), [nil, nil, .blankCall, .invalidCall, .invalidCall])
        XCTAssertEqual(preview.duplicateCallCount, 1)
        XCTAssertEqual(preview.rows.map(\.sourceOrdinal), [0, 1, 2, 3, 4])
        let dataset = try ContestCallHistoryParser().dataset(from: preview, generation: "generation-a")
        let result = try dataset.exactMatches(callsign: "k1abc", context: context(inputCallsign: " K1ABC "))
        XCTAssertEqual(result.records.map(\.sourceOrdinal), [0, 1])
        XCTAssertEqual(result.records.map { dataset.value(in: $0, for: .userText) }, ["first", "second"])
    }

    func testStrictEncodingMarkersHeadersRowsAndBoundsProduceTransparentDiagnostics() {
        let invalidUTF8 = ContestCallHistoryParser().preview(importing: Data([0xff]), provenance: provenance)
        XCTAssertEqual(invalidUTF8.diagnostics.map(\.code), [.invalidUTF8])
        for data in [
            "Call,Name\nK1ABC,A\n",
            "!!Order!!,Name\nA\n",
            "!!Order!!,Call,call\nK1ABC,K1ABC\n",
            "!!Order!!,Call,,Name\nK1ABC,,A\n",
            "!!Order!!,Call, Bad\nK1ABC,A\n",
            "!!Order!!,Call,\(String(repeating: "X", count: 65))\nK1ABC,A\n",
            "!!Order!!,Call,Name\nK1ABC,A,EXTRA\n",
        ] {
            XCTAssertFalse(preview(data).isCommittable, data)
        }
        let noCalls = preview("!!Order!!,Call\n\nBAD CALL\n")
        XCTAssertTrue(noCalls.diagnostics.contains { $0.code == .noIndexableCalls })
        XCTAssertEqual(noCalls.rows.count, 1)
        XCTAssertEqual(noCalls.rows[0].values, ["BAD CALL"])

        let longLine = preview("!!Order!!,Call\nK1ABC\n", limits: .init(maximumBytes: 128, maximumRecords: 10,
            maximumLineBytes: 8, maximumHeaders: 4, maximumHeaderBytes: 16, maximumValueBytes: 8))
        XCTAssertTrue(longLine.diagnostics.contains { $0.code == .lineTooLong })
        let longValue = preview("!!Order!!,Call,Note\nK1ABC,12345\n", limits: .init(maximumBytes: 128, maximumRecords: 10,
            maximumLineBytes: 64, maximumHeaders: 4, maximumHeaderBytes: 16, maximumValueBytes: 4))
        XCTAssertTrue(longValue.diagnostics.contains { $0.code == .valueTooLong })
        let tooMany = preview("!!Order!!,Call\nK1ABC\nN1ABC\n", limits: .init(maximumBytes: 128, maximumRecords: 1,
            maximumLineBytes: 64, maximumHeaders: 4, maximumHeaderBytes: 16, maximumValueBytes: 16))
        XCTAssertTrue(tooMany.diagnostics.contains { $0.code == .tooManyRecords })
        let tooManyHeaders = preview("!!Order!!,Call,A,B\nK1ABC,1,2\n", limits: .init(maximumBytes: 128, maximumRecords: 10,
            maximumLineBytes: 64, maximumHeaders: 2, maximumHeaderBytes: 16, maximumValueBytes: 16))
        XCTAssertTrue(tooManyHeaders.diagnostics.contains { $0.code == .tooManyHeaders })
        XCTAssertTrue(tooManyHeaders.headers.isEmpty)
        XCTAssertTrue(tooManyHeaders.rows.isEmpty)
        let oversized = ContestCallHistoryParser().preview(importing: Data(repeating: 65, count: 17), provenance: provenance,
            limits: .init(maximumBytes: 16, maximumRecords: 10, maximumLineBytes: 16,
                          maximumHeaders: 4, maximumHeaderBytes: 16, maximumValueBytes: 16))
        XCTAssertTrue(oversized.diagnostics.contains { $0.code == .datasetTooLarge })
        XCTAssertTrue(oversized.sourceBytes.isEmpty)
        XCTAssertFalse(oversized.sha256.isEmpty)
    }

    func testAbsoluteByteCeilingPrecedesHashLimitsAndProvenanceValidation() {
        let invalidProvenance = ContestCallHistoryProvenance(
            sourceName: "../invalid", importedAtUTC: Date(timeIntervalSince1970: .infinity))
        let invalidLimits = ContestCallHistoryLimits(maximumBytes: 0, maximumRecords: 0,
            maximumLineBytes: 0, maximumHeaders: 0, maximumHeaderBytes: 0, maximumValueBytes: 0)
        let oversized = Data(repeating: 0x41, count: 16 * 1_024 * 1_024 + 1)
        let rejected = ContestCallHistoryParser().preview(
            importing: oversized, provenance: invalidProvenance, limits: invalidLimits)
        XCTAssertEqual(rejected.diagnostics.map(\.code), [.datasetTooLarge])
        XCTAssertTrue(rejected.sourceBytes.isEmpty)
        XCTAssertEqual(rejected.sha256, "")

        let bounded = Data("abc".utf8)
        let badLimits = ContestCallHistoryParser().preview(
            importing: bounded, provenance: provenance, limits: invalidLimits)
        XCTAssertEqual(badLimits.diagnostics.map(\.code), [.invalidLimits])
        XCTAssertEqual(badLimits.sourceBytes, bounded)
        XCTAssertEqual(badLimits.sha256, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        let badProvenance = ContestCallHistoryParser().preview(
            importing: bounded, provenance: invalidProvenance)
        XCTAssertEqual(badProvenance.diagnostics.map(\.code), [.invalidProvenance])
        XCTAssertEqual(badProvenance.sourceBytes, bounded)
        XCTAssertEqual(badProvenance.sha256, badLimits.sha256)
    }

    func testLiteralCommaFormatCommentsAndShortRowsAreDeterministic() throws {
        let data = "preamble\n# !!Order!!,Call\n!!Order!!,Call,X#Note\n!!Order!!,Call,UserText\n#comment\nK1ABC,\"quoted\"\nN1ABC\n #not-comment\n"
        let preview = self.preview(data)
        XCTAssertTrue(preview.isCommittable)
        XCTAssertEqual(preview.rows.map(\.values), [["K1ABC", "\"quoted\""], ["N1ABC"], [" #not-comment"]])
        XCTAssertEqual(preview.rows.last?.indexingIssue, .invalidCall)
        let dataset = try ContestCallHistoryParser().dataset(from: preview, generation: "generation-a")
        XCTAssertEqual(dataset.value(in: preview.rows[1], for: .userText), "")
    }

    func testDefaultBoundsStopBeforeMaterializingOverwideHeadersOrRows() {
        let overwideHeader = "!!Order!!," + (["Call"] + (1...128).map { "X\($0)" }).joined(separator: ",") + "\nK1ABC\n"
        let headerPreview = preview(overwideHeader)
        XCTAssertEqual(headerPreview.diagnostics.map(\.code), [.tooManyHeaders])
        XCTAssertTrue(headerPreview.headers.isEmpty)
        XCTAssertTrue(headerPreview.rows.isEmpty)

        let overlongRow = "!!Order!!,Call\n" + String(repeating: "A", count: 16 * 1_024 + 1) + "\nK1ABC\n"
        let rowPreview = preview(overlongRow)
        XCTAssertEqual(rowPreview.diagnostics.map(\.code), [.lineTooLong])
        XCTAssertEqual(rowPreview.headers.map(\.canonicalName), ["call"])
        XCTAssertTrue(rowPreview.rows.isEmpty)

        let excessCells = "!!Order!!,Call\n" + String(repeating: ",", count: 8_000) + "\nK1ABC\n"
        let cellsPreview = preview(excessCells)
        XCTAssertEqual(cellsPreview.diagnostics.map(\.code), [.extraValues])
        XCTAssertTrue(cellsPreview.rows.isEmpty)
    }

    func testSelectionRejectsChangedContextTamperingAndCrossDatasetGeneration() throws {
        let parser = ContestCallHistoryParser()
        let preview = self.preview("!!Order!!,Call,Name\nK1ABC,A\nK1ABC,B\n")
        let first = try parser.dataset(from: preview, generation: "generation-a")
        let context = context(inputCallsign: "K1ABC")
        let result = try first.exactMatches(callsign: "K1ABC", context: context)
        let selected = try first.selectedRecord(recordID: result.records[1].recordID, from: result, expectedContext: context)
        XCTAssertEqual(selected.sourceOrdinal, 1)

        let changed = ContestCallHistorySelectionContext(sessionID: context.sessionID,
            workspaceGeneration: context.workspaceGeneration, sessionRevision: context.sessionRevision,
            draftID: context.draftID, draftRevision: context.draftRevision + 1, inputCallsign: context.inputCallsign,
            requestID: context.requestID, ruleIdentity: context.ruleIdentity,
            referenceDataVersion: context.referenceDataVersion)
        XCTAssertThrowsError(try first.selectedRecord(recordID: selected.recordID, from: result, expectedContext: changed)) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .staleContext)
        }
        let tamperedRow = ContestCallHistoryRow(recordID: selected.recordID, sourceOrdinal: selected.sourceOrdinal,
            sourceLine: selected.sourceLine, values: ["K1ABC", "ATTACKER"], normalizedCallsign: "K1ABC", indexingIssue: nil)
        let tampered = ContestCallHistoryQueryResult(context: context, normalizedCallsign: "K1ABC",
            records: [tamperedRow], dataset: result.dataset)
        XCTAssertThrowsError(try first.selectedRecord(recordID: selected.recordID, from: tampered, expectedContext: context)) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .unknownRecord)
        }
        let crossedContext = self.context(inputCallsign: "N1XYZ")
        let crossed = ContestCallHistoryQueryResult(context: crossedContext, normalizedCallsign: "K1ABC",
            records: result.records, dataset: result.dataset)
        XCTAssertThrowsError(try first.selectedRecord(recordID: selected.recordID, from: crossed, expectedContext: crossedContext)) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .staleContext)
        }
        let other = try parser.dataset(from: preview, generation: "generation-b")
        XCTAssertThrowsError(try other.selectedRecord(recordID: selected.recordID, from: result, expectedContext: context)) {
            XCTAssertEqual($0 as? ContestCallHistoryError, .staleContext)
        }
    }

    func testHundredThousandRowsWith128HeadersUseCompactPhysicalValuesAndExactLookup() throws {
        let headers = ["Call"] + (1..<128).map { "X\($0)" }
        var text = "!!Order!!," + headers.joined(separator: ",") + "\n"
        text.reserveCapacity(800_000)
        for index in 0..<100_000 { text += String(format: "K%05d\n", index) }
        let preview = self.preview(text)
        XCTAssertTrue(preview.isCommittable)
        XCTAssertEqual(preview.rows.count, 100_000)
        XCTAssertEqual(preview.rows.reduce(0) { $0 + $1.values.count }, 100_000)
        let dataset = try ContestCallHistoryParser().dataset(from: preview, generation: "generation-large")
        let result = try dataset.exactMatches(callsign: "K54321", context: context(inputCallsign: "K54321"))
        XCTAssertEqual(result.records.count, 1)
        XCTAssertEqual(result.records[0].sourceOrdinal, 54_321)
        XCTAssertEqual(dataset.value(in: result.records[0], for: .call), "K54321")
    }

    func testMillionIgnoredPhysicalLinesAreParsedIncrementallyWithinTheSourceBound() {
        let ignoredLinePairs = 500_000
        var bytes = Data("!!Order!!,Call\n".utf8)
        bytes.reserveCapacity(bytes.count + ignoredLinePairs * 3 + 7)
        for _ in 0..<ignoredLinePairs {
            bytes.append(contentsOf: [0x23, 0x0a, 0x0a])
        }
        bytes.append(contentsOf: Data("K1ABC\n".utf8))

        let clock = ContinuousClock()
        let started = clock.now
        let preview = ContestCallHistoryParser().preview(importing: bytes, provenance: provenance)
        let elapsed = started.duration(to: clock.now)

        XCTAssertTrue(preview.isCommittable)
        XCTAssertEqual(preview.rows.count, 1)
        XCTAssertEqual(preview.rows[0].sourceLine, 1_000_002)
        XCTAssertLessThan(elapsed, .seconds(30), "Incremental scan took \(elapsed)")
    }

    private func preview(_ string: String, limits: ContestCallHistoryLimits = .init()) -> ContestCallHistoryPreview {
        ContestCallHistoryParser().preview(importing: Data(string.utf8), provenance: provenance, limits: limits)
    }

    private func context(inputCallsign: String) -> ContestCallHistorySelectionContext {
        .init(sessionID: "session-a", workspaceGeneration: "workspace-a", sessionRevision: 7,
              draftID: "draft-a", draftRevision: 3, inputCallsign: inputCallsign, requestID: "request-a",
              ruleIdentity: .init(id: "cq-ww-cw", version: "2026.1", edition: "2026", sourceRevision: "fixture"),
              referenceDataVersion: "cty-fixture")
    }
}
