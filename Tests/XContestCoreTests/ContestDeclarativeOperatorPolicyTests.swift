import Foundation
import XCTest
@testable import XContestCore

final class ContestDeclarativeOperatorPolicyTests: XCTestCase {
    private let sessionID = UUID(uuidString: "d2000000-0000-4000-8000-000000000001")!
    private let generation = UUID(uuidString: "d2000000-0000-4000-8000-000000000002")!
    private let date = Date(timeIntervalSince1970: 1_700_000_000)

    func testSevenDefinitionsBindFinitePolicyAndEverySupportedMode() throws {
        let rules = try operatorRules()
        XCTAssertEqual(rules.count, 7)
        for rule in rules {
            let policy = try XCTUnwrap(rule.definition.draft.operatorPolicy)
            XCTAssertEqual(policy.version, 1)
            XCTAssertEqual(policy.policy, "simulated-run-sp-v1")
            XCTAssertEqual(policy.output, "simulation-only")
            XCTAssertEqual(policy.signalProfiles.map(\.mode), rule.definition.draft.supportedModes.sorted())
            for profile in policy.signalProfiles {
                XCTAssertEqual(profile.signal, profile.mode == "CW" ? .cw : .phone)
            }
            let capability = try XCTUnwrap(try ContestOperatorProjection.capability(for: rule))
            XCTAssertEqual(capability.auditDigest, rule.definition.definitionDigest)
        }
    }

    func testUnknownPolicyVersionAndModeMappingRejectInsteadOfBecomingInert() throws {
        let draft = TenTenDeclarativeDefinitions.archiveDraft(for: .winterPhone)
        XCTAssertThrowsError(try decode(draft) { policy in policy["version"] = 2 })
        XCTAssertThrowsError(try decode(draft) { policy in policy["policy"] = "future-run-sp-v2" })
        XCTAssertThrowsError(try decode(draft) { policy in policy["futureConstraint"] = true })
        XCTAssertThrowsError(try decode(draft) { policy in
            var profiles = policy["signalProfiles"] as! [[String: Any]]
            profiles[0]["futureSignalConstraint"] = true
            policy["signalProfiles"] = profiles
        })

        let wrong = copy(draft, policy: .init(signalProfiles: [
            .init(mode: "AM", signal: .phone), .init(mode: "FM", signal: .phone),
            .init(mode: "SSB", signal: .cw),
        ]))
        XCTAssertThrowsError(try wrong.materialized())
        let missing = copy(draft, policy: .init(signalProfiles: [.init(mode: "SSB", signal: .phone)]))
        XCTAssertThrowsError(try missing.materialized())
    }

    func testNilPolicyPreservesCanonicalBytesDigestAndOldSessionInertness() throws {
        let current = CWUniqueCallDeclarativeDefinitions.archiveDraft(for: .cwt)
        let legacyDraft = copy(current, policy: nil)
        let legacy = try legacyDraft.materialized()
        XCTAssertEqual(legacy.definitionDigest, "9d2b3531d6e912444772ec155cb9b3e9ec3ab15e1fe462ca7a7a9b0827d659ca")
        let bytes = try legacy.canonicalStorageData()
        XCTAssertFalse(String(decoding: bytes, as: UTF8.self).contains("operatorPolicy"))
        let reopened = try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: bytes)
        XCTAssertEqual(reopened.definitionDigest, legacy.definitionDigest)
        XCTAssertNil(reopened.draft.operatorPolicy)
        XCTAssertNil(try ContestOperatorProjection.capability(for: DeclarativeContestRule(definition: reopened)))

