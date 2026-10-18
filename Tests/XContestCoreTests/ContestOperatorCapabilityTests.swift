import Foundation
import XCTest
@testable import XContestCore

final class ContestOperatorCapabilityTests: XCTestCase {
    private let sessionID = UUID(uuidString: "a1000000-0000-4000-8000-000000000001")!
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let canada = ContestEntitySnapshot(adif: 1, name: "CANADA", countryPrefix: "VE", continent: "NA", cqZone: 4)
    private let slovakia = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let australia = ContestEntitySnapshot(adif: 150, name: "AUSTRALIA", countryPrefix: "VK", continent: "OC", cqZone: 30)
    private let sweden = ContestEntitySnapshot(adif: 284, name: "SWEDEN", countryPrefix: "SM", continent: "EU", cqZone: 14)
    private let japan = ContestEntitySnapshot(adif: 339, name: "JAPAN", countryPrefix: "JA", continent: "AS", cqZone: 25)

    func testOnlyReviewedCWAndSSBRulesPublishUniqueBoundCapabilities() throws {
        let reviewed: [any ContestRule] = [
            CQWWCWRule(), CQWPXCWRule(), CQWWSSBRule(), CQWPXSSBRule(),
            OceaniaDXCWRule(), OceaniaDXSSBRule(), SACCWRule(), SACSSBRule(),
            NAQPCWRule(), NAQPSSBRule(), JIDXCWRule(), JIDXSSBRule(), ARRLDXCWRule(), ARRLDXSSBRule(),
        ]
        let capabilities = try reviewed.map { rule -> ContestOperatorCapability in
            let capable = try XCTUnwrap(rule as? any ContestOperatorCapableRule)
            let capability = try capable.operatorCapability()
            XCTAssertEqual(capability.version, 1)
            XCTAssertEqual(capability.policy, "simulated-run-sp-v1")
            XCTAssertEqual(capability.output, "simulation-only")
            XCTAssertEqual(capability.auditDigest.count, 64)
            return capability
        }
        XCTAssertEqual(Set(capabilities.map(\.auditDigest)).count, 14)
        XCTAssertNil(NAQPRTTYRule() as? any ContestOperatorCapableRule)
        XCTAssertNil(ARRLRTTYRoundupRule() as? any ContestOperatorCapableRule)
    }

    func testSerialReadinessSeparatesCQCallReservationCommitAndDuplicate() throws {
        let rule = CQWPXCWRule()
        let missingCall = issue("invalidCallsign", "callsign")
        let missingPrefix = issue("invalidWPXPrefix", "callsign")
        let missingSent = issue("invalidSentSerial", "exchange.sent")
        let missingReceived = issue("invalidReceivedSerial", "exchange.received")

        let blank = qso(call: "", sent: "", received: "")
        let blankReadiness = try rule.operatorReadiness(for: blank,
            validation: [missingCall, missingPrefix, missingSent, missingReceived], duplicate: nil, hasReservation: false)
        XCTAssertTrue(blankReadiness.canSendCQ)
        XCTAssertFalse(blankReadiness.canSendCall)

        let callOnly = qso(call: "K1ABC", sent: "", received: "")
        let callReadiness = try rule.operatorReadiness(for: callOnly,
            validation: [missingSent, missingReceived], duplicate: false, hasReservation: false)
        XCTAssertEqual(callReadiness.callsign, .ready)
        XCTAssertEqual(callReadiness.exchange, .empty)
        XCTAssertTrue(callReadiness.canSendCall)
        XCTAssertTrue(callReadiness.canReserveCall)
        XCTAssertFalse(callReadiness.canCommit)

        let copied = qso(call: "K1ABC", sent: "", received: "123")
        let copiedReadiness = try rule.operatorReadiness(for: copied,
            validation: [missingSent], duplicate: false, hasReservation: false)
        XCTAssertTrue(copiedReadiness.canReserveCommit)
        XCTAssertFalse(copiedReadiness.canCommit)

        let reserved = qso(call: "K1ABC", sent: "001", received: "123")
        let reservedReadiness = try rule.operatorReadiness(for: reserved,
            validation: [], duplicate: false, hasReservation: true)
        XCTAssertTrue(reservedReadiness.canCommit)
        let duplicate = try rule.operatorReadiness(for: reserved,
            validation: [], duplicate: true, hasReservation: true)
        XCTAssertTrue(duplicate.canSendDuplicate)
        XCTAssertFalse(duplicate.canCommit)
    }

