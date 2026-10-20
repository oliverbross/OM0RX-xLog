import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class ContestSSTWorkerAcceptanceTests: XCTestCase {
    private func wire(_ value: UUID) -> String { value.uuidString.lowercased() }

    private func mutation(sessionID: UUID, requestID: UUID, revision: Int, timestamp: String,
                          payload: [String: Any], draftID: UUID? = nil,
                          generation: String) -> [String: Any] {
        var value: [String: Any] = [
            "sessionID": wire(sessionID), "workspaceGeneration": generation,
            "requestID": wire(requestID), "expectedRevision": revision,
            "payloadDigest": String(repeating: String(format: "%x", revision % 15 + 1), count: 64),
            "operationTimestamp": timestamp, "payload": payload,
        ]
        if let draftID { value["draftID"] = wire(draftID) }
        return value
    }

    private func frame(_ worker: LiveWorker, _ method: String,
                       _ params: [String: Any] = [:]) async throws -> [String: Any] {
        let request = try JSONSerialization.data(withJSONObject: [
            "id": wire(UUID()), "method": method, "params": params,
        ])
        let response = await worker.response(to: request)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: response) as? [String: Any])
    }

    func testPackagedSSTDefinitionRunsThroughRealWorkerAndCanGenerateActivationFixture() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sst-worker-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let definition = try SSTDeclarativeDefinition.definition()
        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false,
                                         runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        var worker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting)

        let catalogFrame = try await frame(worker, "contest_catalog")
        let catalog = try XCTUnwrap(catalogFrame["result"] as? [String: Any])
        let generation = try XCTUnwrap(catalog["workspaceGeneration"] as? String)
        let rules = try XCTUnwrap(catalog["rules"] as? [[String: Any]])
        let rule = try XCTUnwrap(rules.first {
            ($0["identity"] as? [String: Any])?["id"] as? String == definition.identity.id
        })
        XCTAssertEqual(rules.filter { $0["declarativeDefinition"] != nil }.count, 8)
        let definitionWire = try XCTUnwrap(rule["declarativeDefinition"] as? [String: Any])
        XCTAssertEqual(definitionWire["definitionDigest"] as? String, definition.definitionDigest)
        XCTAssertEqual(definitionWire["exportPurpose"] as? String, "operatorArchive")
        XCTAssertEqual(definitionWire["submissionReady"] as? Bool, false)
        let referenceVersion = try XCTUnwrap(rule["referenceDataVersion"] as? String)
        XCTAssertTrue(referenceVersion.hasPrefix("bundled-cty-fnv64-"))
        let capability = try XCTUnwrap(rule["operatorCapability"] as? [String: Any])
        XCTAssertEqual(capability["styles"] as? [String], ["run", "search-and-pounce"])
        XCTAssertEqual(capability["macros"] as? [String], ["CQ", "EXCH", "QRZ", "AGN", "HISCALL", "MYCALL", "QSOB4"])
        XCTAssertEqual(capability["output"] as? String, "simulation-only")

        let reference = try ContestReferenceData.bundled()
        let startedAt = try XCTUnwrap(ISO8601DateFormatter().date(from: "2026-10-18T12:00:00Z"))
        let stationCountry = try XCTUnwrap(reference.resolve("K1USN", at: startedAt))
        let stationEntity = try reference.entity(stationCountry)
        XCTAssertEqual(reference.version, referenceVersion)

        let sessionID = UUID(), draftID = UUID()
        let createRequest = mutation(sessionID: sessionID, requestID: draftID, revision: 0,
            timestamp: "2026-10-18T12:00:00.000Z", payload: [
                "sessionID": wire(sessionID), "name": "SST Worker Acceptance",
                "ruleIdentity": try XCTUnwrap(rule["identity"] as? [String: Any]),
                "referenceDataVersion": referenceVersion,
                "definitionDigest": definition.definitionDigest,
                "station": ["callsign": "K1USN", "cqZone": String(stationEntity.cqZone),
                            "dxccEntity": stationEntity.name,
                            "exchangeFields": ["name": "DAVE", "location": "MA"]],
                "operator": ["callsign": "K1USN", "category": "Single Operator"],
            ], generation: generation)
        let created = try await frame(worker, "contest_create", createRequest)
        let createdResult = try XCTUnwrap(created["result"] as? [String: Any], "\(created) request=\(createRequest)")
        let createdSession = try XCTUnwrap(createdResult["session"] as? [String: Any])
        XCTAssertEqual(createdSession["referenceDataVersion"] as? String, referenceVersion)
        let blankDraft = try XCTUnwrap(createdResult["draft"] as? [String: Any])
        let blankReadiness = try XCTUnwrap(blankDraft["operatorReadiness"] as? [String: Any])
        XCTAssertEqual(blankReadiness["callsign"] as? String, "empty")
        XCTAssertEqual(blankReadiness["exchange"] as? String, "empty")
        XCTAssertEqual(blankReadiness["canSendCQ"] as? Bool, false)
        XCTAssertEqual(blankReadiness["canReserveCall"] as? Bool, false)
        XCTAssertEqual(blankReadiness["canReserveCommit"] as? Bool, false)
        XCTAssertEqual(blankReadiness["canCommit"] as? Bool, false)

        let cqReadyFields: [String: Any] = [
            "callsign": "", "sentReport": "", "sentExchange": "DAVE MA",
            "receivedReport": "", "receivedExchange": "", "frequencyHz": 14_025_000,
            "band": "20m", "mode": "CW",
            "sentExchangeFields": ["name": "DAVE", "location": "MA"],
            "receivedExchangeFields": ["name": "", "location": ""],
        ]
        let cqReadyRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 1,
            timestamp: "2026-10-18T12:00:01.000Z", payload: ["fields": cqReadyFields],
            draftID: draftID, generation: generation)
        let cqReadyApplied = try await frame(worker, "contest_draft_apply", cqReadyRequest)
        let cqReadyDraft = try XCTUnwrap((cqReadyApplied["result"] as? [String: Any])?["draft"] as? [String: Any])
        let cqReadiness = try XCTUnwrap(cqReadyDraft["operatorReadiness"] as? [String: Any])
        XCTAssertEqual(cqReadiness["callsign"] as? String, "empty")
        XCTAssertEqual(cqReadiness["exchange"] as? String, "empty")
        XCTAssertEqual(cqReadiness["canSendCQ"] as? Bool, true, "\(cqReadyDraft)")
        XCTAssertEqual(cqReadiness["canCommit"] as? Bool, false)

        let serialRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: 2,
            timestamp: "2026-10-18T12:00:02.000Z", payload: [:], draftID: draftID,
            generation: generation)
        let serialDenied = try await frame(worker, "contest_serial_reserve", serialRequest)
        XCTAssertEqual((serialDenied["error"] as? [String: Any])?["code"] as? String, "serial_not_supported")

        let official: [(String, String, String, String, Int)] = [
            ("K1VUT", "80m", "DAVE", "MA", 3_525_000),
            ("N3QE", "80m", "TIM", "MD", 3_526_000),
            ("VE3KI", "80m", "RICH", "ON", 3_527_000),
            ("DK9PY", "80m", "ARMIN", "DX", 3_528_000),
            ("K4BAI", "40m", "JOHN", "GA", 7_025_000),
            ("K1RV", "40m", "PI", "MA", 7_026_000),
            ("N1VH", "40m", "MARTY", "MA", 7_027_000),
            ("K9ZO", "40m", "AL", "IL", 7_028_000),
            ("K1DJ", "20m", "RICH", "MA", 14_025_000),
            ("DK9PY", "20m", "ARMIN", "DX", 14_026_000),
            ("F6HKA", "20m", "BERT", "DX", 14_027_000),
            ("K1RV", "20m", "PI", "MA", 14_028_000),
        ]
        var revision = 2
        var lastCommit: [String: Any] = [:]
        for (index, contact) in official.enumerated() {
            let fields = qsoFields(callsign: contact.0, band: contact.1, name: contact.2,
                                   location: contact.3, frequencyHz: contact.4)
            let applyRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: timestamp(index * 2 + 2), payload: ["fields": fields], draftID: draftID,
                generation: generation)
            let applied = try await frame(worker, "contest_draft_apply", applyRequest)
            let appliedDraft = try XCTUnwrap((applied["result"] as? [String: Any])?["draft"] as? [String: Any])
            let readiness = try XCTUnwrap(appliedDraft["operatorReadiness"] as? [String: Any])
            XCTAssertEqual(readiness["callsign"] as? String, "ready")
            XCTAssertEqual(readiness["exchange"] as? String, "ready")
            XCTAssertEqual(readiness["canSendCall"] as? Bool, true)
            XCTAssertEqual(readiness["canCommit"] as? Bool, true)
            revision += 1
            let commitRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
                timestamp: timestamp(index * 2 + 3), payload: [:], draftID: draftID,
                generation: generation)
            let committed = try await frame(worker, "contest_qso_commit", commitRequest)
            lastCommit = try XCTUnwrap(committed["result"] as? [String: Any])
            revision += 1
        }
        let officialScore = try XCTUnwrap(lastCommit["score"] as? [String: Any])
        XCTAssertEqual((officialScore["qsos"] as? NSNumber)?.intValue, 12)
        XCTAssertEqual((officialScore["points"] as? NSNumber)?.intValue, 12)
        XCTAssertEqual((officialScore["multipliers"] as? NSNumber)?.intValue, 10)
        XCTAssertEqual((officialScore["claimedScore"] as? NSNumber)?.intValue, 120)

        let duplicateApplyRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T12:30:00.000Z",
            payload: ["fields": qsoFields(callsign: "K1VUT", band: "80m", name: "DAVE",
                                              location: "MA", frequencyHz: 3_529_000)],
            draftID: draftID, generation: generation)
        let duplicateApplied = try await frame(worker, "contest_draft_apply", duplicateApplyRequest)
        let duplicateDraft = try XCTUnwrap((duplicateApplied["result"] as? [String: Any])?["draft"] as? [String: Any])
        XCTAssertEqual((duplicateDraft["dupe"] as? [String: Any])?["state"] as? String, "duplicate")
        let duplicateReadiness = try XCTUnwrap(duplicateDraft["operatorReadiness"] as? [String: Any])
        XCTAssertEqual(duplicateReadiness["canSendDuplicate"] as? Bool, true)
        XCTAssertEqual(duplicateReadiness["canCommit"] as? Bool, false)
        revision += 1

        let nlApplyRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T12:31:00.000Z",
            payload: ["fields": qsoFields(callsign: "VO1AAA", band: "15m", name: "AL",
                                              location: "NL", frequencyHz: 21_025_000)],
            draftID: draftID, generation: generation)
        let nlApplied = try await frame(worker, "contest_draft_apply", nlApplyRequest)
        let nlDraft = try XCTUnwrap((nlApplied["result"] as? [String: Any])?["draft"] as? [String: Any])
        XCTAssertEqual((nlDraft["fields"] as? [String: Any])?["receivedExchange"] as? String, "AL NL")
        revision += 1
        let nlCommitRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T12:32:00.000Z", payload: [:], draftID: draftID,
            generation: generation)
        let nlCommitted = try await frame(worker, "contest_qso_commit", nlCommitRequest)
        let nlCommitResult = try XCTUnwrap(nlCommitted["result"] as? [String: Any])
        let committedNLQSO = try XCTUnwrap(nlCommitResult["qso"] as? [String: Any])
        let nlQSOID = try XCTUnwrap(committedNLQSO["qsoID"] as? String)
        revision += 1

        let getRequest: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation,
            "expectedRevision": revision, "qsoID": nlQSOID]
        let got = try await frame(worker, "contest_qso_get", getRequest)
        var correctedQSO = try XCTUnwrap((got["result"] as? [String: Any])?["qso"] as? [String: Any])
        XCTAssertEqual(correctedQSO["receivedExchange"] as? String, "AL NL")
        XCTAssertEqual((correctedQSO["receivedExchangeFields"] as? [String: String])?["location"], "NL")
        let scoreRequest: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation,
            "expectedRevision": revision]
        let scored = try await frame(worker, "contest_score", scoreRequest)
        let nlScore = try XCTUnwrap(scored["result"] as? [String: Any])
        let rawLabels = try XCTUnwrap(nlScore["multiplierLabels"] as? [String])
        XCTAssertTrue(rawLabels.contains { $0.contains("2:NF") && $0.hasSuffix(":15m") })
        XCTAssertFalse(rawLabels.contains { $0.contains("2:NL") })
        XCTAssertTrue((nlScore["multiplierDisplayLabels"] as? [String])?.contains("NF subdivision · 15m") == true)
        correctedQSO.removeValue(forKey: "entity")
        correctedQSO["receivedExchange"] = "ALLEN NL"
        correctedQSO["normalizedReceivedExchange"] = "ALLEN NL"
        correctedQSO["receivedExchangeFields"] = ["name": "ALLEN", "location": "NL"]
        let correctionRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T12:33:00.000Z",
            payload: ["qso": correctedQSO, "reason": "Correct copied name"], generation: generation)
        let corrected = try await frame(worker, "contest_qso_correct", correctionRequest)
        XCTAssertEqual(((corrected["result"] as? [String: Any])?["currentTarget"] as? [String: Any])?["receivedExchange"] as? String,
                       "ALLEN NL")
        revision += 1

        _ = await worker.shutdown()
        worker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting)
        let openRequest: [String: Any] = ["sessionID": wire(sessionID), "workspaceGeneration": generation]
        let reopened = try await frame(worker, "contest_open", openRequest)
        XCTAssertEqual(((reopened["result"] as? [String: Any])?["session"] as? [String: Any])?["qsoCount"] as? Int, 13)
        let replayedCorrection = try await frame(worker, "contest_qso_correct", correctionRequest)
        XCTAssertEqual(((replayedCorrection["result"] as? [String: Any])?["receipt"] as? [String: Any])?["committedRevision"] as? Int,
                       revision)

        var exports: [String: Any] = [:]
        for format in ["cabrillo", "adif"] {
            let exportID = UUID()
            let prepare: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
                "workspaceGeneration": generation, "expectedRevision": revision,
                "generatedAtUTC": "2026-10-18T12:34:00.000Z", "format": format,
                "header": ["callsign": "K1USN", "categoryOperator": "SINGLE-OP",
                    "categoryAssisted": "NON-ASSISTED", "categoryBand": "ALL", "categoryMode": "CW",
                    "categoryTransmitter": "ONE", "categoryPower": "LOW", "operators": ["K1USN"],
                    "location": "MA", "name": "Dave", "addressLines": [], "email": ""]]
            let prepared = try await frame(worker, "contest_export_prepare", prepare)
            let length = try XCTUnwrap(((prepared["result"] as? [String: Any])?["byteLength"] as? NSNumber)?.intValue)
            let read: [String: Any] = ["exportID": wire(exportID), "sessionID": wire(sessionID),
                "workspaceGeneration": generation, "offset": 0, "length": length]
            let chunk = try await frame(worker, "contest_export_read", read)
            let base64 = try XCTUnwrap(((chunk["result"] as? [String: Any])?["dataBase64"] as? String))
            let text = String(decoding: try XCTUnwrap(Data(base64Encoded: base64)), as: UTF8.self)
            XCTAssertTrue(text.contains("NL"), format)
            if format == "cabrillo" {
                XCTAssertTrue(text.contains("CLAIMED-SCORE: 143"))
                let row = try XCTUnwrap(text.split(whereSeparator: \.isNewline)
                    .map(String.init).first { $0.hasPrefix("QSO: 21025") })
                XCTAssertEqual(try parseCabrilloQSO(row), [
                    "21025", "CW", "2026-10-18", "1232", "K1USN", "DAVE", "MA",
                    "VO1AAA", "ALLEN", "NL",
                ])
            } else {
                let record = try XCTUnwrap(text.components(separatedBy: "<EOR>").first { $0.contains("<CALL:6>VO1AAA") })
                let fields = try parseADIF(record)
                XCTAssertEqual(Set(fields.keys), Set([
                    "APP_OM0RXXLOG_FORMATTER_VERSION", "APP_OM0RXXLOG_INPUT_SCHEMA_VERSION",
                    "APP_OM0RXXLOG_PROVENANCE_IDENTITY", "APP_OM0RXXLOG_PROVENANCE_SOURCE",
                    "APP_OM0RXXLOG_QSO_ID", "APP_OM0RXXLOG_REFERENCE_DATA_VERSION",
                    "APP_OM0RXXLOG_RULE_EDITION", "APP_OM0RXXLOG_RULE_ID",
                    "APP_OM0RXXLOG_RULE_SOURCE_REVISION", "APP_OM0RXXLOG_RULE_VERSION",
                    "APP_OM0RXXLOG_SESSION_ID", "APP_OM0RXXLOG_SESSION_REVISION",
                    "APP_OM0RXXLOG_WORKSPACE_GENERATION", "BAND", "CALL", "CONTEST_ID", "FREQ",
                    "MODE", "MY_NAME", "MY_STATE", "NAME", "OPERATOR", "QSO_DATE", "SRX_STRING", "STATE",
                    "STATION_CALLSIGN", "STX_STRING", "TIME_ON",
                ]))
                XCTAssertEqual(fields["CALL"], "VO1AAA")
                XCTAssertEqual(fields["NAME"], "ALLEN")
                XCTAssertEqual(fields["STATE"], "NL")
                XCTAssertEqual(fields["SRX_STRING"], "ALLEN NL")
                XCTAssertEqual(fields["STX_STRING"], "DAVE MA")
                XCTAssertEqual(fields["MY_NAME"], "DAVE")
                XCTAssertEqual(fields["MY_STATE"], "MA")
                XCTAssertEqual(fields["STATION_CALLSIGN"], "K1USN")
                XCTAssertEqual(fields["APP_OM0RXXLOG_REFERENCE_DATA_VERSION"], referenceVersion)
                XCTAssertNil(fields["RST_RCVD"])
                XCTAssertNil(fields["RST_SENT"])
            }
            exports[format] = ["prepareRequest": prepare, "prepareResponse": prepared,
                               "readRequest": read, "readResponse": chunk]
        }

        let deletionRequest = mutation(sessionID: sessionID, requestID: UUID(), revision: revision,
            timestamp: "2026-10-18T12:35:00.000Z",
            payload: ["qsoID": nlQSOID, "reason": "Remove extra alias acceptance contact"],
            generation: generation)
        let deleted = try await frame(worker, "contest_qso_delete", deletionRequest)
        let deletionResult = try XCTUnwrap(deleted["result"] as? [String: Any])
        let recoveredOfficialScore = try XCTUnwrap(deletionResult["score"] as? [String: Any])
        XCTAssertEqual((recoveredOfficialScore["qsos"] as? NSNumber)?.intValue, 12)
        XCTAssertEqual((recoveredOfficialScore["points"] as? NSNumber)?.intValue, 12)
        XCTAssertEqual((recoveredOfficialScore["multipliers"] as? NSNumber)?.intValue, 10)
        XCTAssertEqual((recoveredOfficialScore["claimedScore"] as? NSNumber)?.intValue, 120)
        revision += 1
        _ = await worker.shutdown()
        worker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting)
        let reopenedAfterDeletion = try await frame(worker, "contest_open", openRequest)
        XCTAssertEqual(((reopenedAfterDeletion["result"] as? [String: Any])?["session"] as? [String: Any])?["qsoCount"] as? Int,
                       12)

        if let output = ProcessInfo.processInfo.environment["XLOG_SST_PACKAGED_WORKER_FIXTURE_OUTPUT"] {
            let fixture: [String: Any] = [
                "schemaVersion": 1,
                "scope": "packaged immutable SST operator archive practice preview; schedule and results reporting remain outside this gate",
                "referenceDataVersion": referenceVersion,
                "catalog": catalogFrame,
                "create": ["request": createRequest, "response": created],
                "blankReadiness": blankReadiness,
                "cqReady": ["request": cqReadyRequest, "response": cqReadyApplied],
                "serialDenied": ["request": serialRequest, "response": serialDenied],
                "officialSample": ["contactCount": 12, "expected": ["points": 12, "multipliers": 10, "claimedScore": 120],
                                   "actual": officialScore],
                "extraContacts": ["note": "NL alias contact is outside the official 12-contact scoring sample",
                                  "duplicateApply": duplicateApplied, "nlApply": nlApplied, "nlCommit": nlCommitted],
                "correction": ["request": correctionRequest, "response": corrected,
                               "replayAfterRestart": replayedCorrection, "openAfterRestart": reopened],
                "exports": exports,
                "deletionRecovery": ["request": deletionRequest, "response": deleted,
                                     "openAfterRestart": reopenedAfterDeletion],
            ]
            let url = URL(fileURLWithPath: output)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONSerialization.data(withJSONObject: fixture, options: [.prettyPrinted, .sortedKeys])
                .write(to: url, options: .atomic)
        }
    }

    func testDefinitionOverrideCannotEnableProductionAndTestProfileStillDeniesExternalIO() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-sst-profile-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }
        let definition = try SSTDeclarativeDefinition.definition()
        let production = LiveWorker(logbook: LiveLogbookMethods(
            supportDirectory: root.appendingPathComponent("production"), inheritNativePreferences: false),
            operatingModule: .contesting,
            contestDeclarativeDefinitions: [definition])
        let denied = try await frame(production, "contest_catalog")
        XCTAssertEqual((denied["error"] as? [String: Any])?["code"] as? String, "contest_host_unavailable")

        let profile = try AppRuntimeProfile.contestingTestProfile(applicationSupport: root)
        guard case .contestingTest(let supportRoot) = profile else { return XCTFail("Expected contest profile") }
        let logbook = LiveLogbookMethods(supportDirectory: supportRoot, inheritNativePreferences: false,
                                         runtimeProfile: profile)
        _ = try logbook.handle(method: "workspace_create", params: ["mode": "empty"])
        let builtInWorker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting)
        let builtInCatalog = try await frame(builtInWorker, "contest_catalog")
        let builtInRules = try XCTUnwrap((builtInCatalog["result"] as? [String: Any])?["rules"] as? [[String: Any]])
        XCTAssertTrue(builtInRules.contains {
            ($0["identity"] as? [String: Any])?["id"] as? String == definition.identity.id
        })
        _ = await builtInWorker.shutdown()
        let boundaryCases = [
            ("id", "a" + String(repeating: "b", count: 127), "a" + String(repeating: "b", count: 128)),
            ("version", String(repeating: "v", count: 128), String(repeating: "v", count: 129)),
            ("edition", String(repeating: "é", count: 64), String(repeating: "é", count: 64) + "a"),
        ]
        let boundaryDefinitions = try boundaryCases.map { try boundaryDefinition(field: $0.0, value: $0.1) }
        let testWorker = LiveWorker(logbook: logbook, runtimeProfile: profile, operatingModule: .contesting,
                                    contestDeclarativeDefinitions: boundaryDefinitions)
        let external = try await frame(testWorker, "cluster_connect", ["host": "127.0.0.1", "port": 23])
        XCTAssertEqual((external["error"] as? [String: Any])?["code"] as? String, "external_io_disabled")

        let catalog = try await frame(testWorker, "contest_catalog")
        let generation = try XCTUnwrap((catalog["result"] as? [String: Any])?["workspaceGeneration"] as? String)
        let referenceVersion = try ContestReferenceData.bundled().version
        func createWithIdentity(_ identity: [String: String], definitionDigest: String) async throws -> (UUID, [String: Any]) {
            let sessionID = UUID()
            let request = mutation(sessionID: sessionID, requestID: UUID(), revision: 0,
                timestamp: "2026-10-18T13:00:00.000Z", payload: [
                    "sessionID": wire(sessionID), "name": "Identity boundary",
                    "ruleIdentity": identity, "referenceDataVersion": referenceVersion,
                    "definitionDigest": definitionDigest,
                    "station": ["callsign": "K1USN", "cqZone": "5", "dxccEntity": "UNITED STATES",
                                "exchangeFields": ["name": "DAVE", "location": "MA"]],
                    "operator": ["callsign": "K1USN", "category": "Single Operator"],
                ], generation: generation)
            return (sessionID, try await frame(testWorker, "contest_create", request))
        }
        for ((field, _, rejected), exactDefinition) in zip(boundaryCases, boundaryDefinitions) {
            let exact = identityWire(exactDefinition.identity)
            var tooLong = exact
            tooLong[field] = rejected
            let (sessionID, created) = try await createWithIdentity(exact, definitionDigest: exactDefinition.definitionDigest)
            XCTAssertNil(created["error"], "\(field): \(created)")
            let createdSession = try XCTUnwrap((created["result"] as? [String: Any])?["session"] as? [String: Any])
            XCTAssertEqual((createdSession["rule"] as? [String: Any])?["identity"] as? [String: String], exact, field)
            let opened = try await frame(testWorker, "contest_open", [
                "sessionID": wire(sessionID), "workspaceGeneration": generation,
            ])
            let openedSession = try XCTUnwrap((opened["result"] as? [String: Any])?["session"] as? [String: Any])
            XCTAssertEqual((openedSession["rule"] as? [String: Any])?["identity"] as? [String: String], exact, field)
            let (_, rejectedResponse) = try await createWithIdentity(tooLong, definitionDigest: exactDefinition.definitionDigest)
            XCTAssertEqual((rejectedResponse["error"] as? [String: Any])?["code"] as? String, "invalid_params", field)
        }
    }

    private func boundaryDefinition(field: String, value: String) throws -> ContestDeclarativeDefinition {
        let encoder = JSONEncoder()
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: encoder.encode(SSTDeclarativeDefinition.draft())) as? [String: Any])
        var changed = object
        changed[field] = value
        let draft = try JSONDecoder().decode(ContestDefinitionDraft.self,
            from: JSONSerialization.data(withJSONObject: changed, options: [.sortedKeys]))
        return try draft.materialized()
    }

    private func identityWire(_ identity: ContestRuleIdentity) -> [String: String] {
        ["id": identity.id, "version": identity.version, "edition": identity.edition,
         "sourceRevision": identity.sourceRevision]
    }

    private func timestamp(_ minute: Int) -> String {
        String(format: "2026-10-18T12:%02d:00.000Z", minute)
    }

    private func qsoFields(callsign: String, band: String, name: String,
                           location: String, frequencyHz: Int) -> [String: Any] {
        ["callsign": callsign, "sentReport": "", "sentExchange": "DAVE MA",
         "receivedReport": "", "receivedExchange": "\(name) \(location)",
         "frequencyHz": frequencyHz, "band": band, "mode": "CW",
         "sentExchangeFields": ["name": "DAVE", "location": "MA"],
         "receivedExchangeFields": ["name": name, "location": location]]
    }

    private func parseCabrilloQSO(_ line: String) throws -> [String] {
        let prefix = "QSO: "
        guard line.hasPrefix(prefix) else { throw CocoaError(.fileReadCorruptFile) }
        var remainder = String(line.dropFirst(prefix.count))
        let widths = [5, 2, 10, 4, 13, 10, 8, 13, 10, 8]
        var fields: [String] = []
        for (index, width) in widths.enumerated() {
            guard remainder.utf8.count >= width else { throw CocoaError(.fileReadCorruptFile) }
            let end = remainder.index(remainder.startIndex, offsetBy: width)
            fields.append(remainder[..<end].trimmingCharacters(in: .whitespaces))
            remainder.removeSubrange(..<end)
            if index < widths.count - 1 {
                guard remainder.first == " " else { throw CocoaError(.fileReadCorruptFile) }
                remainder.removeFirst()
            }
        }
        guard remainder.isEmpty else { throw CocoaError(.fileReadCorruptFile) }
        return fields
    }

    private func parseADIF(_ record: String) throws -> [String: String] {
        let regex = try NSRegularExpression(pattern: #"<([A-Z0-9_]+):([0-9]+)(?::[^>]*)?>([^<]*)"#)
        let range = NSRange(record.startIndex..<record.endIndex, in: record)
        var fields: [String: String] = [:]
        for match in regex.matches(in: record, range: range) {
            guard let keyRange = Range(match.range(at: 1), in: record),
                  let lengthRange = Range(match.range(at: 2), in: record),
                  let valueRange = Range(match.range(at: 3), in: record),
                  let length = Int(record[lengthRange]) else { throw CocoaError(.fileReadCorruptFile) }
            let value = String(record[valueRange])
            guard value.utf8.count == length else { throw CocoaError(.fileReadCorruptFile) }
            fields[String(record[keyRange])] = value
        }
        return fields
    }
}
