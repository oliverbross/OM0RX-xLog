import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport
#if canImport(XLogCore)
import XLogCore
#elseif canImport(XLogPortableCore)
import XLogPortableCore
#endif

final class ContestARRLDXADIFExportTests: XCTestCase {
    private let sessionID = UUID(uuidString: "D4000000-0000-0000-8000-000000000001")!
    private let generation = UUID(uuidString: "D5000000-0000-0000-8000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)

    func testWVEToDXKeepsRawPowerAndEmitsStateAndDXCCWithoutInferredPowerFields() throws {
        let rule = ARRLDXCWRule()
        let own = session(rule: rule, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
        let contact = qso(rule: rule, session: own, call: "DL1AAA", entity: germany,
                          receivedRaw: "100WATTS", receivedNormalized: "100", frequency: 14_025_000)
        let record = try XCTUnwrap(ContestADIFExport.records(input: input(rule: rule, session: own,
                                                                          qso: contact), rule: rule).first)
        XCTAssertEqual(record["CONTEST_ID"], "ARRL-DX-CW")
        XCTAssertEqual(record["MODE"], "CW")
        XCTAssertEqual(record["STX_STRING"], "CT")
        XCTAssertEqual(record["SRX_STRING"], "100WATTS")
        XCTAssertEqual(record["MY_DXCC"], "291")
        XCTAssertEqual(record["DXCC"], "230")
        XCTAssertEqual(record["MY_STATE"], "CT")
        XCTAssertNil(record["STATE"])
        XCTAssertNil(record["TX_PWR"])
        XCTAssertNil(record["STX"])
        XCTAssertNil(record["SRX"])
    }

    func testDXToWVEKeepsRawPowerAndMapsLBAndNFOnlyInADIFState() throws {
        let rule = ARRLDXSSBRule()
        for value in ["LB", "NF"] {
            let own = session(rule: rule, call: "OM0RX", entity: germany, raw: "1KW", normalized: "1000", location: "DX")
            let contact = qso(rule: rule, session: own, call: value == "LB" ? "VO2AAA" : "VO1AAA",
                              entity: canada, receivedRaw: value, receivedNormalized: value,
                              frequency: 14_250_000)
            let record = try XCTUnwrap(ContestADIFExport.records(input: input(rule: rule, session: own,
                                                                              qso: contact), rule: rule).first)
            XCTAssertEqual(record["CONTEST_ID"], "ARRL-DX-SSB")
            XCTAssertEqual(record["MODE"], "SSB")
            XCTAssertEqual(record["STX_STRING"], "1KW")
            XCTAssertEqual(record["SRX_STRING"], value)
            XCTAssertEqual(record["MY_DXCC"], "230")
            XCTAssertEqual(record["DXCC"], "1")
            XCTAssertNil(record["MY_STATE"])
            XCTAssertEqual(record["STATE"], "NL")
            XCTAssertNil(record["TX_PWR"])
            XCTAssertNil(record["STX"])
            XCTAssertNil(record["SRX"])
        }
    }

    func testAlaskaAndHawaiiRemainDXSideWithoutStateFields() throws {
        let rule = ARRLDXCWRule()
        for (entity, call, location) in [(alaska, "KL7AAA", "AK"), (hawaii, "KH6AAA", "PAC")] {
            let own = session(rule: rule, call: call, entity: entity, raw: "K", normalized: "1000", location: location)
            let contact = qso(rule: rule, session: own, call: "K1AAA", entity: usa,
                              receivedRaw: "CT", receivedNormalized: "CT", frequency: 14_025_000)
            let record = try XCTUnwrap(ContestADIFExport.records(input: input(rule: rule, session: own,
                                                                              qso: contact), rule: rule).first)
            XCTAssertEqual(record["MY_DXCC"], String(entity.adif))
            XCTAssertNil(record["MY_STATE"])
            XCTAssertEqual(record["STATE"], "CT")
            XCTAssertEqual(record["STX_STRING"], "K")
            XCTAssertEqual(record["SRX_STRING"], "CT")
        }
    }

    func testDocumentsCarryExactRuleIdentityAndTamperingFailsClosed() throws {
        for rule in [ARRLDXCWRule() as any ContestRule, ARRLDXSSBRule() as any ContestRule] {
            let own = session(rule: rule, call: "K1AAA", entity: usa, raw: "CT", normalized: "CT", location: "EMA")
            let frequency: Int64 = rule.metadata.entry.mode == "CW" ? 14_025_000 : 14_250_000
            let contact = qso(rule: rule, session: own, call: "DL1AAA", entity: germany,
                              receivedRaw: "K", receivedNormalized: "1000", frequency: frequency)
            let export = input(rule: rule, session: own, qso: contact)
            let record = try XCTUnwrap(ADIFParser().records(in: try ContestADIFExport.document(input: export,
                                                                                               rule: rule)).first)
            XCTAssertEqual(record["CONTEST_ID"], rule.metadata.cabrilloName)
            XCTAssertEqual(record["APP_OM0RXXLOG_RULE_ID"], rule.metadata.identity.id)
            XCTAssertEqual(record["APP_OM0RXXLOG_FORMATTER_VERSION"], rule.metadata.entry.cabrilloFormatterVersion)

            let forged = copy(contact, exchange: .init(rawSent: "CA", normalizedSent: "CT",
                rawReceived: "K", normalizedReceived: "1000", sentFields: contact.exchange.sentFields,
                receivedFields: contact.exchange.receivedFields))
            XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSO(export, forged), rule: rule))
            let control = copy(contact, exchange: .init(rawSent: "CT", normalizedSent: "CT",
                rawReceived: "K\n", normalizedReceived: "1000", sentFields: contact.exchange.sentFields,
                receivedFields: ["power": .init(raw: "K\n", normalized: "1000")]))
            XCTAssertThrowsError(try ContestADIFExport.records(input: replacingQSO(export, control), rule: rule))
        }
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

    private func qso(rule: any ContestRule, session: ContestSessionSnapshot, call: String,
                     entity: ContestEntitySnapshot, receivedRaw: String,
                     receivedNormalized: String, frequency: Int64) -> ContestQSO {
        let receivedField = entity.adif == 291 || entity.adif == 1 ? "location" : "power"
        let sent = session.station.sentExchangeFields.first!
        let phone = rule.metadata.entry.mode == "SSB"
        return .init(id: UUID(uuidString: "D6000000-0000-0000-8000-000000000001")!, sessionID: session.id,
                     timestampUTC: date, callsign: call, band: ContestBandPlan.band(for: frequency)!,
                     mode: rule.metadata.entry.mode, frequencyHz: frequency,
                     rstSent: phone ? "59" : "599", rstReceived: phone ? "59" : "599",
                     exchange: .init(rawSent: sent.value.raw, normalizedSent: sent.value.normalized,
                                     rawReceived: receivedRaw, normalizedReceived: receivedNormalized,
                                     sentFields: [sent.key: sent.value],
                                     receivedFields: [receivedField: .init(raw: receivedRaw,
                                                                          normalized: receivedNormalized)]),
                     entity: entity, operatorCallsign: session.station.callsign,
                     stationLocation: session.station.location, provenance: .init(source: .operatorEntry))
    }

    private func input(rule: any ContestRule, session: ContestSessionSnapshot,
                       qso: ContestQSO) -> ContestExportInput {
        let header = CabrilloHeader(callsign: session.station.callsign, categoryOperator: "SINGLE-OP",
            categoryAssisted: "NON-ASSISTED", categoryBand: "ALL", categoryMode: rule.metadata.entry.mode,
            categoryTransmitter: "ONE", categoryPower: "LOW", operators: [session.station.callsign],
            location: session.station.location, name: "Operator")
        return .init(formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
                     generatedAtUTC: date.addingTimeInterval(60), sessionRevision: 2, session: session,
                     ruleIdentity: rule.metadata.identity, referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "ARRL DX preview", operatorCallsign: session.station.callsign,
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: [qso])
    }

    private func replacingQSO(_ input: ContestExportInput, _ qso: ContestQSO) -> ContestExportInput {
        .init(schemaVersion: input.schemaVersion, formatterVersion: input.formatterVersion,
              generatedAtUTC: input.generatedAtUTC, sessionRevision: input.sessionRevision,
              session: input.session, ruleIdentity: input.ruleIdentity,
              referenceDataVersion: input.referenceDataVersion, metadata: input.metadata, qsos: [qso])
    }

    private func copy(_ qso: ContestQSO, exchange: ContestExchangeSnapshot) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC, callsign: qso.callsign,
              band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz, rstSent: qso.rstSent,
              rstReceived: qso.rstReceived, exchange: exchange, entity: qso.entity,
              operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
              provenance: qso.provenance)
    }
}
