import Foundation
import XCTest
@testable import XContestCore

final class ContestDeclarativeExportTests: XCTestCase {
    private let generation = UUID(uuidString: "EA000000-0000-0000-0000-000000000001")!
    private let timestamp = Date(timeIntervalSince1970: 1_900_500_000)

    func testArchiveDefinitionsRenderIndependentFieldOrderGoldensAndRetainDuplicates() throws {
        let expected: [CWUniqueCallContestVariant: String] = [
            .cwt: "QSO: 14030 CW 2030-03-23 1240 OM0RX         OLIVER     1234                 K1ABC         AL         NEW ZEALAND         ",
            .cwOpen: "QSO: 14030 CW 2030-03-23 1240 OM0RX          001 OLIVER     K1ABC          101 AL        ",
            .icwcMST: "QSO: 14030 CW 2030-03-23 1240 OM0RX         OLIVER      001 K1ABC         AL          101",
        ]
        for variant in CWUniqueCallContestVariant.allCases {
            let rule = try CWUniqueCallDeclarativeDefinitions.archiveRule(for: variant)
            let session = makeSession(rule: rule, variant: variant)
            let first = makeQSO(rule: rule, session: session, variant: variant, id: 1, call: "K1ABC")
            let duplicate = makeQSO(rule: rule, session: session, variant: variant, id: 2, call: "K1ABC")
            XCTAssertEqual(try CabrilloExporter.qsoLine(first, session: session, rule: rule), expected[variant])
            let document = try CabrilloExporter.document(
                input: input(rule: rule, session: session, qsos: [duplicate, first]), rule: rule)
            XCTAssertEqual(document.components(separatedBy: "\r\n").filter { $0.hasPrefix("QSO: ") }.count, 2)
            XCTAssertTrue(document.contains("X-OM0RXXLOG-PURPOSE: OPERATOR-ARCHIVE\r\n"))
        }
    }

