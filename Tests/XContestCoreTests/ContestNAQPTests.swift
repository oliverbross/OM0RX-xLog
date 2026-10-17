import Foundation
import XCTest
@testable import XContestCore

final class ContestNAQPTests: XCTestCase {
    private let sessionID = UUID(uuidString: "D1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "D2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_100_000)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let hawaii = ContestEntitySnapshot(adif: 110, name: "HAWAII", countryPrefix: "KH6", continent: "OC", cqZone: 31)
    private let dominican = ContestEntitySnapshot(adif: 72, name: "DOMINICAN REPUBLIC", countryPrefix: "HI", continent: "NA", cqZone: 8)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)

    func testPreviewDescriptorsAreDedicatedAndCatalogIsNotActivated() {
        XCTAssertEqual(ContestRuleRegistry.pilots.metadata.count, 8)
        XCTAssertNil(ContestRuleRegistry.pilots.metadata.first { $0.identity.id.hasPrefix("naqp-") })
        let rules: [any ContestRule] = [NAQPCWRule(), NAQPSSBRule(), NAQPRTTYRule()]
        let registry = ContestRuleRegistry(rules)
        XCTAssertEqual(registry.metadata.map(\.identity.id), ["naqp-cw", "naqp-rtty", "naqp-ssb"])
        for metadata in registry.metadata {
            XCTAssertEqual(metadata.identity.version, "1.0.0-2026-rules-preview")
            XCTAssertEqual(metadata.identity.edition, "2026-rules-preview")
            XCTAssertEqual(metadata.identity.sourceRevision,
                           "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8")
            XCTAssertEqual(metadata.entry.report.format, .none)
            XCTAssertEqual(metadata.entry.exchange.sentFields.map(\.id), ["name", "location"])
            XCTAssertEqual(metadata.entry.exchange.receivedFields.map(\.id), ["name", "location"])
            XCTAssertEqual(metadata.entry.serial.requirement, .none)
            XCTAssertEqual(metadata.entry.scorePolicy, .pointsTimesMultipliers)
            XCTAssertTrue(metadata.entry.isCoherent(supportedModes: metadata.supportedModes))
        }
        XCTAssertFalse(NAQPRTTYRule().metadata.supportedBands.contains("160m"))
        XCTAssertTrue(NAQPCWRule().metadata.supportedBands.contains("160m"))
    }

    func testIndependentNorthAmericanArithmeticIsThirtyAndHITokensDoNotCollide() throws {
        let rule = NAQPCWRule()
        let session = makeSession(rule: rule, stationCall: "K1AAA", entity: usa,
                                  name: "AL", location: "CA")
        let contacts = [
            qso(1, rule: rule, call: "K2AAA", band: "20m", entity: usa, name: "BOB", location: "CA"),
            qso(2, rule: rule, call: "KH6AAA", band: "20m", entity: hawaii, name: "KAI", location: "HI"),
            qso(3, rule: rule, call: "HI8AAA", band: "20m", entity: dominican, name: "ANA", location: "HI"),
            qso(4, rule: rule, call: "VE3AAA", band: "20m", entity: canada, name: "SAM", location: "ON"),
            qso(5, rule: rule, call: "K3AAA", band: "40m", entity: usa, name: "LEE", location: "CA"),
            qso(6, rule: rule, call: "DL1AAA", band: "20m", entity: germany, name: "MAX", location: "DX"),
            qso(7, rule: rule, call: "K2AAA", band: "20m", entity: usa, name: "BOB", location: "CA"),
        ]
        let score = try ContestEngine.score(contacts, session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition),
                       [.accepted, .accepted, .accepted, .accepted, .accepted, .accepted, .duplicate])
        XCTAssertEqual(score.totalPoints, 6)
        XCTAssertEqual(score.multiplierCount, 5)
        XCTAssertEqual(score.claimedScore, 30)
        XCTAssertEqual(score.qsos[1].newMultipliers,
                       [.init(kind: "naqp-state", value: "HI", scope: "20m")])
        XCTAssertEqual(score.qsos[2].newMultipliers,
                       [.init(kind: "naqp-dxcc", value: "HI", scope: "20m")])
    }

    func testDXEntrantRequiresNorthAmericanEndpointAndSendsNameOnly() throws {
        let rule = NAQPSSBRule()
        let session = makeSession(rule: rule, stationCall: "OM0RX", entity: slovakia,
                                  name: "OLIVER", location: nil)
        XCTAssertTrue(rule.validateSession(session).isEmpty)
        let valid = qso(11, rule: rule, call: "K1AAA", band: "20m", entity: usa,
                         name: "BOB", location: "MA", sentName: "OLIVER", sentLocation: nil)
        let invalid = qso(12, rule: rule, call: "DL1AAA", band: "20m", entity: germany,
                           name: "MAX", location: "DX", sentName: "OLIVER", sentLocation: nil)
        let score = try ContestEngine.score([valid, invalid], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .invalid])
        XCTAssertEqual(score.totalPoints, 1)
        XCTAssertEqual(score.multiplierCount, 1)
        XCTAssertEqual(score.claimedScore, 1)
        XCTAssertEqual(score.qsos[1].issues.map(\.code), ["noNorthAmericanEndpoint"])
    }

    func testModesReportsBandsAndTypedExchangeFailClosed() throws {
        let rule = NAQPRTTYRule()
        let session = makeSession(rule: rule, stationCall: "K1AAA", entity: usa,
                                  name: "AL", location: "CA")
        let valid = qso(20, rule: rule, call: "VE3AAA", band: "20m", entity: canada,
                         name: "SAM", location: "ON")
        let invalids = [
            copy(valid, mode: "CW"), copy(valid, report: "599"),
            copy(valid, band: "160m", frequencyHz: 1_850_000),
            copy(valid, frequencyHz: 7_050_000), copy(valid, receivedLocation: "QC"),
            copy(valid, aggregateReceived: "SAM QC"), copy(valid, removeEntity: true),
        ]
        for contact in invalids {
            XCTAssertEqual(try ContestEngine.score([contact], session: session, rule: rule).qsos[0].disposition,
                           .invalid)
        }
        XCTAssertEqual(try ContestEngine.score([], session: session, rule: rule).claimedScore, 0)
    }

    func testSelfContactsAndMobileEndpointPolicyApplyToAllModes() throws {
        let rules: [any ContestRule] = [NAQPCWRule(), NAQPSSBRule(), NAQPRTTYRule()]
        for (offset, rule) in rules.enumerated() {
            let session = makeSession(rule: rule, stationCall: "K1AAA", entity: usa,
                                      name: "AL", location: "CA")
            let selfQSO = qso(40 + offset, rule: rule, call: "K1AAA", band: "20m",
                               entity: usa, name: "AL", location: "CA")
            let selfResult = try ContestEngine.score([selfQSO], session: session, rule: rule).qsos[0]
            XCTAssertEqual(selfResult.disposition, .invalid)
            XCTAssertTrue(selfResult.issues.map(\.code).contains("selfContact"))

            for (mobileOffset, suffix) in ["MM", "AM"].enumerated() {
                let mobile = qso(50 + offset * 10 + mobileOffset, rule: rule,
                                  call: "K1ABC/\(suffix)", band: "20m", entity: usa,
                                  name: "PAT", location: "DX")
                let result = try ContestEngine.score([mobile], session: session, rule: rule)
                XCTAssertEqual(result.qsos[0].disposition, .accepted)
                XCTAssertEqual(result.totalPoints, 1)
                XCTAssertEqual(result.multiplierCount, 0)
                XCTAssertEqual(result.claimedScore, 0)
            }
            let falseLandMultiplier = qso(80 + offset, rule: rule, call: "K1ABC/MM", band: "20m",
                                           entity: usa, name: "PAT", location: "CA")
            XCTAssertEqual(try ContestEngine.score([falseLandMultiplier], session: session, rule: rule)
                .qsos[0].disposition, .invalid)
        }

        let rule = NAQPCWRule()
        let dxSession = makeSession(rule: rule, stationCall: "OM0RX", entity: slovakia,
                                    name: "OLIVER", location: nil)
        let unknownEndpoint = qso(90, rule: rule, call: "K1ABC/MM", band: "20m", entity: usa,
                                   name: "PAT", location: "DX", sentName: "OLIVER", sentLocation: nil)
        let result = try ContestEngine.score([unknownEndpoint], session: dxSession, rule: rule).qsos[0]
        XCTAssertEqual(result.disposition, .invalid)
        XCTAssertTrue(result.issues.map(\.code).contains("unsupportedMobileEndpoint"))

        let ownMobile = makeSession(rule: rule, stationCall: "K1AAA/MM", entity: usa,
                                    name: "AL", location: "CA")
        XCTAssertTrue(rule.validateSession(ownMobile).map(\.code).contains("unsupportedMobileStation"))
    }

    func testSessionValidationRejectsContradictoryLocationSemantics() {
        let rule = NAQPCWRule()
        XCTAssertFalse(rule.validateSession(makeSession(rule: rule, stationCall: "K1AAA", entity: usa,
                                                        name: "AL", location: "HI")).isEmpty)
        XCTAssertFalse(rule.validateSession(makeSession(rule: rule, stationCall: "OM0RX", entity: slovakia,
                                                        name: "OLIVER", location: "DX")).isEmpty)
        XCTAssertTrue(rule.validateSession(makeSession(rule: rule, stationCall: "KH6AAA", entity: hawaii,
                                                       name: "KAI", location: "HI")).isEmpty)
    }

    func testStationNameDescriptorAcceptsThirtyTwoBytesAndRejectsOverflow() {
        let rule = NAQPCWRule()
        let maximumName = String(repeating: "A", count: 32)
        XCTAssertTrue(rule.metadata.entry.stationExchangeIssues(exchangeFields(name: maximumName, location: "CA")).isEmpty)
        let oversized = rule.metadata.entry.stationExchangeIssues(exchangeFields(name: maximumName + "A", location: "CA"))
        XCTAssertTrue(oversized.map(\.code).contains("structuredExchangeFieldTooLong"))
    }

    func testOfficialAuthorityFixturePinsRulesAndMultiplierForm() throws {
        struct Authority: Decodable {
            struct CTYEntity: Decodable {
                let adif: Int
                let countryPrefix: String
                let continent: String
                let officialToken: String
                let eligible: Bool
            }
            let rulesSHA256: String
            let multiplierFormSHA256: String
            let statesAndDC: [String]
            let canadianProvinces: [String]
            let otherNorthAmericanPrefixes: [String]
            let bundledCTYEntities: [CTYEntity]
        }
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
            .appendingPathComponent("SourceFixtures/naqp-2026-authority.json")
        let value = try JSONDecoder().decode(Authority.self, from: Data(contentsOf: url))
        XCTAssertEqual(value.rulesSHA256, "0c98451d9dc4111dbb371c0a7d806a5ccd88624e21b1553672e9066c417064e8")
        XCTAssertEqual(value.multiplierFormSHA256, "6ea80c5118f0520f95762cc679ff3ee05154d74dc1817a681664e690a01f5a8d")
        XCTAssertEqual(value.statesAndDC.count, 51)
        XCTAssertEqual(value.canadianProvinces.count, 13)
        XCTAssertTrue(value.otherNorthAmericanPrefixes.contains("4U1/U"))
        XCTAssertTrue(value.otherNorthAmericanPrefixes.contains("HI"))
        XCTAssertEqual(Set(value.otherNorthAmericanPrefixes), [
            "4U1/U", "6Y", "8P", "C6", "CM", "CY9", "CY0", "FG", "FJ", "FM", "FO", "FP", "FS",
            "HH", "HI", "HK0", "HP", "HR", "J3", "J6", "J7", "J8", "KG4", "KP1", "KP2", "KP4",
            "KP5", "OX", "PJ5", "PJ7", "TG", "TI", "TI9", "V2", "V3", "V4", "VP2E", "VP2M",
            "VP2V", "VP5", "VP9", "XE", "XF4", "YN", "YS", "YV0", "ZF",
        ])

        let rule = NAQPCWRule()
        let session = makeSession(rule: rule, stationCall: "K1AAA", entity: usa,
                                  name: "AL", location: "CA")
        let alaska = ContestEntitySnapshot(adif: 6, name: "ALASKA", countryPrefix: "KL7", continent: "NA", cqZone: 1)
        for (offset, location) in value.statesAndDC.enumerated() {
            let entity = location == "AK" ? alaska : location == "HI" ? hawaii : usa
            let contact = qso(100 + offset, rule: rule, call: "N\(offset + 1)AA", band: "20m",
                               entity: entity, name: "BOB", location: location)
            let score = try ContestEngine.score([contact], session: session, rule: rule)
            XCTAssertEqual(score.qsos[0].newMultipliers.first?.kind, "naqp-state", location)
        }
        for (offset, location) in value.canadianProvinces.enumerated() {
            let contact = qso(200 + offset, rule: rule, call: "VE\(offset + 1)AA", band: "20m",
                               entity: canada, name: "SAM", location: location)
            let score = try ContestEngine.score([contact], session: session, rule: rule)
            XCTAssertEqual(score.qsos[0].newMultipliers.first?.kind, "naqp-province", location)
        }
        for (offset, fixture) in value.bundledCTYEntities.enumerated() {
            let entity = ContestEntitySnapshot(adif: fixture.adif, name: "CTY FIXTURE",
                                               countryPrefix: fixture.countryPrefix,
                                               continent: fixture.continent, cqZone: 8)
            let contact = qso(300 + offset, rule: rule, call: "W\(offset + 1)ZZ", band: "20m",
                               entity: entity, name: "PAT", location: fixture.officialToken)
            let score = try ContestEngine.score([contact], session: session, rule: rule)
            XCTAssertEqual(score.qsos[0].disposition, .accepted, fixture.countryPrefix)
            if fixture.eligible {
                XCTAssertEqual(score.qsos[0].newMultipliers.first,
                               .init(kind: "naqp-dxcc", value: fixture.officialToken, scope: "20m"),
                               fixture.countryPrefix)
            } else {
                XCTAssertTrue(score.qsos[0].newMultipliers.isEmpty, fixture.countryPrefix)
            }
        }
    }

    private func makeSession(rule: any ContestRule, stationCall: String, entity: ContestEntitySnapshot,
                             name: String, location: String?) -> ContestSessionSnapshot {
        let fields = exchangeFields(name: name, location: location)
        return ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: stationCall, entity: entity,
                           sentExchange: aggregate(name: name, location: location),
                           operatorCallsigns: [stationCall], location: "DX", sentExchangeFields: fields))
    }

    private func qso(_ number: Int, rule: any ContestRule, call: String, band: String,
                     entity: ContestEntitySnapshot, name: String, location: String?,
                     sentName: String = "AL", sentLocation: String? = "CA") -> ContestQSO {
        ContestQSO(id: fixedUUID(number), sessionID: sessionID,
                   timestampUTC: date.addingTimeInterval(Double(number)), callsign: call,
                   band: band, mode: rule.metadata.entry.mode, frequencyHz: frequency(band),
                   rstSent: "", rstReceived: "",
                   exchange: .init(rawSent: aggregate(name: sentName, location: sentLocation),
                                   normalizedSent: aggregate(name: sentName, location: sentLocation),
                                   rawReceived: aggregate(name: name, location: location),
                                   normalizedReceived: aggregate(name: name, location: location),
                                   sentFields: exchangeFields(name: sentName, location: sentLocation),
                                   receivedFields: exchangeFields(name: name, location: location)),
                   entity: entity, operatorCallsign: "K1AAA", stationLocation: "DX",
                   provenance: .init(source: .operatorEntry))
    }

    private func copy(_ qso: ContestQSO, mode: String? = nil, report: String? = nil,
                      band: String? = nil, frequencyHz: Int64? = nil,
                      receivedLocation: String? = nil, aggregateReceived: String? = nil,
                      removeEntity: Bool = false) -> ContestQSO {
        var received = qso.exchange.receivedFields
        if let receivedLocation { received["location"] = .init(raw: receivedLocation, normalized: receivedLocation) }
        return ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
                          callsign: qso.callsign, band: band ?? qso.band, mode: mode ?? qso.mode,
                          frequencyHz: frequencyHz ?? qso.frequencyHz, rstSent: report ?? qso.rstSent,
                          rstReceived: report ?? qso.rstReceived,
                          exchange: .init(rawSent: qso.exchange.rawSent,
                                          normalizedSent: qso.exchange.normalizedSent,
                                          rawReceived: aggregateReceived ?? qso.exchange.rawReceived,
                                          normalizedReceived: aggregateReceived ?? qso.exchange.normalizedReceived,
                                          sentFields: qso.exchange.sentFields, receivedFields: received),
                          entity: removeEntity ? nil : qso.entity,
                          operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
                          provenance: qso.provenance)
    }

    private func exchangeFields(name: String, location: String?) -> [String: ContestExchangeFieldValue] {
        var result = ["name": ContestExchangeFieldValue(raw: name, normalized: name)]
        if let location { result["location"] = .init(raw: location, normalized: location) }
        return result
    }
    private func aggregate(name: String, location: String?) -> String {
        [name, location].compactMap { $0 }.joined(separator: " ")
    }
    private func frequency(_ band: String) -> Int64 {
        ["160m": 1_850_000, "80m": 3_550_000, "40m": 7_050_000,
         "20m": 14_050_000, "15m": 21_050_000, "10m": 28_050_000][band]!
    }
    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "D0000000-0000-0000-0000-%012d", number))!
    }
}
