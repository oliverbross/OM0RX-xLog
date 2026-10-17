import Foundation
import XCTest
@testable import XContestCore

final class ContestStructuredExchangeTests: XCTestCase {
    private let sessionID = UUID(uuidString: "B1000000-0000-0000-0000-000000000001")!
    private let generation = UUID(uuidString: "B2000000-0000-0000-0000-000000000001")!
    private let date = Date(timeIntervalSince1970: 1_900_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)

    func testLegacyExchangeAndDescriptorEncodingRemainByteStable() throws {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let decoder = JSONDecoder()
        let legacyExchange = #"{"normalizedReceived":"14","normalizedSent":"15","rawReceived":"14","rawSent":"15"}"#.data(using: .utf8)!
        let exchange = try decoder.decode(ContestExchangeSnapshot.self, from: legacyExchange)
        XCTAssertTrue(exchange.sentFields.isEmpty)
        XCTAssertTrue(exchange.receivedFields.isEmpty)
        XCTAssertEqual(try encoder.encode(exchange), legacyExchange)
        let legacyStation = ContestStationSnapshot(callsign: "OM0RX", entity: nil, sentExchange: "15",
                                                   operatorCallsigns: ["OM0RX"], location: "JN98")
        XCTAssertEqual(String(decoding: try encoder.encode(legacyStation), as: UTF8.self),
                       #"{"callsign":"OM0RX","location":"JN98","operatorCallsigns":["OM0RX"],"sentExchange":"15"}"#)

        let entry = CQWWCWRule().metadata.entry
        let encoded = try encoder.encode(entry)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        XCTAssertNil(object["version"])
        XCTAssertNil(object["modeProfiles"])
        XCTAssertNil(object["scorePolicy"])
        let exchangeObject = try XCTUnwrap(object["exchange"] as? [String: Any])
        XCTAssertNil(exchangeObject["sentFields"])
        XCTAssertNil(exchangeObject["receivedFields"])
        XCTAssertEqual(try encoder.encode(try decoder.decode(ContestEntryDescriptor.self, from: encoded)), encoded)

        var invalidV1 = object
        invalidV1["scorePolicy"] = "pointsOnly"
        let invalidData = try JSONSerialization.data(withJSONObject: invalidV1, options: [.sortedKeys])
        XCTAssertThrowsError(try decoder.decode(ContestEntryDescriptor.self, from: invalidData))
    }

    func testVersionOneRejectsStructuredFieldsWithoutChangingLegacyScore() throws {
        let rule = CQWWCWRule()
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "15",
                           operatorCallsigns: ["OM0RX"], location: "JN98")
        )
        let legacy = qso(1, rule: rule.metadata.identity, mode: "CW", report: "599",
                         sent: "15", received: "5", fields: [:])
        let legacyScore = try ContestEngine.score([legacy], session: session, rule: rule)
        XCTAssertEqual(legacyScore.qsos[0].disposition, .accepted)
        XCTAssertEqual(legacyScore.claimedScore, 6)

        let structured = qso(2, rule: rule.metadata.identity, mode: "CW", report: "599",
                             sent: "15", received: "5",
                             fields: ["state": .init(raw: "CA", normalized: "CA")])
        let rejected = try ContestEngine.score([structured], session: session, rule: rule)
        XCTAssertEqual(rejected.qsos[0].disposition, .invalid)
        XCTAssertEqual(rejected.qsos[0].issues.map(\.code), ["structuredExchangeRequiresV2"])

