import Foundation
import XCTest
@testable import XContestCore

final class ContestJIDXExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "E5000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "E6000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_300_000)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let japan = ContestEntitySnapshot(adif: 339, name: "JAPAN", countryPrefix: "JA", continent: "AS", cqZone: 25)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testCWAndPhoneCabrillo20GoldensUseNormalizedNumbersAndOfficialTokens() throws {
        let fixture = try loadFixture()

        let cw = JIDXCWRule()
        let dx = session(rule: cw, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let dxInput = input(rule: cw, session: dx, band: "20M", power: "LOW", qsos: [
            qso(2, rule: cw, session: dx, call: "JA2BBB", band: "10m", frequency: 28_025_501,
                entity: japan, receivedRaw: "20", receivedNormalized: "20"),
            qso(1, rule: cw, session: dx, call: "JA1AAA", band: "20m", frequency: 14_025_500,
                entity: japan, receivedRaw: "3", receivedNormalized: "03"),
        ])
        XCTAssertEqual(try CabrilloExporter.document(input: dxInput, rule: cw, createdBy: "OM0RX-xLog TEST"),
                       fixture.dxCWLines.joined(separator: "\r\n") + "\r\n")

        let phone = JIDXSSBRule()
        let ja = session(rule: phone, call: "JA1ZZZ", entity: japan, raw: "3", normalized: "03")
        let jaInput = input(rule: phone, session: ja, band: "ALL", power: "HIGH", qsos: [
            qso(3, rule: phone, session: ja, call: "K1AAA", band: "20m", frequency: 14_250_501,
                entity: usa, receivedRaw: "5", receivedNormalized: "05"),
        ])
        XCTAssertEqual(try CabrilloExporter.document(input: jaInput, rule: phone, createdBy: "OM0RX-xLog TEST"),
                       fixture.jaPhoneLines.joined(separator: "\r\n") + "\r\n")
    }

