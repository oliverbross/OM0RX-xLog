import Foundation
import XCTest
@testable import XContestCore

final class ContestCallHistoryProjectionTests: XCTestCase {
    private let wve = ContestEntitySnapshot(adif: 291, name: "United States", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let dx = ContestEntitySnapshot(adif: 230, name: "Federal Republic of Germany", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testExhaustiveRuleMappingsAreTypedBlankOnlyAndRoleSpecific() throws {
        let parser = ContestCallHistoryParser()
        let preview = parser.preview(importing: Data("!!Order!!,Call,Name,State,Power,CqZone,UserText\nK1ABC,Sam,CT,K,05,display only\n".utf8),
                                     provenance: .init(sourceName: "history.txt", importedAtUTC: Date(timeIntervalSince1970: 1)))
        let dataset = try parser.dataset(from: preview, generation: UUID().uuidString.lowercased())
        let row = try XCTUnwrap(dataset.rows.first)

        let cqww = CQWWCWRule(), cqwwSession = session(cqww, own: dx)
        let cqwwDraft = draft(cqww, session: cqwwSession, worked: wve)
        let zone = try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: cqww,
                                                              session: cqwwSession, draft: cqwwDraft)
        XCTAssertEqual(zone.map(\.id), ["legacy-received-zone"])
        XCTAssertEqual(zone.first?.normalizedValue, "05")

        let naqp = NAQPCWRule(), naqpSession = session(naqp, own: wve)
        let naqpDraft = draft(naqp, session: naqpSession, worked: wve)
        XCTAssertEqual(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: naqp,
                                                                  session: naqpSession, draft: naqpDraft).map(\.id),
                       ["received-name", "received-location"])
        let occupied = draft(naqp, session: naqpSession, worked: wve,
                             fields: ["name": .init(raw: "PAT", normalized: "PAT")])
        XCTAssertEqual(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: naqp,
                                                                  session: naqpSession, draft: occupied).map(\.id),
                       ["received-location"])

        let rtty = ARRLRTTYRoundupRule(), rttySession = session(rtty, own: dx)
        XCTAssertEqual(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: rtty,
                                                                  session: rttySession,
                                                                  draft: draft(rtty, session: rttySession, worked: wve)).map(\.id),
                       ["received-location"])
        XCTAssertTrue(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: rtty,
                                                                 session: rttySession,
                                                                 draft: draft(rtty, session: rttySession, worked: dx)).isEmpty)

        let arrlDX = ARRLDXCWRule(), dxSession = session(arrlDX, own: dx), wveSession = session(arrlDX, own: wve)
        XCTAssertEqual(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: arrlDX,
                                                                  session: dxSession,
                                                                  draft: draft(arrlDX, session: dxSession, worked: wve)).map(\.id),
                       ["received-location"])
        let power = try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row, rule: arrlDX,
                                                               session: wveSession,
                                                               draft: draft(arrlDX, session: wveSession, worked: dx))
        XCTAssertEqual(power.map(\.id), ["received-power"])
        XCTAssertEqual(power.first?.rawValue, "K")
        XCTAssertEqual(power.first?.normalizedValue, "1000")
        XCTAssertThrowsError(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: row,
                                                                        rule: JIDXCWRule(), session: dxSession,
                                                                        draft: cqwwDraft))
    }

    func testApplyPreservesUnrelatedIncompleteFieldsAndRejectsUnknownOrOccupiedTargets() throws {
        let parser = ContestCallHistoryParser()
        let dataset = try parser.dataset(from: parser.preview(
            importing: Data("!!Order!!,Call,Name,State\nK1ABC,Sam,CT\n".utf8),
            provenance: .init(sourceName: "history.txt", importedAtUTC: Date(timeIntervalSince1970: 1))),
            generation: UUID().uuidString.lowercased())
        let rule = NAQPCWRule(), liveSession = session(rule, own: wve)
        let liveDraft = draft(rule, session: liveSession, worked: wve)
        let proposals = try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: dataset.rows[0],
                                                                   rule: rule, session: liveSession, draft: liveDraft)
        let applied = try ContestCallHistoryProjector.applying(["received-name"], from: proposals, to: liveDraft,
                                                                rule: rule, session: liveSession, revision: 2,
                                                                updatedAt: Date(timeIntervalSince1970: 2))
        XCTAssertEqual(applied.exchange.receivedFields["name"], .init(raw: "Sam", normalized: "SAM"))
        XCTAssertNil(applied.exchange.receivedFields["location"])
        XCTAssertEqual(applied.callsign, liveDraft.callsign)
        XCTAssertThrowsError(try ContestCallHistoryProjector.applying(["missing"], from: proposals, to: liveDraft,
                                                                       rule: rule, session: liveSession, revision: 2,
                                                                       updatedAt: Date()))
        let occupied = draft(rule, session: liveSession, worked: wve,
                             fields: ["name": .init(raw: "PAT", normalized: "PAT")])
        XCTAssertTrue(try ContestCallHistoryProjector.proposals(headers: dataset.headers, row: dataset.rows[0],
                                                                 rule: rule, session: liveSession, draft: occupied)
            .allSatisfy { $0.id != "received-name" })
    }

    private func session(_ rule: any ContestRule, own: ContestEntitySnapshot) -> ContestSessionSnapshot {
        .init(id: UUID(), workspaceGeneration: UUID(), rule: rule.metadata.identity,
              referenceDataVersion: "fixture", startedAt: Date(timeIntervalSince1970: 1),
              station: .init(callsign: own.adif == 291 ? "W1AW" : "DL1AA", entity: own,
                             sentExchange: "", operatorCallsigns: ["N0CALL"]))
    }

    private func draft(_ rule: any ContestRule, session: ContestSessionSnapshot,
                       worked: ContestEntitySnapshot,
                       fields: [String: ContestExchangeFieldValue] = [:]) -> ContestDraftSnapshot {
        let raw = rule.metadata.entry.exchange.receivedFields.compactMap { fields[$0.id]?.raw }.joined(separator: " ")
        let normalized = rule.metadata.entry.exchange.receivedFields.compactMap { fields[$0.id]?.normalized }.joined(separator: " ")
        return .init(id: UUID(), sessionID: session.id, revision: 1, updatedAt: Date(timeIntervalSince1970: 1),
                     callsign: "K1ABC", band: "20m", mode: rule.metadata.entry.mode,
                     frequencyHz: nil, rstSent: rule.metadata.entry.report.defaultSent,
                     rstReceived: rule.metadata.entry.report.defaultReceived,
                     exchange: .init(rawSent: session.station.sentExchange,
                                     normalizedSent: session.station.sentExchange,
                                     rawReceived: raw, normalizedReceived: normalized,
                                     sentFields: session.station.sentExchangeFields,
                                     receivedFields: fields), entity: worked,
                     operatorCallsign: "N0CALL", stationLocation: "")
    }
}
