import Foundation
import XCTest
@testable import XContestCore

final class ContestARRLDXExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "D1000000-0000-0000-8000-000000000001")!
    private let generation = UUID(uuidString: "D2000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testCWAndPhoneGoldensPreserveRawPowerAbbreviations() throws {
        struct Fixture: Decodable {
            let cwFormatterVersion: String
            let ssbFormatterVersion: String
            let cwLines: [String]
            let ssbLines: [String]
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/Exports/arrl-dx-preview-1.json")
        let fixture = try JSONDecoder().decode(Fixture.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.cwFormatterVersion, ContestExportInput.arrlDXCWPreviewFormatterVersion)
        XCTAssertEqual(fixture.ssbFormatterVersion, ContestExportInput.arrlDXSSBPreviewFormatterVersion)

        let cw = ARRLDXCWRule()
        let wve = session(rule: cw, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
        let cwQSO = qso(1, rule: cw, session: wve, call: "DL1AAA", entity: germany,
                        receivedRaw: "1KW", receivedNormalized: "1000", frequency: 14_025_000)
        XCTAssertEqual(try CabrilloExporter.document(input: input(rule: cw, session: wve, qsos: [cwQSO]),
                                                      rule: cw, createdBy: "OM0RX-xLog TEST"),
                       fixture.cwLines.joined(separator: "\r\n") + "\r\n")

        let phone = ARRLDXSSBRule()
        let dx = session(rule: phone, call: "OM0RX", entity: germany, raw: "K", normalized: "1000", location: "DX")
        let ssbQSO = qso(2, rule: phone, session: dx, call: "K1BBB", entity: usa,
                         receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_250_000)
        XCTAssertEqual(try CabrilloExporter.document(input: input(rule: phone, session: dx, qsos: [ssbQSO]),
                                                      rule: phone, createdBy: "OM0RX-xLog TEST"),
                       fixture.ssbLines.joined(separator: "\r\n") + "\r\n")
    }

    func testSingleBandProjectionRetainsCompleteLogIncludingDupe() throws {
        let rule = ARRLDXCWRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
        let twenty = qso(10, rule: rule, session: own, call: "DL1AAA", entity: germany,
                         receivedRaw: "ATT", receivedNormalized: "100", frequency: 14_025_000)
        let duplicate = qso(11, rule: rule, session: own, call: "DL1AAA", entity: germany,
                            receivedRaw: "100W", receivedNormalized: "100", frequency: 14_026_000)
        let forty = qso(12, rule: rule, session: own, call: "DL1AAA", entity: germany,
                        receivedRaw: "100", receivedNormalized: "100", frequency: 7_025_000)
        let all = input(rule: rule, session: own, qsos: [forty, duplicate, twenty])
        XCTAssertEqual(try all.validatedScore(rule: rule).claimedScore, 12)

        let single = input(rule: rule, session: own, qsos: [forty, duplicate, twenty], categoryBand: "20M")
        XCTAssertEqual(try single.validatedScore(rule: rule).claimedScore, 3)
        let document = try CabrilloExporter.document(input: single, rule: rule)
        XCTAssertEqual(document.components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }.count, 3)
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 3\r\n"))
        XCTAssertTrue(document.contains(" ATT   "))
        XCTAssertTrue(document.contains(" 100W  "))
    }

    func testValidOverWidthRawPowerUsesCanonicalCabrilloValueWithoutTruncation() throws {
        let rule = ARRLDXCWRule()
        let wve = session(rule: rule, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
        let received = qso(13, rule: rule, session: wve, call: "DL1AAA", entity: germany,
                           receivedRaw: "100WATTS", receivedNormalized: "100", frequency: 14_025_000)
        let receivedLine = try CabrilloExporter.qsoLine(received, session: wve, rule: rule)
        XCTAssertTrue(receivedLine.hasSuffix(" 599 100   "))
        XCTAssertFalse(receivedLine.contains("100WATTS"))

        let dx = session(rule: rule, call: "DL1DX", entity: germany,
                         raw: "001500W", normalized: "1500", location: "DX")
        let sent = qso(14, rule: rule, session: dx, call: "K1AAA", entity: usa,
                       receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_025_000)
        let sentLine = try CabrilloExporter.qsoLine(sent, session: dx, rule: rule)
        XCTAssertTrue(sentLine.contains(" 599 1500   K1AAA"))
        XCTAssertFalse(sentLine.contains("001500W"))
        XCTAssertEqual(sent.exchange.rawSent, "001500W")
        XCTAssertEqual(received.exchange.rawReceived, "100WATTS")
    }

    func testLocationUsesARRLSectionPolicyIndependentOfDXScoringSide() throws {
        let rule = ARRLDXCWRule()
        let endpoints: [(ContestEntitySnapshot, String, String)] = [
            (.init(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1), "KL7AAA", "AK"),
            (.init(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31), "KH6AAA", "PAC"),
            (.init(adif: 202, name: "PUERTO RICO", countryPrefix: "KP4", continent: "NA", cqZone: 8), "KP4AAA", "PR"),
            (.init(adif: 285, name: "VIRGIN ISLANDS", countryPrefix: "KP2", continent: "NA", cqZone: 8), "KP2AAA", "VI"),
            (.init(adif: 103, name: "GUAM", countryPrefix: "KH2", continent: "OC", cqZone: 27), "KH2AAA", "PAC"),
            (germany, "DL1DX", "DX"),
        ]
        for (entity, call, location) in endpoints {
            let own = session(rule: rule, call: call, entity: entity, raw: "K", normalized: "1000", location: location)
            let contact = qso(20 + entity.adif, rule: rule, session: own, call: "K1AAA", entity: usa,
                              receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_025_000)
            let document = try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [contact]), rule: rule)
            XCTAssertTrue(document.contains("LOCATION: \(location)\r\n"), call)
            XCTAssertTrue(document.contains(" 599 K      "), call)
        }
        let invalid = session(rule: rule, call: "KH6AAA", entity: endpoints[1].0,
                              raw: "K", normalized: "1000", location: "DX")
        let contact = qso(99, rule: rule, session: invalid, call: "K1AAA", entity: usa,
                          receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_025_000)
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: invalid, qsos: [contact]),
                                                            rule: rule))
    }

    func testContinentalCanadianCY9AndCY0LocationEndpointsStayIndependentOfExchange() throws {
        let rule = ARRLDXCWRule()
        let wveCases: [(ContestEntitySnapshot, String, String, String)] = [
            (usa, "K6AAA", "CA", "EB"),
            (canada, "VO2AAA", "LB", "NL"),
        ]
        for (entity, call, exchange, location) in wveCases {
            let own = session(rule: rule, call: call, entity: entity,
                              raw: exchange, normalized: exchange, location: location)
            let contact = qso(200 + entity.adif, rule: rule, session: own, call: "DL1AAA", entity: germany,
                              receivedRaw: "100", receivedNormalized: "100", frequency: 14_025_000)
            let document = try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [contact]), rule: rule)
            XCTAssertTrue(document.contains("LOCATION: \(location)\r\n"), call)
            XCTAssertTrue(document.contains(" 599 \(exchange)"), call)
        }

        let islands = [
            (ContestEntitySnapshot(adif: 211, name: "SABLE ISLAND", countryPrefix: "CY0", continent: "NA", cqZone: 5), "CY0AAA"),
            (ContestEntitySnapshot(adif: 252, name: "ST PAUL ISLAND", countryPrefix: "CY9", continent: "NA", cqZone: 5), "CY9AAA"),
        ]
        for (entity, call) in islands {
            let own = session(rule: rule, call: call, entity: entity, raw: "100", normalized: "100", location: "DX")
            let contact = qso(300 + entity.adif, rule: rule, session: own, call: "K1AAA", entity: usa,
                              receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_025_000)
            let document = try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [contact]), rule: rule)
            XCTAssertTrue(document.contains("LOCATION: DX\r\n"), call)
            XCTAssertTrue(document.contains(" 599 100    "), call)
        }
    }

    func testIdentityCategoryAndRawNormalizedTamperingFailClosed() throws {
        let rule = ARRLDXCWRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
        let valid = qso(30, rule: rule, session: own, call: "DL1AAA", entity: germany,
                        receivedRaw: "1KW", receivedNormalized: "1000", frequency: 14_025_000)
        XCTAssertThrowsError(try CabrilloExporter.document(input: input(rule: rule, session: own, qsos: [valid],
                                                                        transmitter: "TWO"), rule: rule))

        let badExchange = ContestExchangeSnapshot(rawSent: "CT", normalizedSent: "CT",
            rawReceived: "1KW", normalizedReceived: "100",
            sentFields: valid.exchange.sentFields,
            receivedFields: ["power": .init(raw: "1KW", normalized: "100")])
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(copy(valid, exchange: badExchange), session: own, rule: rule))

        for malformed in ["1\nKW", "1KÖ", "123456789"] {
            let exchange = ContestExchangeSnapshot(rawSent: "CT", normalizedSent: "CT",
                rawReceived: malformed, normalizedReceived: "1000", sentFields: valid.exchange.sentFields,
                receivedFields: ["power": .init(raw: malformed, normalized: "1000")])
            XCTAssertThrowsError(try CabrilloExporter.qsoLine(copy(valid, exchange: exchange), session: own, rule: rule))
        }

        let wrongIdentity = ContestExportInput(formatterVersion: ContestExportInput.arrlDXCWPreviewFormatterVersion,
            generatedAtUTC: date, sessionRevision: 1, session: own, ruleIdentity: ARRLDXSSBRule.identity,
            referenceDataVersion: own.referenceDataVersion, metadata: input(rule: rule, session: own, qsos: [valid]).metadata,
            qsos: [valid])
        XCTAssertThrowsError(try CabrilloExporter.document(input: wrongIdentity, rule: rule))
    }

    func testExportAuthorityPinsRulesHeaderQSOAndADIFSemantics() throws {
        struct Source: Decodable { let sha256: String; let semantics: String }
        struct Authority: Decodable { let rules: Source; let cabrilloHeader: Source; let cabrilloQSO: Source; let adif: Source }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/arrl-dx-export-authority.json")
        let fixture = try JSONDecoder().decode(Authority.self, from: Data(contentsOf: url))
        XCTAssertEqual(fixture.rules.sha256, ARRLDXCWRule.identity.sourceRevision)
        XCTAssertEqual(fixture.cabrilloHeader.sha256, "e3a4cd4a4749394dd944f4316eec467904df44c7668b29e7c5fd5fa617a08fcc")
        XCTAssertEqual(fixture.cabrilloQSO.sha256, "39b1df572ebc9d08c6e0fbe320d26565aa76000e8ab6c4e645339073afe79b56")
        XCTAssertEqual(fixture.adif.sha256, "3ba54cb29b4dc5333c81f38f53e9d5ca503ff47a917acffa64e4cc469464d5ef")
        XCTAssertTrue(fixture.rules.semantics.contains("power as a number or abbreviation"))
        XCTAssertTrue(fixture.cabrilloHeader.semantics.contains("CATEGORY-STATION is optional"))
    }

    private func session(rule: any ContestRule, call: String, entity: ContestEntitySnapshot,
                         raw: String, normalized: String, location: String) -> ContestSessionSnapshot {
        let field = entity.adif == 291 || entity.adif == 1 ? "location" : "power"
        return .init(id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "arrl-dx-2026-fixture", startedAt: date,
                     station: .init(callsign: call, entity: entity, sentExchange: raw,
                                    operatorCallsigns: [call], location: location,
                                    sentExchangeFields: [field: .init(raw: raw, normalized: normalized)]))
    }

    private func qso(_ number: Int, rule: any ContestRule, session: ContestSessionSnapshot,
                     call: String, entity: ContestEntitySnapshot, receivedRaw: String,
                     receivedNormalized: String, frequency: Int64) -> ContestQSO {
        let receivedField = entity.adif == 291 || entity.adif == 1 ? "location" : "power"
        let sent = session.station.sentExchangeFields.first!
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: UUID(uuidString: String(format: "D3000000-0000-0000-8000-%012d", number))!,
                     sessionID: session.id, timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
                     band: ContestBandPlan.band(for: frequency)!, mode: rule.metadata.entry.mode,
                     frequencyHz: frequency, rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: sent.value.raw, normalizedSent: sent.value.normalized,
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: [sent.key: sent.value],
                                     receivedFields: [receivedField: .init(raw: receivedRaw,
                                                                          normalized: receivedNormalized)]),
                     entity: entity, operatorCallsign: session.station.callsign,
                     stationLocation: session.station.location, provenance: .init(source: .operatorEntry))
    }

    private func input(rule: any ContestRule, session: ContestSessionSnapshot, qsos: [ContestQSO],
                       categoryBand: String = "ALL", transmitter: String = "ONE") -> ContestExportInput {
        let header = CabrilloHeader(callsign: session.station.callsign, categoryOperator: "SINGLE-OP",
            categoryAssisted: "NON-ASSISTED", categoryBand: categoryBand, categoryMode: rule.metadata.entry.mode,
            categoryTransmitter: transmitter, categoryPower: "LOW", operators: [session.station.callsign],
            location: session.station.location, name: "Operator")
        return .init(formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
                     generatedAtUTC: date.addingTimeInterval(300), sessionRevision: 4, session: session,
                     ruleIdentity: rule.metadata.identity, referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "ARRL DX preview", operatorCallsign: session.station.callsign,
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: qsos)
    }

    private func copy(_ qso: ContestQSO, exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }
}