    func testLegacyCanonicalDefinitionsRemainByteCompatibleAndArchiveUsesNewIdentity() throws {
        let expected: [CWUniqueCallContestVariant: String] = [
            .cwt: "85894c011a8e7741ff6f3aa767ab89c770f00bdf7945e0bde6fbf77fdd19570d",
            .cwOpen: "0729818cee710b1e584bd6f18855fafb3f0dcf5725838556748bd44129518ff9",
            .icwcMST: "8578bf731798cf27711b5ec084a8a3e3753e6b519abaa3da93396583b69c4a12",
        ]
        for variant in CWUniqueCallContestVariant.allCases {
            let definition = try CWUniqueCallDeclarativeDefinitions.definition(for: variant)
            let data = try definition.canonicalStorageData()
            XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("exportProjection"))
            XCTAssertEqual(try JSONDecoder().decode(ContestDeclarativeDefinition.self, from: data), definition)
            XCTAssertEqual(definition.definitionDigest, expected[variant])
            XCTAssertNil(definition.draft.operatorPolicy)
            let archive = try CWUniqueCallDeclarativeDefinitions.archiveDefinition(for: variant)
            XCTAssertNotEqual(archive.identity, definition.identity)
            XCTAssertEqual(archive.draft.exportPolicy, .operatorArchive)
            XCTAssertNotNil(archive.draft.operatorPolicy)
        }
    }

    func testAllSevenArchiveDefinitionsMaterializeAsNewOperatorArchiveVersions() throws {
        let archives = try CWUniqueCallContestVariant.allCases.map {
            try CWUniqueCallDeclarativeDefinitions.archiveDefinition(for: $0)
        } + TenTenSeasonalVariant.allCases.map {
            try TenTenDeclarativeDefinitions.archiveDefinition(for: $0)
        }
        XCTAssertEqual(archives.count, 7)
        XCTAssertEqual(Set(archives.map { $0.draft.version }), ["2.0.0-declarative-archive"])
        XCTAssertTrue(archives.allSatisfy {
            $0.draft.exportPolicy == .operatorArchive &&
                $0.draft.exportProjection?.purpose == .operatorArchive &&
                $0.draft.exportProjection?.duplicateRecords == .retainAll &&
                $0.draft.operatorPolicy != nil
        })
        XCTAssertEqual(Set(archives.map(\.identity)).count, 7)
    }

    func testDefinitionAdmissionRejectsHeaderInjectionDroppedExchangeAndOversizeColumn() throws {
        let base = CWUniqueCallDeclarativeDefinitions.archiveDraft(for: .cwOpen)
        XCTAssertThrowsError(try replacing(base, cabrilloName: "CW-OPEN\r\nCLAIMED-SCORE:999").materialized())

        let dropped = base.exportProjection!.columns.filter { $0.source != .receivedField("name") }
        XCTAssertThrowsError(try replacing(base, projection: .init(
            formatterVersion: base.exportProjection!.formatterVersion, columns: dropped)).materialized())

        var wide = base.exportProjection!.columns
        wide[0] = .init(source: wide[0].source, width: 65, alignment: wide[0].alignment)
        XCTAssertThrowsError(try replacing(base, projection: .init(
            formatterVersion: base.exportProjection!.formatterVersion, columns: wide)).materialized())

        let tenTen = TenTenDeclarativeDefinitions.archiveDraft(for: .springCW)
        let missingReport = tenTen.exportProjection!.columns.filter { $0.source != .receivedReport }
        XCTAssertThrowsError(try replacing(tenTen, projection: .init(
            formatterVersion: tenTen.exportProjection!.formatterVersion,
            columns: missingReport)).materialized())
    }

    func testRendererRejectsValidExchangeThatExceedsProjectedWidthAndValidationStopsUnsafeText() throws {
        let base = CWUniqueCallDeclarativeDefinitions.archiveDraft(for: .cwt)
        let narrow = base.exportProjection!.columns.map { column in
            column.source == .receivedField("member-or-location")
                ? ContestDeclarativeExportColumn(source: column.source, width: 5)
                : column
        }
        let rule = DeclarativeContestRule(definition: try replacing(
            base, projection: .init(formatterVersion: base.exportProjection!.formatterVersion,
                                    columns: narrow)).materialized())
        let session = makeSession(rule: rule, variant: .cwt)
        let validButWide = makeQSO(rule: rule, session: session, variant: .cwt, id: 30, call: "ZL1ABC")
        XCTAssertTrue(rule.evaluate(validButWide, in: session).validation.isEmpty)
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(validButWide, session: session, rule: rule)) {
            guard case CabrilloExportError.invalidQSO(validButWide.id, "archiveColumn") = $0 else {
                return XCTFail("Unexpected width error: \($0)")
            }
        }

        let unsafeFields = [
            "name": field("AL\r\nX"),
            "member-or-location": field("5678"),
        ]
        let unsafe = replacingReceived(validButWide, aggregate: "AL\r\nX 5678",
                                       fields: unsafeFields)
        let unsafeEvaluation = try ContestEngine.evaluate(
            unsafe, session: session, rule: rule, allowIncomplete: false)
        XCTAssertTrue(unsafeEvaluation.validation.contains {
            $0.code == "invalidStructuredExchangeField"
        })
        XCTAssertThrowsError(try CabrilloExporter.qsoLine(unsafe, session: session, rule: rule)) {
            guard case CabrilloExportError.invalidQSO(unsafe.id, "archiveColumn") = $0 else {
                return XCTFail("Unexpected unsafe-text error: \($0)")
            }
        }
    }

    func testTenTenArchiveGoldenPreservesMultiwordQTH() throws {
        let rule = try TenTenDeclarativeDefinitions.archiveRule(for: .springCW)
        let sent = tenTenFields(name: "OLIVER", member: "1234", qth: "AUSTRALIA")
        let session = ContestSessionSnapshot(
            id: UUID(uuidString: "EA000000-0000-0000-0000-000000000010")!,
            workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "ten-ten-archive", startedAt: timestamp,
            station: .init(callsign: "OM0RX", entity: nil,
                           sentExchange: "OLIVER 1234 AUSTRALIA", operatorCallsigns: ["OM0RX"],
                           location: "DX", sentExchangeFields: sent))
        let received = tenTenFields(name: "AL", member: "5678", qth: "NEW ZEALAND")
        let qso = ContestQSO(
            id: UUID(uuidString: "EA000000-0000-0000-0000-000000000011")!, sessionID: session.id,
            timestampUTC: timestamp, callsign: "ZL1ABC", band: "10m", mode: "CW",
            frequencyHz: 28_050_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "OLIVER 1234 AUSTRALIA", normalizedSent: "OLIVER 1234 AUSTRALIA",
                            rawReceived: "AL 5678 NEW ZEALAND", normalizedReceived: "AL 5678 NEW ZEALAND",
                            sentFields: sent, receivedFields: received), entity: nil,
            operatorCallsign: "OM0RX", stationLocation: "DX", provenance: .init(source: .operatorEntry))
        XCTAssertEqual(try CabrilloExporter.qsoLine(qso, session: session, rule: rule),
                       "QSO: 28050 CW 2030-03-23 1240 OM0RX         599 OLIVER         1234 AUSTRALIA            ZL1ABC        599 AL             5678 NEW ZEALAND         ")
    }

    func testAllTenTenArchiveVariantsRenderEverySupportedMode() throws {
        for variant in TenTenSeasonalVariant.allCases {
            let rule = try TenTenDeclarativeDefinitions.archiveRule(for: variant)
            for mode in rule.metadata.supportedModes.sorted() {
                let sent = tenTenFields(name: "OLIVER", member: "1234", qth: "AUSTRALIA")
                let session = ContestSessionSnapshot(
                    id: UUID(uuidString: "EA000000-0000-0000-0000-000000000040")!,
                    workspaceGeneration: generation, rule: rule.metadata.identity,
                    referenceDataVersion: "ten-ten-all-mode-archive", startedAt: timestamp,
                    station: .init(callsign: "OM0RX", entity: nil,
                                   sentExchange: "OLIVER 1234 AUSTRALIA",
                                   operatorCallsigns: ["OM0RX"], location: "DX",
                                   sentExchangeFields: sent))
                let received = tenTenFields(name: "AL", member: "5678", qth: "NEW ZEALAND")
                let phone = mode != "CW"
                let report = phone ? "59" : "599"
                let qso = ContestQSO(
                    id: UUID(uuidString: "EA000000-0000-0000-0000-000000000041")!,
                    sessionID: session.id, timestampUTC: timestamp, callsign: "K1ABC", band: "10m",
                    mode: mode, frequencyHz: phone ? 28_500_000 : 28_050_000,
                    rstSent: report, rstReceived: report,
                    exchange: .init(rawSent: "OLIVER 1234 AUSTRALIA",
                                    normalizedSent: "OLIVER 1234 AUSTRALIA",
                                    rawReceived: "AL 5678 NEW ZEALAND",
                                    normalizedReceived: "AL 5678 NEW ZEALAND",
                                    sentFields: sent, receivedFields: received), entity: nil,
                    operatorCallsign: "OM0RX", stationLocation: "DX",
                    provenance: .init(source: .operatorEntry))
                let expected = phone
                    ? "QSO: 28500 PH 2030-03-23 1240 OM0RX         59  OLIVER         1234 AUSTRALIA            K1ABC         59  AL             5678 NEW ZEALAND         "
                    : "QSO: 28050 CW 2030-03-23 1240 OM0RX         599 OLIVER         1234 AUSTRALIA            K1ABC         599 AL             5678 NEW ZEALAND         "
                XCTAssertEqual(try CabrilloExporter.qsoLine(qso, session: session, rule: rule), expected,
                               "\(variant.rawValue) \(mode)")
            }
        }
    }

    func testOptionalEmptyColumnKeepsItsDeclaredWidth() throws {
        let base = TenTenDeclarativeDefinitions.archiveDraft(for: .springCW)
        let received = base.entry.exchange.receivedFields.map { field in
            field.id == "qth"
                ? ContestExchangeFieldDescriptor(id: field.id, label: field.label,
                                                  acceptedKinds: field.acceptedKinds, required: false,
                                                  maximumUTF8Bytes: field.maximumUTF8Bytes,
                                                  adifField: field.adifField)
                : field
        }
        let exchange = ContestExchangeDescriptor(
            sent: base.entry.exchange.sent, received: base.entry.exchange.received,
            sentDefault: base.entry.exchange.sentDefault, adifFields: base.entry.exchange.adifFields,
            sentFields: base.entry.exchange.sentFields, receivedFields: received)
        let entry = ContestEntryDescriptor(
            cabrilloFormatterVersion: base.entry.cabrilloFormatterVersion,
            cabrilloProjectionFormatterVersion: base.entry.cabrilloProjectionFormatterVersion,
            modeProfiles: base.entry.modeProfiles, exchange: exchange, serial: base.entry.serial,
            stationResolvedSerial: base.entry.stationResolvedSerial, stationFields: base.entry.stationFields,
            scorePolicy: base.entry.scorePolicy)
        var columns = base.exportProjection!.columns.filter { $0.source != .receivedField("qth") }
        let contactIndex = try XCTUnwrap(columns.firstIndex { $0.source == .contactedCallsign })
        columns.insert(.init(source: .receivedField("qth"), width: 20, required: false), at: contactIndex)
        let rule = DeclarativeContestRule(definition: try replacing(
            base, entry: entry, projection: .init(formatterVersion: base.exportProjection!.formatterVersion,
                                                  columns: columns)).materialized())
        let sent = tenTenFields(name: "OLIVER", member: "1234", qth: "AUSTRALIA")
        let session = ContestSessionSnapshot(
            id: UUID(uuidString: "EA000000-0000-0000-0000-000000000020")!,
            workspaceGeneration: generation, rule: rule.metadata.identity,
            referenceDataVersion: "optional-column", startedAt: timestamp,
            station: .init(callsign: "OM0RX", entity: nil,
                           sentExchange: "OLIVER 1234 AUSTRALIA", operatorCallsigns: ["OM0RX"],
                           location: "DX", sentExchangeFields: sent))
        let receivedFields = ["name": field("AL"), "member-number": field("0")]
        let qso = ContestQSO(
            id: UUID(uuidString: "EA000000-0000-0000-0000-000000000021")!, sessionID: session.id,
            timestampUTC: timestamp, callsign: "K1ABC", band: "10m", mode: "CW",
            frequencyHz: 28_050_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "OLIVER 1234 AUSTRALIA", normalizedSent: "OLIVER 1234 AUSTRALIA",
                            rawReceived: "AL 0", normalizedReceived: "AL 0", sentFields: sent,
                            receivedFields: receivedFields), entity: nil, operatorCallsign: "OM0RX",
            stationLocation: "DX", provenance: .init(source: .operatorEntry))
        let line = try CabrilloExporter.qsoLine(qso, session: session, rule: rule)
        XCTAssertTrue(line.contains("                    K1ABC"), line)
    }

    func testCallsignComponentsRejectEmptySegmentsButPermitPortableSuffixes() throws {
        let rule = try CWUniqueCallDeclarativeDefinitions.rule(for: .cwt)
        let session = makeSession(rule: rule, variant: .cwt)
        for invalid in ["/K1ABC", "K1ABC/", "K1//ABC"] {
            let result = rule.evaluate(makeQSO(rule: rule, session: session, variant: .cwt, id: 4, call: invalid), in: session)
            XCTAssertTrue(result.validation.contains { $0.code == "invalidCallsign" }, invalid)
        }
        for valid in ["OM/K1ABC", "K1ABC/P", "K1ABC/MM"] {
            let result = rule.evaluate(makeQSO(rule: rule, session: session, variant: .cwt, id: 5, call: valid), in: session)
            XCTAssertFalse(result.validation.contains { $0.code == "invalidCallsign" }, valid)
        }
    }

    private func replacing(_ base: ContestDefinitionDraft, cabrilloName: String? = nil,
                           entry: ContestEntryDescriptor? = nil,
                           projection: ContestDeclarativeExportProjection? = nil) -> ContestDefinitionDraft {
        ContestDefinitionDraft(
            id: base.id, version: base.version, edition: base.edition, displayName: base.displayName,
            cabrilloName: cabrilloName ?? base.cabrilloName, supportedBands: base.supportedBands,
            supportedModes: base.supportedModes, entry: entry ?? base.entry, sourceProvenance: base.sourceProvenance,
            dupePolicy: base.dupePolicy, multiplierPolicy: base.multiplierPolicy, scoring: base.scoring,
            eligibilityPolicy: base.eligibilityPolicy, exportPolicy: base.exportPolicy,
            exportProjection: projection ?? base.exportProjection,
            stationEntityRequired: base.stationEntityRequired, adapterID: base.adapterID)
    }

    private func makeSession(rule: DeclarativeContestRule, variant: CWUniqueCallContestVariant) -> ContestSessionSnapshot {
        let fields: [String: ContestExchangeFieldValue]
        let aggregate: String
        switch variant {
        case .cwt: fields = ["name": field("OLIVER"), "member-or-location": field("1234")]; aggregate = "OLIVER 1234"
        case .cwOpen, .icwcMST: fields = ["name": field("OLIVER")]; aggregate = "OLIVER"
        }
        return .init(id: UUID(uuidString: "EA000000-0000-0000-0000-000000000002")!,
                     workspaceGeneration: generation, rule: rule.metadata.identity,
                     referenceDataVersion: "archive-test", startedAt: timestamp,
                     station: .init(callsign: "OM0RX", entity: nil, sentExchange: aggregate,
                                    operatorCallsigns: ["OM0RX"], location: "DX", sentExchangeFields: fields))
    }

    private func makeQSO(rule: DeclarativeContestRule, session: ContestSessionSnapshot,
                         variant: CWUniqueCallContestVariant, id: Int, call: String) -> ContestQSO {
        let sent: [String: ContestExchangeFieldValue]
        let received: [String: ContestExchangeFieldValue]
        let sentAggregate: String
        let receivedAggregate: String
        switch variant {
        case .cwt:
            sent = ["name": field("OLIVER"), "member-or-location": field("1234")]
            received = ["name": field("AL"), "member-or-location": field("NEW ZEALAND")]
            sentAggregate = "OLIVER 1234"; receivedAggregate = "AL NEW ZEALAND"
        case .cwOpen:
            sent = ["serial": field("001"), "name": field("OLIVER")]
            received = ["serial": field("101"), "name": field("AL")]
            sentAggregate = "001 OLIVER"; receivedAggregate = "101 AL"
        case .icwcMST:
            sent = ["name": field("OLIVER"), "serial": field("001")]
            received = ["name": field("AL"), "serial": field("101")]
            sentAggregate = "OLIVER 001"; receivedAggregate = "AL 101"
        }
        return .init(id: UUID(uuidString: String(format: "EA000000-0000-0000-0001-%012d", id))!,
                     sessionID: session.id, timestampUTC: timestamp.addingTimeInterval(TimeInterval(id)),
                     callsign: call, band: "20m", mode: "CW", frequencyHz: 14_030_000,
                     rstSent: "", rstReceived: "",
                     exchange: .init(rawSent: sentAggregate, normalizedSent: sentAggregate,
                                     rawReceived: receivedAggregate, normalizedReceived: receivedAggregate,
                                     sentFields: sent, receivedFields: received), entity: nil,
                     operatorCallsign: "OM0RX", stationLocation: "DX",
                     provenance: .init(source: .operatorEntry))
    }

    private func replacingReceived(_ qso: ContestQSO, aggregate: String,
                                   fields: [String: ContestExchangeFieldValue]) -> ContestQSO {
        .init(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
              callsign: qso.callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
              rstSent: qso.rstSent, rstReceived: qso.rstReceived,
              exchange: .init(rawSent: qso.exchange.rawSent,
                              normalizedSent: qso.exchange.normalizedSent,
                              rawReceived: aggregate, normalizedReceived: aggregate,
                              sentFields: qso.exchange.sentFields, receivedFields: fields),
              entity: qso.entity, operatorCallsign: qso.operatorCallsign,
              stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func input(rule: DeclarativeContestRule, session: ContestSessionSnapshot,
                       qsos: [ContestQSO]) -> ContestExportInput {
        let header = CabrilloHeader(callsign: "OM0RX", categoryOperator: "SINGLE-OP",
                                    categoryAssisted: "NON-ASSISTED", categoryBand: "ALL",
                                    categoryMode: "CW", categoryTransmitter: "ONE",
                                    categoryPower: "LOW", operators: ["OM0RX"], location: "DX")
        return .init(formatterVersion: rule.metadata.entry.cabrilloFormatterVersion,
                     generatedAtUTC: timestamp.addingTimeInterval(100), sessionRevision: 2,
                     session: session, ruleIdentity: rule.metadata.identity,
                     referenceDataVersion: session.referenceDataVersion,
                     metadata: .init(sessionName: "Archive", operatorCallsign: "OM0RX",
                                     operatorCategory: "SINGLE-OP", cabrilloHeader: header), qsos: qsos)
    }

    private func field(_ value: String) -> ContestExchangeFieldValue { .init(raw: value, normalized: value) }

    private func tenTenFields(name: String, member: String, qth: String) -> [String: ContestExchangeFieldValue] {
        ["name": field(name), "member-number": field(member), "qth": field(qth)]
    }
}