    func testUnrelatedValidationFailureCannotBeWhitelistedAsMissingInput() throws {
        let rule = CQWWCWRule()
        let contact = qso(call: "K1ABC", sent: "15", received: "")
        let unknownReceived = try rule.operatorReadiness(for: contact,
            validation: [issue("unexpectedMissingCode", "exchange.received")],
            duplicate: false, hasReservation: false)
        XCTAssertEqual(unknownReceived.callsign, .blocked)
        XCTAssertFalse(unknownReceived.canSendCall)
        XCTAssertFalse(unknownReceived.canCommit)

        let blank = qso(call: "", sent: "15", received: "")
        let unknownCall = try rule.operatorReadiness(for: blank,
            validation: [issue("unreviewedMissingCall", "callsign")],
            duplicate: nil, hasReservation: false)
        XCTAssertFalse(unknownCall.canSendCQ)
        let unknownEntity = try rule.operatorReadiness(for: blank,
            validation: [issue("unreviewedMissingEntity", "entity")],
            duplicate: nil, hasReservation: false)
        XCTAssertFalse(unknownEntity.canSendCQ)
    }

    func testAllReviewedFamiliesDeriveEachOperatorPhaseFromTheirRuleValidation() throws {
        let fixtures = try operatorFixtures()
        XCTAssertEqual(fixtures.count, 14)
        for fixture in fixtures {
            let rule = fixture.rule
            let serial = rule.metadata.entry.serial.requirement == .requiredForCommit
            let blank = phaseQSO(from: fixture.complete, callsign: "", includeReceived: false,
                                 includeReservedSerial: false, serialRequired: serial)
            let blankValidation = try validation(rule: rule, qso: blank, session: fixture.session)
            XCTAssertFalse(rule.validateDraft(draft(from: blank), in: fixture.session).contains { $0.severity == .error },
                           "\(rule.metadata.identity.id) blank draft persistence")
            XCTAssertNil(rule.partialDraftDupeKey(for: blank, in: fixture.session,
                                                  validation: blankValidation))
            let blankReadiness = try rule.operatorReadiness(for: blank, validation: blankValidation,
                                                             duplicate: nil, hasReservation: false)
            XCTAssertTrue(blankReadiness.canSendCQ, "\(rule.metadata.identity.id) CQ")
            XCTAssertFalse(blankReadiness.canSendCall, "\(rule.metadata.identity.id) blank call")

            let callFirst = phaseQSO(from: fixture.complete, callsign: fixture.complete.callsign,
                                     includeReceived: false, includeReservedSerial: false, serialRequired: serial)
            let callValidation = try validation(rule: rule, qso: callFirst, session: fixture.session)
            XCTAssertFalse(rule.validateDraft(draft(from: callFirst), in: fixture.session).contains { $0.severity == .error },
                           "\(rule.metadata.identity.id) call-first draft persistence")
            XCTAssertNotNil(rule.partialDraftDupeKey(for: callFirst, in: fixture.session,
                                                     validation: callValidation),
                            "\(rule.metadata.identity.id) partial duplicate key")
            let callReadiness = try rule.operatorReadiness(for: callFirst, validation: callValidation,
                                                            duplicate: false, hasReservation: false)
            XCTAssertTrue(callReadiness.canSendCall, "\(rule.metadata.identity.id) call-first")
            XCTAssertEqual(callReadiness.canReserveCall, serial, "\(rule.metadata.identity.id) reservation")
            XCTAssertFalse(callReadiness.canCommit, "\(rule.metadata.identity.id) incomplete commit")

            let completeValidation = try validation(rule: rule, qso: fixture.complete, session: fixture.session)
            XCTAssertFalse(completeValidation.contains { $0.severity == .error }, "\(rule.metadata.identity.id) complete validation")
            XCTAssertFalse(rule.validateDraft(draft(from: fixture.complete), in: fixture.session).contains { $0.severity == .error },
                           "\(rule.metadata.identity.id) complete draft persistence")
            let completeKey = try XCTUnwrap(rule.evaluate(fixture.complete, in: fixture.session).dupeKey,
                                            "\(rule.metadata.identity.id) complete duplicate key")
            XCTAssertFalse(completeKey.isEmpty)
            let completeReadiness = try rule.operatorReadiness(for: fixture.complete,
                validation: completeValidation, duplicate: false, hasReservation: serial)
            XCTAssertTrue(completeReadiness.canCommit, "\(rule.metadata.identity.id) complete commit")
            let duplicateReadiness = try rule.operatorReadiness(for: fixture.complete,
                validation: completeValidation, duplicate: true, hasReservation: serial)
            XCTAssertTrue(duplicateReadiness.canSendDuplicate, "\(rule.metadata.identity.id) duplicate")
            XCTAssertFalse(duplicateReadiness.canCommit, "\(rule.metadata.identity.id) duplicate commit")
        }
    }