    func testSingleBandProjectionRetainsCompleteValidLogAndRecomputesClaim() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let qsos = [
            qso(10, rule: rule, session: station, call: "JA1AAA", band: "20m", frequency: 14_025_000,
                entity: japan, receivedRaw: "3", receivedNormalized: "03"),
            qso(11, rule: rule, session: station, call: "JA2BBB", band: "10m", frequency: 28_025_000,
                entity: japan, receivedRaw: "20", receivedNormalized: "20"),
        ]
        let document = try CabrilloExporter.document(input: input(rule: rule, session: station,
                                                                   band: "20M", power: "LOW", qsos: qsos),
                                                     rule: rule)
        XCTAssertTrue(document.contains("CATEGORY: 14L\r\n"))
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 1\r\n"))
        XCTAssertEqual(document.components(separatedBy: "QSO: ").count - 1, 2)
    }

    func testMaritimeMobileAndUnsupportedCategoriesFailOrRenderExplicitly() throws {
        let rule = JIDXCWRule()
        let fixture = try loadFixture()
        let maritime = session(rule: rule, call: "K1AAA/MM", entity: usa, raw: "25", normalized: "25")
        let valid = qso(20, rule: rule, session: maritime, call: "JA1AAA", band: "20m",
                        frequency: 14_025_000, entity: japan, receivedRaw: "10", receivedNormalized: "10")
        let document = try CabrilloExporter.document(input: input(rule: rule, session: maritime,
                                                                   band: "ALL", power: "LOW", qsos: [valid]),
                                                     rule: rule)
        XCTAssertEqual(document, fixture.mmCWLines.joined(separator: "\r\n") + "\r\n")

        let entityless = session(rule: rule, call: "K1AAA/MM", entity: nil, raw: "25", normalized: "25")
        let entitylessQSO = qso(21, rule: rule, session: entityless, call: "JA1AAA", band: "20m",
                                frequency: 14_025_000, entity: japan,
                                receivedRaw: "10", receivedNormalized: "10")
        let entitylessDocument = try CabrilloExporter.document(
            input: input(rule: rule, session: entityless, band: "ALL", power: "LOW", qsos: [entitylessQSO]),
            rule: rule)
        XCTAssertEqual(entitylessDocument, document)

        for (operatorCategory, transmitter, band, power) in [
            ("MULTI-OP", "ONE", "ALL", "HIGH"),
            ("SINGLE-OP", "TWO", "ALL", "HIGH"),
            ("SINGLE-OP", "ONE", "ALL", "QRP"),
        ] {
            XCTAssertThrowsError(try CabrilloExporter.document(
                input: input(rule: rule, session: maritime, band: band, power: power, qsos: [valid],
                             operatorCategory: operatorCategory, transmitter: transmitter), rule: rule))
        }
    }

    func testMalformedFieldsMetadataAndSemanticQSOsFailClosed() throws {
        let rule = JIDXCWRule()
        let station = session(rule: rule, call: "OM0RX", entity: slovakia, raw: "15", normalized: "15")
        let valid = qso(30, rule: rule, session: station, call: "JA1AAA", band: "20m",
                        frequency: 14_025_000, entity: japan, receivedRaw: "3", receivedNormalized: "03")
        let malformed = copy(valid, exchange: .init(rawSent: "15", normalizedSent: "15",
                                                    rawReceived: "3", normalizedReceived: "03",
                                                    sentFields: valid.exchange.sentFields,
                                                    receivedFields: ["number": .init(raw: "3", normalized: "3")]))
        XCTAssertThrowsError(try CabrilloExporter.document(
            input: input(rule: rule, session: station, band: "ALL", power: "HIGH", qsos: [malformed]), rule: rule))
        XCTAssertThrowsError(try CabrilloExporter.document(
            input: input(rule: rule, session: station, band: "ALL", power: "HIGH", qsos: [valid],
                         formatterVersion: "pilot-1"), rule: rule))
    }

    func testMissingStationEntityCapabilityIsJIDXMaritimeOnly() throws {
        let originalRules: [any ContestRule] = [
            CQWWCWRule(), CQWPXCWRule(), CQWWSSBRule(), CQWPXSSBRule(),
            SACCWRule(), SACSSBRule(), OceaniaDXCWRule(), OceaniaDXSSBRule(),
            NAQPCWRule(), NAQPSSBRule(), NAQPRTTYRule(), ARRLRTTYRoundupRule(),
        ]
        for rule in originalRules {
            XCTAssertFalse(rule is any ContestRuleStationEntityPolicy, rule.metadata.identity.id)
        }

        for rule in [JIDXCWRule() as any ContestRule, JIDXSSBRule() as any ContestRule] {
            let policy = try XCTUnwrap(rule as? any ContestRuleStationEntityPolicy)
            let land = session(rule: rule, call: "OM0RX", entity: nil, raw: "15", normalized: "15")
            let maritime = session(rule: rule, call: "K1AAA/MM", entity: nil, raw: "5", normalized: "05")
            XCTAssertFalse(policy.allowsMissingStationEntity(in: land))
            XCTAssertTrue(policy.allowsMissingStationEntity(in: maritime))
        }
    }

    private func session(rule: any ContestRule, call: String, entity: ContestEntitySnapshot?,
                         raw: String, normalized: String) -> ContestSessionSnapshot {
        .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
              referenceDataVersion: "jidx-fixture", startedAt: date,
              station: .init(callsign: call, entity: entity, sentExchange: normalized,
                             operatorCallsigns: [call], location: "fixture",
                             sentExchangeFields: ["number": .init(raw: raw, normalized: normalized)]))
    }

    private func qso(_ number: Int, rule: any ContestRule, session: ContestSessionSnapshot,
                     call: String, band: String, frequency: Int64, entity: ContestEntitySnapshot?,
                     receivedRaw: String, receivedNormalized: String) -> ContestQSO {
        let sent = session.station.sentExchangeFields["number"]!
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: UUID(uuidString: String(format: "E7000000-0000-0000-0000-%012d", number))!,
                     sessionID: session.id, timestampUTC: date.addingTimeInterval(Double(number)),
                     callsign: call, band: band, mode: rule.metadata.entry.mode, frequencyHz: frequency,
                     rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: sent.raw, normalizedSent: sent.normalized,
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: ["number": sent],
                                     receivedFields: ["number": .init(raw: receivedRaw,
                                                                      normalized: receivedNormalized)]),
                     entity: entity, operatorCallsign: session.station.callsign,
                     stationLocation: session.station.location, provenance: .init(source: .operatorEntry))
    }

    private func input(rule: any ContestRule, session: ContestSessionSnapshot, band: String, power: String,
                       qsos: [ContestQSO], operatorCategory: String = "SINGLE-OP",
                       transmitter: String = "ONE",
                       formatterVersion: String = ContestExportInput.jidxPreviewFormatterVersion) -> ContestExportInput {
        let header = CabrilloHeader(callsign: session.station.callsign,
                                    categoryOperator: operatorCategory, categoryAssisted: "NON-ASSISTED",
                                    categoryBand: band, categoryMode: rule.metadata.entry.mode,
                                    categoryTransmitter: transmitter, categoryPower: power,
                                    operators: [session.station.callsign], location: "DX", name: "Operator",
                                    addressLines: ["Test Address"], email: "operator@example.test")
        return .init(formatterVersion: formatterVersion, generatedAtUTC: date.addingTimeInterval(300),
                     sessionRevision: 4, session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "JIDX preview", operatorCallsign: session.station.callsign,
                                     operatorCategory: operatorCategory, cabrilloHeader: header), qsos: qsos)
    }

    private func copy(_ qso: ContestQSO, exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived, exchange: exchange,
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func loadFixture() throws -> GoldenFixture {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports/jidx-preview-1.json")
        return try JSONDecoder().decode(GoldenFixture.self, from: Data(contentsOf: url))
    }
    private struct GoldenFixture: Decodable {
        let dxCWLines: [String]
        let jaPhoneLines: [String]
        let mmCWLines: [String]
    }
}