        let encoder = JSONEncoder()
        let decoder = JSONDecoder()
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(legacy)) as? [String: Any])
        object["mode"] = "cw"
        let lowercase = try decoder.decode(ContestQSO.self,
                                           from: JSONSerialization.data(withJSONObject: object))
        XCTAssertEqual(try ContestEngine.score([lowercase], session: session, rule: rule).qsos[0].disposition,
                       .invalid)
    }

    func testVersionTwoProfilesStructuredFieldsAndPointsOnlyPolicy() throws {
        let rule = StructuredFixtureRule()
        XCTAssertTrue(rule.metadata.entry.isCoherent(supportedModes: rule.metadata.supportedModes))
        let session = structuredSession(rule: rule.metadata.identity)
        let first = qso(10, rule: rule.metadata.identity, mode: "RTTY", report: "599",
                        sent: "ALICE NT", received: "BOB CA",
                        fields: ["name": .init(raw: "Bob", normalized: "BOB"),
                                 "state": .init(raw: "ca", normalized: "CA")],
                        sentFields: session.station.sentExchangeFields)
        let second = qso(11, rule: rule.metadata.identity, mode: "RTTY", report: "599",
                         sent: "ALICE NT", received: "CAROL TX",
                         fields: ["name": .init(raw: "Carol", normalized: "CAROL"),
                                  "state": .init(raw: "tx", normalized: "TX")],
                         sentFields: session.station.sentExchangeFields)
        let score = try ContestEngine.score([first, second], session: session, rule: rule)
        XCTAssertEqual(score.qsos.map(\.disposition), [.accepted, .accepted])
        XCTAssertEqual(score.totalPoints, 8)
        XCTAssertEqual(score.multiplierCount, 2)
        XCTAssertEqual(score.claimedScore, 8)

        let wrongMode = qso(12, rule: rule.metadata.identity, mode: "CW", report: "599",
                            sent: "ALICE NT", received: "BOB CA", fields: first.exchange.receivedFields,
                            sentFields: first.exchange.sentFields)
        let missingField = qso(13, rule: rule.metadata.identity, mode: "RTTY", report: "599",
                               sent: "ALICE NT", received: "BOB", fields: ["name": first.exchange.receivedFields["name"]!],
                               sentFields: first.exchange.sentFields)
        XCTAssertEqual(try ContestEngine.score([wrongMode], session: session, rule: rule).qsos[0].disposition, .invalid)
        XCTAssertEqual(try ContestEngine.score([missingField], session: session, rule: rule).qsos[0].disposition, .invalid)
    }

    func testPortableBandMapHasDeterministicBoundaries() {
        XCTAssertEqual(ContestBandPlan.band(for: 1_800_000), "160m")
        XCTAssertNil(ContestBandPlan.band(for: 2_000_000))
        XCTAssertEqual(ContestBandPlan.band(for: 14_349_999), "20m")
        XCTAssertEqual(ContestBandPlan.band(for: 50_000_000), "6m")
        XCTAssertEqual(ContestBandPlan.band(for: 144_000_000), "2m")
        XCTAssertEqual(ContestBandPlan.band(for: 432_100_000), "70cm")
        XCTAssertNil(ContestBandPlan.band(for: 100_000_000))
    }

    func testMalformedVersionTwoDescriptorsFailDeterministicallyWithoutTrapping() throws {
        let field = ContestExchangeFieldDescriptor(id: "name", label: "Name", acceptedKinds: [.operatorName],
                                                   maximumUTF8Bytes: 32, adifField: .name)
        let duplicateEntry = fixtureEntry(sentFields: [field, field], receivedFields: [field])
        let issues = duplicateEntry.structuralIssues(
            mode: "RTTY", rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "ALICE", normalizedSent: "ALICE",
                            rawReceived: "BOB", normalizedReceived: "BOB",
                            sentFields: ["name": .init(raw: "ALICE", normalized: "ALICE")],
                            receivedFields: ["name": .init(raw: "BOB", normalized: "BOB")]),
            allowIncomplete: false)
        XCTAssertEqual(issues.map(\.code), ["duplicateStructuredExchangeFieldDescriptor"])
        try assertInvalidDescriptor(duplicateEntry)

        let unknownIssues = fixtureEntry().structuralIssues(
            mode: "RTTY", rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "ALICE", normalizedSent: "ALICE",
                            rawReceived: "BOB", normalizedReceived: "BOB",
                            sentFields: ["zzz": .init(raw: "Z", normalized: "Z"),
                                         "aaa": .init(raw: "A", normalized: "A")],
                            receivedFields: ["name": .init(raw: "BOB", normalized: "BOB")]),
            allowIncomplete: false)
        XCTAssertEqual(unknownIssues.prefix(2).map(\.field),
                       ["exchange.sent.aaa", "exchange.sent.zzz"])

        let badReport = ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .none, defaultSent: "", defaultReceived: "", maximumUTF8Bytes: 1))],
            exchange: fixtureEntry().exchange, serial: .init(requirement: .none, allowedScopes: []),
            scorePolicy: .pointsOnly)
        try assertInvalidDescriptor(badReport)

        let controlMode = ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY\n", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: fixtureEntry().exchange, serial: .init(requirement: .none, allowedScopes: []),
            scorePolicy: .pointsOnly)
        try assertInvalidDescriptor(controlMode)

        let tooManyProfiles = ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: (0..<9).map { .init(mode: "M\($0)", adifMode: "RTTY", cabrilloQSOType: "RY",
                                                   report: .init(format: .digitalRST, defaultSent: "599",
                                                                 defaultReceived: "599", maximumUTF8Bytes: 3)) },
            exchange: fixtureEntry().exchange, serial: .init(requirement: .none, allowedScopes: []),
            scorePolicy: .pointsOnly)
        try assertInvalidDescriptor(tooManyProfiles)

        let tooManyFields = (0..<17).map {
            ContestExchangeFieldDescriptor(id: "field\($0)", label: "Field \($0)",
                                           acceptedKinds: [.subdivision], maximumUTF8Bytes: 8)
        }
        try assertInvalidDescriptor(fixtureEntry(sentFields: tooManyFields))

        let serialBase = ContestExchangeFieldDescriptor(id: "serial", label: "Serial",
                                                        acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8,
                                                        adifField: .stx)
        try assertInvalidDescriptor(serialEntry(sentFields: []))
        try assertInvalidDescriptor(serialEntry(sentFields: [serialBase,
                                                              .init(id: "serial2", label: "Serial 2",
                                                                    acceptedKinds: [.serialNumber], maximumUTF8Bytes: 8)]))
        try assertInvalidDescriptor(serialEntry(sentFields: [
            .init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber], required: false,
                  maximumUTF8Bytes: 8, adifField: .stx),
        ]))
        try assertInvalidDescriptor(serialEntry(sentFields: [
            .init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber, .subdivision],
                  maximumUTF8Bytes: 8, adifField: .stx),
        ]))

        let encoder = JSONEncoder()
        let encoded = try encoder.encode(fixtureEntry())
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoded) as? [String: Any])
        object["mode"] = "CW"
        XCTAssertThrowsError(try JSONDecoder().decode(
            ContestEntryDescriptor.self, from: JSONSerialization.data(withJSONObject: object)))
    }

    private func structuredSession(rule: ContestRuleIdentity) -> ContestSessionSnapshot {
        ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule,
            referenceDataVersion: "cty-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "ALICE NT",
                           operatorCallsigns: ["OM0RX"], location: "JN98",
                           sentExchangeFields: ["name": .init(raw: "Alice", normalized: "ALICE"),
                                                "state": .init(raw: "nt", normalized: "NT")])
        )
    }

    private func qso(_ number: Int, rule: ContestRuleIdentity, mode: String, report: String,
                     sent: String, received: String,
                     fields: [String: ContestExchangeFieldValue],
                     sentFields: [String: ContestExchangeFieldValue] = [:]) -> ContestQSO {
        ContestQSO(
            id: UUID(uuidString: String(format: "B0000000-0000-0000-0000-%012d", number))!,
            sessionID: sessionID, timestampUTC: date.addingTimeInterval(Double(number)),
            callsign: "K\(number)ABC", band: "20m", mode: mode, frequencyHz: 14_080_000,
            rstSent: report, rstReceived: report,
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                            normalizedReceived: received, sentFields: sentFields, receivedFields: fields),
            entity: usa, operatorCallsign: "OM0RX", stationLocation: "JN98",
            provenance: .init(source: .operatorEntry)
        )
    }

    private func fixtureEntry(sentFields: [ContestExchangeFieldDescriptor]? = nil,
                              receivedFields: [ContestExchangeFieldDescriptor]? = nil) -> ContestEntryDescriptor {
        let fields = [ContestExchangeFieldDescriptor(id: "name", label: "Name", acceptedKinds: [.operatorName],
                                                     maximumUTF8Bytes: 32, adifField: .name)]
        return ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings, sentFields: sentFields ?? fields,
                            receivedFields: receivedFields ?? fields),
            serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsOnly)
    }

    private func serialEntry(sentFields: [ContestExchangeFieldDescriptor]) -> ContestEntryDescriptor {
        ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(
                sent: .structured, received: .structured, sentDefault: .stationFields,
                adifFields: .exchangeStrings, sentFields: sentFields,
                receivedFields: [.init(id: "serial", label: "Serial", acceptedKinds: [.serialNumber],
                                       maximumUTF8Bytes: 8, adifField: .srx)]),
            serial: .init(requirement: .requiredForCommit, allowedScopes: [.session]), scorePolicy: .pointsOnly)
    }

    private func assertInvalidDescriptor(_ entry: ContestEntryDescriptor,
                                         file: StaticString = #filePath, line: UInt = #line) throws {
        let rule = MetadataFixtureRule(entry: entry)
        let session = ContestSessionSnapshot(
            id: sessionID, workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: om, sentExchange: "ALICE",
                           operatorCallsigns: ["OM0RX"], location: "JN98"))
        XCTAssertFalse(entry.isCoherent(supportedModes: rule.metadata.supportedModes), file: file, line: line)
        XCTAssertThrowsError(try ContestEngine.score([], session: session, rule: rule), file: file, line: line) {
            XCTAssertEqual($0 as? ContestEvaluationError, .invalidRuleDescriptor, file: file, line: line)
        }
    }
}

