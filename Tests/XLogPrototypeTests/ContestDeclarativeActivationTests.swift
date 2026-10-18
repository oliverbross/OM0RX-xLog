import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class ContestDeclarativeActivationTests: XCTestCase {
    private let generation = "d1111111-2222-4333-8444-555555555555"
    private let timestamp = "2026-10-18T03:00:00.000Z"

    func testSevenDefinitionsShareCatalogCreateDupeCorrectionRestartAndExports() async throws {
        let definitions = try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries()
        XCTAssertEqual(definitions.count, 7)
        var clientFixtureCases: [[String: Any]] = []
        var operatorProfileFixtures: [[String: Any]] = []
        var nondefaultModeCommitFixture: [String: Any]?
        for (offset, definition) in definitions.enumerated() {
            let root = FileManager.default.temporaryDirectory
                .appendingPathComponent("xlog-declarative-activation-\(offset)-\(UUID().uuidString)")
            defer { try? FileManager.default.removeItem(at: root) }
            let databaseURL = root.appendingPathComponent("Contesting/contests.sqlite")
            var lane: ContestLane? = try ContestLane(databaseURL: databaseURL) { [generation] in generation }
            let catalog = try await lane!.handle(method: "contest_catalog", params: [:])
            let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
            XCTAssertEqual(rules.count, 23)
            let rule = try XCTUnwrap(rules.first { identityID($0) == definition.identity.id })
            let definitionWire = try XCTUnwrap(rule["declarativeDefinition"] as? [String: Any])
            XCTAssertEqual(definitionWire["definitionDigest"] as? String, definition.definitionDigest)
            XCTAssertEqual(definitionWire["exportPurpose"] as? String, "operatorArchive")
            XCTAssertEqual(definitionWire["submissionReady"] as? Bool, false)
            XCTAssertEqual(definitionWire["immutablePerSession"] as? Bool, true)
            XCTAssertEqual(Set(try XCTUnwrap(rule["supportedBands"] as? [String])), definition.definition.draft.supportedBands)
            XCTAssertEqual(Set(try XCTUnwrap(rule["supportedModes"] as? [String])), definition.definition.draft.supportedModes)
            let capability = try XCTUnwrap(rule["operatorCapability"] as? [String: Any])
            XCTAssertEqual(capability["auditDigest"] as? String, definition.definitionDigest)
            let profiles = try XCTUnwrap(capability["signalProfiles"] as? [[String: String]])
            XCTAssertEqual(profiles.map { $0["mode"]! }, definition.definition.draft.supportedModes.sorted())
            XCTAssertEqual(profiles.map { $0["signal"]! }, definition.definition.draft.supportedModes.sorted().map {
                $0 == "CW" ? "cw" : "phone"
            })

            let sessionID = UUID(), draftID = UUID()
            let created = try await lane!.handle(method: "contest_create", params: mutation(
                sessionID: sessionID, requestID: draftID, revision: 0, timestamp: timestamp,
                payload: createPayload(rule: rule, definition: definition, sessionID: sessionID)))
            let createdRule = try XCTUnwrap((created["session"] as? [String: Any])?["rule"] as? [String: Any])
            XCTAssertEqual(((createdRule["declarativeDefinition"] as? [String: Any])?["definitionDigest"] as? String),
                           definition.definitionDigest)
            let createdDraft = try XCTUnwrap(created["draft"] as? [String: Any])
            XCTAssertEqual((createdDraft["operatorReadiness"] as? [String: Any])?["capabilityDigest"] as? String,
                           definition.definitionDigest)
            operatorProfileFixtures.append([
                "definitionID": definition.identity.id,
                "catalogRule": rule,
                "session": try XCTUnwrap(created["session"] as? [String: Any]),
                "draft": createdDraft,
            ])

            var revision = 1
            var firstQSOID: String?
            for contactIndex in 0..<2 {
                var sent = stationFields(for: definition.identity.id)
                if definition.definition.draft.entry.serial.requirement == .requiredForCommit {
                    let reserved = try await lane!.handle(method: "contest_serial_reserve", params: mutation(
                        sessionID: sessionID, requestID: UUID(), revision: revision,
                        timestamp: time(offset * 10 + contactIndex * 3 + 1), payload: [:], draftID: draftID))
                    revision += 1
                    let serial = try XCTUnwrap(((reserved["draft"] as? [String: Any])?["reservedSerial"] as? NSNumber)?.intValue)
                    sent["serial"] = String(format: "%03d", serial)
                }
                let exercisedMode = definition.identity.id == "ten-ten-winterPhone" ? "AM" : nil
                let received = definition.identity.id == "ten-ten-winterPhone" && contactIndex == 1
                    ? ["name": "AL", "member-number": "0", "qth": "NEW YORK"]
                    : receivedFields(for: definition.identity.id)
                let fields = try draftFields(rule: rule, definition: definition.definition,
                                             sent: sent, received: received,
                                             callsign: "K1ABC", mode: exercisedMode)
                let applied = try await lane!.handle(method: "contest_draft_apply", params: mutation(
                    sessionID: sessionID, requestID: UUID(), revision: revision,
                    timestamp: time(offset * 10 + contactIndex * 3 + 2), payload: ["fields": fields], draftID: draftID))
                revision += 1
                let commitParams = mutation(
                    sessionID: sessionID, requestID: UUID(), revision: revision,
                    timestamp: time(offset * 10 + contactIndex * 3 + 3), payload: [:], draftID: draftID)
                let committed = try await lane!.handle(method: "contest_qso_commit", params: commitParams)
                revision += 1
                let qso = try XCTUnwrap(committed["qso"] as? [String: Any])
                if definition.identity.id == "ten-ten-winterPhone", contactIndex == 0 {
                    XCTAssertEqual(qso["mode"] as? String, "AM")
                    nondefaultModeCommitFixture = [
                        "definitionID": definition.identity.id,
                        "session": try XCTUnwrap(applied["session"] as? [String: Any]),
                        "draftID": wireID(draftID),
                        "commitParams": commitParams,
                        "commitResult": committed,
                    ]
                }
                if contactIndex == 0 {
                    XCTAssertEqual(qso["isDupe"] as? Bool, false)
                    firstQSOID = qso["qsoID"] as? String
                } else {
                    XCTAssertEqual(qso["isDupe"] as? Bool, true)
                }
                XCTAssertEqual(((committed["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
            }

            lane = nil
            let reopened = try ContestLane(databaseURL: databaseURL) { [generation] in generation }
            let opened = try await reopened.handle(method: "contest_open", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            ])
            XCTAssertEqual(((opened["session"] as? [String: Any])?["revision"] as? NSNumber)?.intValue, revision)
            XCTAssertEqual(((((opened["session"] as? [String: Any])?["rule"] as? [String: Any])?["declarativeDefinition"] as? [String: Any])?["definitionDigest"] as? String), definition.definitionDigest)

            let qsoID = try XCTUnwrap(firstQSOID)
            let got = try await reopened.handle(method: "contest_qso_get", params: [
                "sessionID": wireID(sessionID), "workspaceGeneration": generation,
                "expectedRevision": revision, "qsoID": qsoID,
            ])
            var corrected = try XCTUnwrap(got["qso"] as? [String: Any])
            XCTAssertEqual(corrected["allocatedSerial"] as? String,
                           corrected["normalizedSentExchange"] as? String)
            XCTAssertEqual(Set(try XCTUnwrap(corrected["sentExchangeFields"] as? [String: String]).keys),
                           Set(definition.definition.draft.entry.exchange.sentFields.map(\.id)))
            XCTAssertEqual(Set(try XCTUnwrap(corrected["receivedExchangeFields"] as? [String: String]).keys),
                           Set(definition.definition.draft.entry.exchange.receivedFields.map(\.id)))
            corrected.removeValue(forKey: "entity")
            corrected["callsign"] = "N1NEW"
            if definition.identity.id == "ten-ten-winterPhone" {
                corrected["sentExchangeFields"] = ["name": "OLIVER", "member-number": "12345", "qth": "SLOVAKIA"]
                corrected["receivedExchangeFields"] = ["name": "AL", "member-number": "0", "qth": "NEW YORK"]
                corrected["sentExchange"] = "OLIVER 12345 SLOVAKIA"
                corrected["normalizedSentExchange"] = "OLIVER 12345 SLOVAKIA"
                corrected["allocatedSerial"] = "OLIVER 12345 SLOVAKIA"
                corrected["receivedExchange"] = "AL 0 NEW YORK"
                corrected["normalizedReceivedExchange"] = "AL 0 NEW YORK"
            }
            let correctionParams = mutation(
                sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: time(offset * 10 + 8), payload: ["qso": corrected, "reason": "Correct copied call"])
            let correction = try await reopened.handle(method: "contest_qso_correct", params: correctionParams)
            revision += 1
            XCTAssertEqual(((correction["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue,
                           definition.identity.id.hasPrefix("ten-ten-") ? 2 : 4)
            if definition.identity.id == "ten-ten-winterPhone" {
                nondefaultModeCommitFixture?["qsoSession"] = try XCTUnwrap(opened["session"] as? [String: Any])
                nondefaultModeCommitFixture?["qsoGet"] = got
                nondefaultModeCommitFixture?["correctionParams"] = correctionParams
                nondefaultModeCommitFixture?["correction"] = correction
            }
            if ["cwops-cwt", "cwops-open"].contains(definition.identity.id) {
                clientFixtureCases.append([
                    "definitionID": definition.identity.id,
                    "session": try XCTUnwrap(opened["session"] as? [String: Any]),
                    "qsoGet": got,
                    "correctionParams": correctionParams,
                    "correction": correction,
                ])
            }

            for format in ["cabrillo", "adif"] {
                let exportID = UUID()
                let prepareParams: [String: Any] = [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID),
                    "workspaceGeneration": generation, "expectedRevision": revision,
                    "generatedAtUTC": time(offset * 10 + 9), "format": format,
                    "header": exportHeader(mode: definition.definition.draft.entry.mode),
                ]
                let prepared = try await reopened.handle(method: "contest_export_prepare", params: prepareParams)
                XCTAssertEqual(prepared["declarativePurpose"] as? String, "operatorArchive")
                let byteLength = try XCTUnwrap((prepared["byteLength"] as? NSNumber)?.intValue)
                let readParams: [String: Any] = [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID),
                    "workspaceGeneration": generation, "offset": 0, "length": byteLength,
                ]
                let chunk = try await reopened.handle(method: "contest_export_read", params: readParams)
                let bytes = try XCTUnwrap(Data(base64Encoded: try XCTUnwrap(chunk["dataBase64"] as? String)))
                let text = try XCTUnwrap(String(data: bytes, encoding: .utf8))
                XCTAssertTrue(text.contains("N1NEW"), "\(definition.identity.id) \(format)")
                XCTAssertTrue(text.contains("K1ABC"), "\(definition.identity.id) \(format)")
                let releaseParams: [String: Any] = [
                    "exportID": wireID(exportID), "sessionID": wireID(sessionID),
                    "workspaceGeneration": generation,
                ]
                let released = try await reopened.handle(method: "contest_export_release", params: releaseParams)
                if definition.identity.id == "ten-ten-winterPhone" {
                    var exports = nondefaultModeCommitFixture?["exports"] as? [[String: Any]] ?? []
                    exports.append([
                        "format": format,
                        "prepareParams": prepareParams, "prepared": prepared,
                        "readParams": readParams, "chunk": chunk,
                        "releaseParams": releaseParams, "released": released,
                    ])
                    nondefaultModeCommitFixture?["exports"] = exports
                }
            }
        }
        XCTAssertEqual(clientFixtureCases.count, 2)
        XCTAssertNotNil(nondefaultModeCommitFixture)
        if let output = ProcessInfo.processInfo.environment["XLOG_DECLARATIVE_ACTIVATION_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = [
                "schemaVersion": 2,
                "generatedBy": "ContestDeclarativeActivationTests.testSevenDefinitionsShareCatalogCreateDupeCorrectionRestartAndExports",
                "operatorProfiles": operatorProfileFixtures,
                "cases": clientFixtureCases,
                "nondefaultModeCommit": try XCTUnwrap(nondefaultModeCommitFixture),
            ]
            let data = try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: URL(fileURLWithPath: output), options: .atomic)
        }
    }

    func testPersistedNilPolicySessionRemainsInertWhenCurrentCatalogOptsIn() async throws {
        let current = try XCTUnwrap(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries()
            .first { $0.identity.id == "cwops-cwt" })
        var object = try XCTUnwrap(JSONSerialization.jsonObject(
            with: JSONEncoder().encode(current.definition.draft)) as? [String: Any])
        object.removeValue(forKey: "operatorPolicy")
        let oldDraft = try JSONDecoder().decode(
            ContestDefinitionDraft.self, from: JSONSerialization.data(withJSONObject: object))
        let oldDefinition = try oldDraft.materialized()
        let oldEntry = try ContestDeclarativeCatalogEntry(definition: oldDefinition)
        XCTAssertNotEqual(oldEntry.identity, current.identity)

        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-declarative-inert-policy-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Contesting/contests.sqlite")
        var oldLane: ContestLane? = try ContestLane(
            databaseURL: databaseURL, generationSource: { [generation] in generation },
            declarativeDefinitions: [oldDefinition])
        let oldCatalog = try await oldLane!.handle(method: "contest_catalog", params: [:])
        let oldRule = try XCTUnwrap((oldCatalog["rules"] as? [[String: Any]])?.first {
            identityID($0) == oldEntry.identity.id
        })
        XCTAssertNil(oldRule["operatorCapability"])
        let sessionID = UUID(), draftID = UUID()
        let created = try await oldLane!.handle(method: "contest_create", params: mutation(
            sessionID: sessionID, requestID: draftID, revision: 0, timestamp: timestamp,
            payload: createPayload(rule: oldRule, definition: oldEntry, sessionID: sessionID)))
        XCTAssertNil(((created["session"] as? [String: Any])?["rule"] as? [String: Any])?["operatorCapability"])
        XCTAssertNil((created["draft"] as? [String: Any])?["operatorReadiness"])
        oldLane = nil

        let currentLane = try ContestLane(databaseURL: databaseURL) { [generation] in generation }
        let currentCatalog = try await currentLane.handle(method: "contest_catalog", params: [:])
        let currentRule = try XCTUnwrap((currentCatalog["rules"] as? [[String: Any]])?.first {
            identityID($0) == current.identity.id
        })
        XCTAssertNotNil(currentRule["operatorCapability"])
        let reopened = try await currentLane.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        XCTAssertNil(((reopened["session"] as? [String: Any])?["rule"] as? [String: Any])?["operatorCapability"])
        XCTAssertNil((reopened["draft"] as? [String: Any])?["operatorReadiness"])
    }

    func testDeclarativeCreateRequiresAuthoritativeDigestAndRequiredStationFields() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-declarative-admission-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let lane = try ContestLane(databaseURL: root.appendingPathComponent("Contesting/contests.sqlite")) { [generation] in generation }
        let catalog = try await lane.handle(method: "contest_catalog", params: [:])
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first { identityID($0) == "cwops-cwt" })
        let entry = try XCTUnwrap(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries().first { $0.identity.id == "cwops-cwt" })
        let sessionID = UUID()
        var payload = createPayload(rule: rule, definition: entry, sessionID: sessionID)
        payload.removeValue(forKey: "definitionDigest")
        await assertCreateError("definition_required", lane: lane, sessionID: sessionID, payload: payload)
        payload["definitionDigest"] = String(repeating: "0", count: 64)
        await assertCreateError("definition_mismatch", lane: lane, sessionID: sessionID, payload: payload)
        payload = createPayload(rule: rule, definition: entry, sessionID: sessionID)
        var station = try XCTUnwrap(payload["station"] as? [String: Any])
        station["exchangeFields"] = ["name": "OLIVER"]
        payload["station"] = station
        await assertCreateError("invalid_params", lane: lane, sessionID: sessionID, payload: payload)
        let sessions = try await lane.handle(method: "contest_sessions", params: [:])
        XCTAssertEqual((sessions["sessions"] as? [[String: Any]])?.count, 0)
    }

    func testCommittedCreateReplayAndOldSessionSurviveCatalogRemoval() async throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("xlog-declarative-version-replay-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let databaseURL = root.appendingPathComponent("Contesting/contests.sqlite")
        let entry = try XCTUnwrap(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries()
            .first { $0.identity.id == "cwops-cwt" })
        var firstLane: ContestLane? = try ContestLane(
            databaseURL: databaseURL, generationSource: { [generation] in generation },
            declarativeDefinitions: [entry.definition])
        let catalog = try await firstLane!.handle(method: "contest_catalog", params: [:])
        let rule = try XCTUnwrap((catalog["rules"] as? [[String: Any]])?.first { identityID($0) == "cwops-cwt" })
        let sessionID = UUID(), draftID = UUID()
        let createRequest = mutation(
            sessionID: sessionID, requestID: draftID, revision: 0, timestamp: timestamp,
            payload: createPayload(rule: rule, definition: entry, sessionID: sessionID))
        let first = try await firstLane!.handle(method: "contest_create", params: createRequest)
        firstLane = nil

        let advanced = try ContestLane(
            databaseURL: databaseURL, generationSource: { [generation] in generation },
            declarativeDefinitions: [])
        let advancedCatalog = try await advanced.handle(method: "contest_catalog", params: [:])
        XCTAssertNil((advancedCatalog["rules"] as? [[String: Any]])?.first { identityID($0) == "cwops-cwt" })
        let replay = try await advanced.handle(method: "contest_create", params: createRequest)
        XCTAssertEqual(try canonicalJSON(first), try canonicalJSON(replay))

        let opened = try await advanced.handle(method: "contest_open", params: [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
        ])
        let persistedRule = try XCTUnwrap((opened["session"] as? [String: Any])?["rule"] as? [String: Any])
        XCTAssertEqual(((persistedRule["declarativeDefinition"] as? [String: Any])?["definitionDigest"] as? String),
                       entry.definitionDigest)
        let fields = try draftFields(rule: persistedRule, definition: entry.definition,
                                     sent: stationFields(for: entry.identity.id),
                                     received: receivedFields(for: entry.identity.id), callsign: "K1ABC")
        _ = try await advanced.handle(method: "contest_draft_apply", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 1,
            timestamp: time(1), payload: ["fields": fields], draftID: draftID))
        let committed = try await advanced.handle(method: "contest_qso_commit", params: mutation(
            sessionID: sessionID, requestID: UUID(), revision: 2,
            timestamp: time(2), payload: [:], draftID: draftID))
        XCTAssertEqual(((committed["score"] as? [String: Any])?["claimedScore"] as? NSNumber)?.intValue, 1)
        let stillPinned = try XCTUnwrap((committed["session"] as? [String: Any])?["rule"] as? [String: Any])
        XCTAssertEqual(((stillPinned["declarativeDefinition"] as? [String: Any])?["definitionDigest"] as? String),
                       entry.definitionDigest)
    }

    func testDuplicateDeclarativeCatalogIdentityIsRejectedWithoutTrap() throws {
        let entry = try XCTUnwrap(try ContestBuiltInDeclarativeCatalog.operatorArchiveEntries().first)
        let firstURL = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-duplicate-definition-\(UUID().uuidString).sqlite3")
        XCTAssertThrowsError(try ContestLane(
            databaseURL: firstURL, generationSource: { [generation] in generation },
            declarativeDefinitions: [entry.definition, entry.definition]))
        let secondURL = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-conflicting-definition-\(UUID().uuidString).sqlite3")
        XCTAssertThrowsError(try ContestLane(
            databaseURL: secondURL, generationSource: { [generation] in generation },
            rules: ContestRuleRegistry([entry.rule]), declarativeDefinitions: [entry.definition]))
    }

    private func assertCreateError(_ code: String, lane: ContestLane, sessionID: UUID,
                                   payload: [String: Any]) async {
        do {
            _ = try await lane.handle(method: "contest_create", params: mutation(
                sessionID: sessionID, requestID: UUID(), revision: 0, timestamp: timestamp, payload: payload))
            XCTFail("Expected \(code)")
        } catch let error as ContestLaneError {
            XCTAssertEqual(error.code, code)
        } catch {
            XCTFail("Unexpected error: \(error)")
        }
    }

    private func createPayload(rule: [String: Any], definition: ContestDeclarativeCatalogEntry,
                               sessionID: UUID) -> [String: Any] {
        [
            "sessionID": wireID(sessionID), "name": definition.definition.draft.displayName,
            "ruleIdentity": rule["identity"]!, "referenceDataVersion": rule["referenceDataVersion"]!,
            "definitionDigest": definition.definitionDigest,
            "station": ["callsign": "OM0RX", "cqZone": "15", "dxccEntity": "SLOVAK REPUBLIC",
                        "exchangeFields": stationFields(for: definition.identity.id)],
            "operator": ["callsign": "OM0RX", "category": "Single Operator"],
        ]
    }

    private func stationFields(for id: String) -> [String: String] {
        if id.hasPrefix("ten-ten-") { return ["name": "OLIVER", "member-number": "12345", "qth": "SLOVAKIA"] }
        if id == "cwops-cwt" { return ["name": "OLIVER", "member-or-location": "1234"] }
        return ["name": "OLIVER"]
    }

    private func receivedFields(for id: String) -> [String: String] {
        if id == "ten-ten-winterPhone" { return ["name": String(repeating: "C", count: 32), "member-number": "00000000", "qth": String(repeating: "D", count: 32)] }
        if id.hasPrefix("ten-ten-") { return ["name": "AL", "member-number": "0", "qth": "NEW YORK"] }
        if id == "cwops-cwt" { return ["name": "AL", "member-or-location": "CA"] }
        return ["name": "AL", "serial": "101"]
    }

    private func draftFields(rule: [String: Any], definition: ContestDeclarativeDefinition,
                             sent: [String: String], received: [String: String],
                             callsign: String, mode overrideMode: String? = nil) throws -> [String: Any] {
        let entry = try XCTUnwrap(rule["entry"] as? [String: Any])
        let exchange = try XCTUnwrap(entry["exchange"] as? [String: Any])
        let sentDescriptors = try XCTUnwrap(exchange["sentFields"] as? [[String: Any]])
        let receivedDescriptors = try XCTUnwrap(exchange["receivedFields"] as? [[String: Any]])
        let sentText = sentDescriptors.compactMap { sent[$0["id"] as? String ?? ""] }.joined(separator: " ")
        let receivedText = receivedDescriptors.compactMap { received[$0["id"] as? String ?? ""] }.joined(separator: " ")
        let report = try XCTUnwrap(entry["report"] as? [String: Any])
        let mode = overrideMode ?? definition.draft.entry.mode
        let phone = ["SSB", "AM", "FM"].contains(mode)
        return [
            "callsign": callsign, "sentReport": report["defaultSent"] as? String ?? "",
            "sentExchange": sentText, "receivedReport": report["defaultReceived"] as? String ?? "",
            "receivedExchange": receivedText, "frequencyHz": phone ? 28_450_000 : (mode == "CW" && definition.identity.id.hasPrefix("ten-ten-") ? 28_050_000 : 14_025_000),
            "band": definition.identity.id.hasPrefix("ten-ten-") ? "10m" : "20m", "mode": mode,
            "sentExchangeFields": sent, "receivedExchangeFields": received,
        ]
    }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil) -> [String: Any] {
        var result: [String: Any] = [
            "sessionID": wireID(sessionID), "workspaceGeneration": generation,
            "requestID": wireID(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: "a", count: 32) + wireID(requestID).replacingOccurrences(of: "-", with: ""),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { result["draftID"] = wireID(draftID) }
        return result
    }

    private func exportHeader(mode: String) -> [String: Any] {
        ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
         "categoryBand": "ALL", "categoryMode": mode, "categoryTransmitter": "ONE", "categoryPower": "LOW",
         "operators": ["OM0RX"], "location": "DX", "name": "Oliver Operator", "addressLines": [], "email": ""]
    }

    private func identityID(_ rule: [String: Any]) -> String? {
        (rule["identity"] as? [String: Any])?["id"] as? String
    }

    private func wireID(_ id: UUID) -> String { id.uuidString.lowercased() }

    private func canonicalJSON(_ value: [String: Any]) throws -> Data {
        try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    private func time(_ minute: Int) -> String {
        String(format: "2026-10-18T%02d:%02d:00.000Z", 3 + minute / 60, minute % 60)
    }
}