        let currentDefinition = try current.materialized()
        XCTAssertNotEqual(currentDefinition.definitionDigest, legacy.definitionDigest)
        XCTAssertNotNil(try ContestOperatorProjection.capability(
            for: DeclarativeContestRule(definition: currentDefinition)))
    }

    func testEveryDeclarativeModeDerivesBlankCallReserveCommitAndDuplicateReadiness() throws {
        let rules = try operatorRules()
        var exercised: Set<String> = []
        for rule in rules {
            for profile in rule.metadata.entry.modeProfiles {
                exercised.insert("\(rule.metadata.identity.id):\(profile.mode)")
                let fixture = makeFixture(rule: rule, mode: profile.mode)
                let blank = phase(fixture.complete, callsign: "", includeReceived: false,
                                  includeSerial: false, rule: rule)
                let blankValidation = try validation(rule, blank, fixture.session)
                let blankReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
                    for: rule, qso: blank, validation: blankValidation,
                    duplicate: nil, hasReservation: false))
                XCTAssertTrue(blankReadiness.canSendCQ, "\(rule.metadata.identity.id):\(profile.mode) CQ")

                let call = phase(fixture.complete, callsign: fixture.complete.callsign,
                                 includeReceived: false, includeSerial: false, rule: rule)
                let callValidation = try validation(rule, call, fixture.session)
                XCTAssertNotNil(rule.partialDraftDupeKey(for: call, in: fixture.session,
                                                         validation: callValidation))
                let callReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
                    for: rule, qso: call, validation: callValidation,
                    duplicate: false, hasReservation: false))
                XCTAssertTrue(callReadiness.canSendCall, "\(rule.metadata.identity.id):\(profile.mode) call")
                let serial = rule.metadata.entry.serial.requirement == .requiredForCommit
                XCTAssertEqual(callReadiness.canReserveCall, serial,
                               "\(rule.metadata.identity.id):\(profile.mode) reserve")
                XCTAssertFalse(callReadiness.canCommit)

                let completeValidation = try validation(rule, fixture.complete, fixture.session)
                XCTAssertFalse(completeValidation.contains { $0.severity == .error })
                let complete = try XCTUnwrap(try ContestOperatorProjection.readiness(
                    for: rule, qso: fixture.complete, validation: completeValidation,
                    duplicate: false, hasReservation: serial))
                XCTAssertTrue(complete.canCommit)
                let duplicate = try XCTUnwrap(try ContestOperatorProjection.readiness(
                    for: rule, qso: fixture.complete, validation: completeValidation,
                    duplicate: true, hasReservation: serial))
                XCTAssertTrue(duplicate.canSendDuplicate)
                XCTAssertFalse(duplicate.canCommit)
            }
        }
        XCTAssertEqual(exercised.count, 11)
    }

    func testSerialWithStationNameCanReserveButMalformedNonemptyInputsRemainBlocked() throws {
        let rule = try CWUniqueCallDeclarativeDefinitions.archiveRule(for: .cwOpen)
        let fixture = makeFixture(rule: rule, mode: "CW")
        let call = phase(fixture.complete, callsign: fixture.complete.callsign,
                         includeReceived: false, includeSerial: false, rule: rule)
        XCTAssertFalse(call.exchange.rawSent.isEmpty)
        let missingValidation = try validation(rule, call, fixture.session)
        XCTAssertTrue(missingValidation.contains {
            $0.code == "missingStructuredExchangeField" && $0.field == "exchange.sent.serial"
        })
        let ready = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: call, validation: missingValidation,
            duplicate: false, hasReservation: false))
        XCTAssertTrue(ready.canReserveCall)

        var malformedSent = call.exchange.sentFields
        malformedSent["serial"] = .init(raw: "BAD", normalized: "BAD")
        let malformed = replacing(call, sentFields: malformedSent,
                                  rawSent: aggregate(malformedSent, rule.metadata.entry.exchange.sentFields))
        let malformedReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: malformed, validation: try validation(rule, malformed, fixture.session),
            duplicate: false, hasReservation: false))
        XCTAssertFalse(malformedReadiness.canReserveCall)
        XCTAssertFalse(malformedReadiness.canSendCall)

        let unknown = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: call,
            validation: [.init(code: "futureMissingField", field: "exchange.received.name", message: "future")],
            duplicate: false, hasReservation: false))
        XCTAssertFalse(unknown.canSendCall)
        XCTAssertFalse(unknown.canReserveCall)

        let unknownField = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: call,
            validation: [.init(code: "missingStructuredExchangeField",
                               field: "exchange.received.future-field", message: "future")],
            duplicate: false, hasReservation: false))
        XCTAssertFalse(unknownField.canSendCall)
        XCTAssertFalse(unknownField.canReserveCall)

        let nestedUnknownField = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: call,
            validation: [.init(code: "missingStructuredExchangeField",
                               field: "exchange.received.future.name", message: "future")],
            duplicate: false, hasReservation: false))
        XCTAssertFalse(nestedUnknownField.canSendCall)
        XCTAssertFalse(nestedUnknownField.canReserveCall)

        var ambiguousFields = call.exchange.receivedFields
        ambiguousFields["name"] = .init(raw: "", normalized: "AL")
        let ambiguous = replacing(call, receivedFields: ambiguousFields)
        let ambiguousReadiness = try XCTUnwrap(try ContestOperatorProjection.readiness(
            for: rule, qso: ambiguous,
            validation: [.init(code: "missingStructuredExchangeField",
                               field: "exchange.received.name", message: "missing")],
            duplicate: false, hasReservation: false))
        XCTAssertFalse(ambiguousReadiness.canSendCall)
        XCTAssertFalse(ambiguousReadiness.canReserveCall)
    }

    private struct Fixture { let session: ContestSessionSnapshot; let complete: ContestQSO }

    private func operatorRules() throws -> [DeclarativeContestRule] {
        try CWUniqueCallContestVariant.allCases.map {
            try CWUniqueCallDeclarativeDefinitions.archiveRule(for: $0)
        } + TenTenSeasonalVariant.allCases.map {
            try TenTenDeclarativeDefinitions.archiveRule(for: $0)
        }
    }

    private func decode(_ draft: ContestDefinitionDraft,
                        mutate: (inout [String: Any]) -> Void) throws -> ContestDefinitionDraft {
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(draft)) as? [String: Any])
        var policy = try XCTUnwrap(object["operatorPolicy"] as? [String: Any])
        mutate(&policy)
        object["operatorPolicy"] = policy
        return try JSONDecoder().decode(ContestDefinitionDraft.self,
                                        from: JSONSerialization.data(withJSONObject: object))
    }

    private func makeFixture(rule: DeclarativeContestRule, mode: String) -> Fixture {
        let entry = rule.metadata.entry
        let stationFields = values(entry.exchange.sentFields.filter { $0.id != entry.allocatedSerialField?.id }, sent: true)
        var sentFields = stationFields
        if let serial = entry.allocatedSerialField { sentFields[serial.id] = .init(raw: "001", normalized: "001") }
        let receivedFields = values(entry.exchange.receivedFields, sent: false)
        let sent = aggregate(sentFields, entry.exchange.sentFields)
        let stationSent = aggregate(stationFields, entry.exchange.sentFields.filter { $0.id != entry.allocatedSerialField?.id })
        let received = aggregate(receivedFields, entry.exchange.receivedFields)
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
            rule: rule.metadata.identity, referenceDataVersion: "declarative-policy-fixture", startedAt: date,
            station: .init(callsign: "OM0RX", entity: nil, sentExchange: stationSent,
                           operatorCallsigns: ["OM0RX"], location: "", sentExchangeFields: stationFields))
        let profile = entry.modeProfile(for: mode)!
        let band = rule.metadata.supportedBands.contains("20m") ? "20m" : "10m"
        let frequency: Int64 = band == "10m" ? (mode == "CW" ? 28_050_000 : 28_500_000) : 14_025_000
        let qso = ContestQSO(id: UUID(), sessionID: sessionID, timestampUTC: date,
            callsign: "K1ABC", band: band, mode: mode, frequencyHz: frequency,
            rstSent: profile.report.defaultSent, rstReceived: profile.report.defaultReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent, rawReceived: received,
                            normalizedReceived: received, sentFields: sentFields,
                            receivedFields: receivedFields), entity: nil,
            operatorCallsign: "OM0RX", stationLocation: "", provenance: .init(source: .operatorEntry))
        return .init(session: session, complete: qso)
    }

    private func phase(_ qso: ContestQSO, callsign: String, includeReceived: Bool,
                       includeSerial: Bool, rule: DeclarativeContestRule) -> ContestQSO {
        var sentFields = qso.exchange.sentFields
        if !includeSerial, let serial = rule.metadata.entry.allocatedSerialField { sentFields.removeValue(forKey: serial.id) }
        let receivedFields = includeReceived ? qso.exchange.receivedFields : [:]
        return ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
            callsign: callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
            rstSent: qso.rstSent, rstReceived: qso.rstReceived,
            exchange: .init(rawSent: aggregate(sentFields, rule.metadata.entry.exchange.sentFields),
                            normalizedSent: aggregate(sentFields, rule.metadata.entry.exchange.sentFields),
                            rawReceived: aggregate(receivedFields, rule.metadata.entry.exchange.receivedFields),
                            normalizedReceived: aggregate(receivedFields, rule.metadata.entry.exchange.receivedFields),
                            sentFields: sentFields, receivedFields: receivedFields), entity: nil,
            operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation,
            provenance: qso.provenance)
    }

    private func validation(_ rule: DeclarativeContestRule, _ qso: ContestQSO,
                            _ session: ContestSessionSnapshot) throws -> [ContestValidationIssue] {
        try ContestEngine.evaluate(qso, session: session, rule: rule, allowIncomplete: false).validation
    }

    private func values(_ descriptors: [ContestExchangeFieldDescriptor], sent: Bool) -> [String: ContestExchangeFieldValue] {
        Dictionary(uniqueKeysWithValues: descriptors.map { descriptor in
            let value: String
            switch descriptor.id {
            case "name": value = sent ? "OLIVER" : "AL"
            case "member-or-location": value = sent ? "1234" : "CA"
            case "serial": value = sent ? "001" : "123"
            case "member-number": value = sent ? "12345" : "67890"
            case "qth": value = sent ? "AUSTRALIA" : "USA"
            default: value = "1"
            }
            return (descriptor.id, .init(raw: value, normalized: value))
        })
    }

    private func aggregate(_ values: [String: ContestExchangeFieldValue],
                           _ descriptors: [ContestExchangeFieldDescriptor]) -> String {
        descriptors.compactMap { values[$0.id]?.normalized }.joined(separator: " ")
    }

    private func replacing(_ qso: ContestQSO, sentFields: [String: ContestExchangeFieldValue],
                           rawSent: String) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
            callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
            rstSent: qso.rstSent, rstReceived: qso.rstReceived,
            exchange: .init(rawSent: rawSent, normalizedSent: rawSent,
                            rawReceived: qso.exchange.rawReceived,
                            normalizedReceived: qso.exchange.normalizedReceived,
                            sentFields: sentFields, receivedFields: qso.exchange.receivedFields),
            entity: qso.entity, operatorCallsign: qso.operatorCallsign,
            stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func replacing(_ qso: ContestQSO,
                           receivedFields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
            callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
            rstSent: qso.rstSent, rstReceived: qso.rstReceived,
            exchange: .init(rawSent: qso.exchange.rawSent, normalizedSent: qso.exchange.normalizedSent,
                            rawReceived: qso.exchange.rawReceived,
                            normalizedReceived: qso.exchange.normalizedReceived,
                            sentFields: qso.exchange.sentFields, receivedFields: receivedFields),
            entity: qso.entity, operatorCallsign: qso.operatorCallsign,
            stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func copy(_ draft: ContestDefinitionDraft,
                      policy: ContestDeclarativeOperatorPolicy?) -> ContestDefinitionDraft {
        .init(id: draft.id, version: draft.version, edition: draft.edition,
              displayName: draft.displayName, cabrilloName: draft.cabrilloName,
              supportedBands: draft.supportedBands, supportedModes: draft.supportedModes,
              entry: draft.entry, sourceProvenance: draft.sourceProvenance,
              dupePolicy: draft.dupePolicy, multiplierPolicy: draft.multiplierPolicy,
              scoring: draft.scoring, eligibilityPolicy: draft.eligibilityPolicy,
              exportPolicy: draft.exportPolicy, exportProjection: draft.exportProjection,
              operatorPolicy: policy, stationEntityRequired: draft.stationEntityRequired,
              adapterID: draft.adapterID)
    }
}