private struct MetadataFixtureRule: ContestRule {
    static let identity = ContestRuleIdentity(id: "test-invalid-v2", version: "2.0.0",
                                              edition: "fixture", sourceRevision: "fixture")
    let metadata: ContestRuleMetadata

    init(entry: ContestEntryDescriptor) {
        metadata = ContestRuleMetadata(identity: Self.identity, displayName: "Invalid fixture",
                                       cabrilloName: "TEST", supportedBands: ["20m"],
                                       supportedModes: [entry.mode], entry: entry,
                                       sourceProvenance: "test fixture")
    }

    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        .init(validation: [], dupeKey: nil, points: 1, multiplierCandidates: [])
    }
    func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }
}

private struct StructuredFixtureRule: ContestRule {
    static let identity = ContestRuleIdentity(id: "test-structured-rtty", version: "2.0.0",
                                              edition: "fixture", sourceRevision: "fixture")
    let metadata = ContestRuleMetadata(
        identity: identity, displayName: "Structured fixture", cabrilloName: "TEST-RTTY",
        supportedBands: ["20m"], supportedModes: ["RTTY"],
        entry: ContestEntryDescriptor(
            cabrilloFormatterVersion: "fixture-v2", cabrilloProjectionFormatterVersion: "fixture-v2-projection",
            modeProfiles: [.init(mode: "RTTY", adifMode: "RTTY", cabrilloQSOType: "RY",
                                 report: .init(format: .digitalRST, defaultSent: "599", defaultReceived: "599", maximumUTF8Bytes: 3))],
            exchange: .init(sent: .structured, received: .structured, sentDefault: .stationFields,
                            adifFields: .exchangeStrings,
                            sentFields: Self.fields(my: true), receivedFields: Self.fields(my: false)),
            serial: .init(requirement: .none, allowedScopes: []), scorePolicy: .pointsOnly),
        sourceProvenance: "test fixture"
    )

    func evaluate(_ qso: ContestQSO, in session: ContestSessionSnapshot) -> ContestRuleEvaluation {
        .init(validation: [], dupeKey: "\(qso.callsign)|\(qso.band)", points: 4,
              multiplierCandidates: [.init(kind: "state",
                                           value: qso.exchange.receivedFields["state"]?.normalized ?? "",
                                           scope: "contest")])
    }

    func cabrilloReceivedExchange(for qso: ContestQSO) -> String { qso.exchange.normalizedReceived }

    private static func fields(my: Bool) -> [ContestExchangeFieldDescriptor] {
        [.init(id: "name", label: "Name", acceptedKinds: [.operatorName], maximumUTF8Bytes: 32,
               adifField: my ? .myName : .name),
         .init(id: "state", label: "State", acceptedKinds: [.subdivision], maximumUTF8Bytes: 8,
               adifField: my ? .myState : .state)]
    }
}