    private struct OperatorFixture {
        let rule: any ContestOperatorCapableRule
        let session: ContestSessionSnapshot
        let complete: ContestQSO
    }

    private func operatorFixtures() throws -> [OperatorFixture] {
        let rules: [any ContestOperatorCapableRule] = [
            CQWWCWRule(), CQWWSSBRule(), CQWPXCWRule(), CQWPXSSBRule(),
            OceaniaDXCWRule(), OceaniaDXSSBRule(), SACCWRule(), SACSSBRule(),
            NAQPCWRule(), NAQPSSBRule(), JIDXCWRule(), JIDXSSBRule(), ARRLDXCWRule(), ARRLDXSSBRule(),
        ]
        return try rules.map(operatorFixture)
    }

    private func operatorFixture(_ rule: any ContestOperatorCapableRule) throws -> OperatorFixture {
        let id = rule.metadata.identity.id
        let stationCall: String
        let stationEntity: ContestEntitySnapshot
        let remoteCall: String
        let remoteEntity: ContestEntitySnapshot
        let sent: String
        let received: String
        let sentFields: [String: ContestExchangeFieldValue]
        let receivedFields: [String: ContestExchangeFieldValue]
        let location: String
        switch id {
        case "cq-ww-cw", "cq-ww-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("OM0RX", slovakia, "K1ABC", usa)
            (sent, received, sentFields, receivedFields, location) = ("15", "05", [:], [:], "DX")
        case "cq-wpx-cw", "cq-wpx-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("OM0RX", slovakia, "K1ABC", usa)
            (sent, received, sentFields, receivedFields, location) = ("001", "123", [:], [:], "DX")
        case "oceania-dx-cw", "oceania-dx-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("VK1ZZZ", australia, "OM0RX", slovakia)
            (sent, received, sentFields, receivedFields, location) = ("001", "123", [:], [:], "DX")
        case "sac-cw", "sac-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("SM0AAA", sweden, "K1ABC", usa)
            (sent, received, sentFields, receivedFields, location) = ("001", "123", [:], [:], "DX")
        case "naqp-cw", "naqp-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("K1AAA", usa, "VE3AAA", canada)
            sentFields = fields(["name": "AL", "location": "CA"])
            receivedFields = fields(["name": "BOB", "location": "ON"])
            (sent, received, location) = ("AL CA", "BOB ON", "CA")
        case "jidx-cw", "jidx-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("OM0RX", slovakia, "JA1AAA", japan)
            sentFields = fields(["number": "15"]); receivedFields = fields(["number": "13"])
            (sent, received, location) = ("15", "13", "DX")
        case "arrl-dx-cw", "arrl-dx-ssb":
            (stationCall, stationEntity, remoteCall, remoteEntity) = ("OM0RX", slovakia, "K1ABC", usa)
            sentFields = fields(["power": "100"]); receivedFields = fields(["location": "CA"])
            (sent, received, location) = ("100", "CA", "DX")
        default:
            XCTFail("Missing operator fixture for reviewed rule \(id)")
            throw OperatorFixtureError.missingRule(id)
        }
        let session = ContestSessionSnapshot(id: sessionID,
            workspaceGeneration: UUID(uuidString: "a1000000-0000-4000-8000-000000000002")!,
            rule: rule.metadata.identity, referenceDataVersion: "cty-fixture", startedAt: Date(timeIntervalSince1970: 1_700_000_000),
            station: .init(callsign: stationCall, entity: stationEntity, sentExchange: sent,
                           operatorCallsigns: [stationCall], location: location, sentExchangeFields: sentFields))
        let report = rule.metadata.entry.report.defaultSent
        let complete = ContestQSO(id: UUID(), sessionID: sessionID,
            timestampUTC: Date(timeIntervalSince1970: 1_700_000_001), callsign: remoteCall, band: "20m",
            mode: rule.metadata.entry.mode, frequencyHz: rule.metadata.entry.mode == "SSB" ? 14_250_000 : 14_025_000,
            rstSent: report, rstReceived: rule.metadata.entry.report.defaultReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                            normalizedReceived: received, sentFields: sentFields, receivedFields: receivedFields),
            entity: remoteEntity, operatorCallsign: stationCall, stationLocation: location,
            provenance: .init(source: .operatorEntry))
        return .init(rule: rule, session: session, complete: complete)
    }

    private func phaseQSO(from complete: ContestQSO, callsign: String, includeReceived: Bool,
                          includeReservedSerial: Bool, serialRequired: Bool) -> ContestQSO {
        let sent = serialRequired && !includeReservedSerial ? "" : complete.exchange.rawSent
        let sentFields = serialRequired && !includeReservedSerial ? [:] : complete.exchange.sentFields
        return ContestQSO(id: complete.id, sessionID: complete.sessionID, timestampUTC: complete.timestampUTC,
            callsign: callsign, band: complete.band, mode: complete.mode, frequencyHz: complete.frequencyHz,
            rstSent: complete.rstSent, rstReceived: complete.rstReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent,
                            rawReceived: includeReceived ? complete.exchange.rawReceived : "",
                            normalizedReceived: includeReceived ? complete.exchange.normalizedReceived : "",
                            sentFields: sentFields, receivedFields: includeReceived ? complete.exchange.receivedFields : [:]),
            entity: callsign.isEmpty ? nil : complete.entity, operatorCallsign: complete.operatorCallsign,
            stationLocation: complete.stationLocation, provenance: complete.provenance)
    }

    private func validation(rule: any ContestOperatorCapableRule, qso: ContestQSO,
                            session: ContestSessionSnapshot) throws -> [ContestValidationIssue] {
        try ContestEngine.evaluate(qso, session: session, rule: rule, allowIncomplete: false).validation
    }

    private func draft(from qso: ContestQSO) -> ContestDraftSnapshot {
        .init(id: qso.id, sessionID: qso.sessionID, revision: 1, updatedAt: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived, exchange: qso.exchange,
              entity: qso.entity, operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation)
    }

    private func fields(_ values: [String: String]) -> [String: ContestExchangeFieldValue] {
        values.mapValues { .init(raw: $0, normalized: $0) }
    }

    private enum OperatorFixtureError: Error {
        case missingRule(String)
    }

    private func issue(_ code: String, _ field: String) -> ContestValidationIssue {
        .init(code: code, field: field, message: code)
    }

    private func qso(call: String, sent: String, received: String) -> ContestQSO {
        ContestQSO(id: UUID(), sessionID: sessionID, timestampUTC: Date(timeIntervalSince1970: 1_700_000_000),
                   callsign: call, band: "20m", mode: "CW", frequencyHz: 14_025_000,
                   rstSent: "599", rstReceived: "599",
                   exchange: .init(rawSent: sent, normalizedSent: sent,
                                   rawReceived: received, normalizedReceived: received),
                   entity: call.isEmpty ? nil : usa, operatorCallsign: "OM0RX",
                   provenance: .init(source: .operatorEntry))
    }
}
