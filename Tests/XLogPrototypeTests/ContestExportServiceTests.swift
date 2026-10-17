import Foundation
import XCTest
import XContestCore
import XContestStore
@testable import XLogPrototypeSupport

final class ContestExportServiceTests: XCTestCase {
    private let generation = UUID(uuidString: "d1111111-2222-4333-8444-555555555555")!
    private let baseDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)
    private let usa = ContestEntitySnapshot(adif: 291, name: "UNITED STATES", countryPrefix: "K", continent: "NA", cqZone: 5)
    private let germany = ContestEntitySnapshot(adif: 230, name: "GERMANY", countryPrefix: "DL", continent: "EU", cqZone: 14)

    func testActualSQLiteFourPilotsProduceBothImmutableFormats() async throws {
        for rule in [CQWWCWRule() as any ContestRule, CQWPXCWRule() as any ContestRule,
                     CQWWSSBRule() as any ContestRule, CQWPXSSBRule() as any ContestRule] {
            let fixture = try await makeFixture(rule: rule, category: "Single Operator")
            _ = try await commit(fixture, number: 1, call: "K1ABC", entity: usa)
            let stored = try await fixture.store.openSession(id: fixture.sessionID)
            let service = ContestExportService(repository: fixture.store)
            let header = makeHeader(name: "Oliver Operator", mode: rule.metadata.entry.mode)
            let cabrillo = try await service.export(sessionID: fixture.sessionID, expectedWorkspaceGeneration: generation,
                expectedRevision: stored.revision, generatedAtUTC: baseDate.addingTimeInterval(100),
                format: .cabrillo, header: header)
            let adif = try await service.export(sessionID: fixture.sessionID, expectedWorkspaceGeneration: generation,
                expectedRevision: stored.revision, generatedAtUTC: baseDate.addingTimeInterval(100),
                format: .adif, header: header)
            XCTAssertEqual(cabrillo.qsoCount, 1)
            XCTAssertEqual(adif.qsoCount, 1)
            XCTAssertEqual(cabrillo.ruleIdentity, rule.metadata.identity)
            XCTAssertEqual(adif.ruleIdentity, rule.metadata.identity)
            XCTAssertEqual(cabrillo.formatterVersion, rule.metadata.entry.cabrilloProjectionFormatterVersion)
            XCTAssertEqual(adif.formatterVersion, rule.metadata.entry.cabrilloFormatterVersion)
            let cabrilloText = try XCTUnwrap(String(data: cabrillo.data, encoding: .utf8))
            let adifText = try XCTUnwrap(String(data: adif.data, encoding: .utf8))
            XCTAssertTrue(cabrilloText.contains(" \(rule.metadata.entry.cabrilloQSOType) "))
            XCTAssertTrue(adifText.contains("<MODE:\(rule.metadata.entry.adifMode.utf8.count)>\(rule.metadata.entry.adifMode)"))
            XCTAssertEqual(adifText.contains("<STX:"), rule.metadata.entry.exchange.adifFields == .stxSrx)
            XCTAssertEqual(adifText.contains("<SRX:"), rule.metadata.entry.exchange.adifFields == .stxSrx)
            XCTAssertEqual(cabrillo.sessionName, stored.metadata.name)
            XCTAssertEqual(cabrillo.requestedHeader.name, "Oliver Operator")
            XCTAssertEqual(cabrillo.station.location, "")
            XCTAssertEqual(String(data: cabrillo.data, encoding: .utf8)?.contains("CONTEST: \(rule.metadata.cabrilloName)"), true)
            XCTAssertEqual(String(data: adif.data, encoding: .utf8)?.contains("<CONTEST_ID:\(rule.metadata.cabrilloName.count)>\(rule.metadata.cabrilloName)"), true)
        }
    }

    func testGenerationRevisionAndIdentityFencesFailClosed() async throws {
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op")
        let service = ContestExportService(repository: fixture.store)
        let stored = try await fixture.store.openSession(id: fixture.sessionID)
        let header = makeHeader(name: stored.metadata.name)
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: UUID(), expectedRevision: stored.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)) {
            XCTAssertEqual($0 as? ContestExportServiceError, .staleWorkspaceGeneration)
        }
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: stored.revision + 1,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)) {
            XCTAssertEqual($0 as? ContestExportServiceError,
                           .staleRevision(expected: stored.revision + 1, actual: stored.revision))
        }
    }

    func testCategoryAliasesAndSupplementalHeaderValidation() async throws {
        for alias in ["Single Operator", "single-op"] {
            let fixture = try await makeFixture(rule: CQWWCWRule(), category: alias)
            let revision = try await fixture.store.openSession(id: fixture.sessionID).revision
            _ = try await ContestExportService(repository: fixture.store).export(sessionID: fixture.sessionID,
                expectedWorkspaceGeneration: generation, expectedRevision: revision, generatedAtUTC: baseDate,
                format: .cabrillo, header: makeHeader(name: fixture.name))
        }
        let unknown = try await makeFixture(rule: CQWWCWRule(), category: "freestyle")
        let unknownRevision = try await unknown.store.openSession(id: unknown.sessionID).revision
        await XCTAssertThrowsErrorAsync(try await ContestExportService(repository: unknown.store).export(
            sessionID: unknown.sessionID, expectedWorkspaceGeneration: generation, expectedRevision: unknownRevision,
            generatedAtUTC: baseDate, format: .cabrillo, header: makeHeader(name: unknown.name))) {
            XCTAssertEqual($0 as? ContestExportServiceError, .unsupportedOperatorCategory("freestyle"))
        }
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op")
        let revision = try await fixture.store.openSession(id: fixture.sessionID).revision
        let service = ContestExportService(repository: fixture.store)
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision, generatedAtUTC: baseDate,
            format: .cabrillo, header: makeHeader(name: fixture.name, categoryOperator: "MULTI-OP")))
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision, generatedAtUTC: baseDate,
            format: .cabrillo, header: makeHeader(name: fixture.name, club: "bad\nheader")))
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: Date(timeIntervalSinceReferenceDate: .infinity), format: .cabrillo,
            header: makeHeader(name: fixture.name)))
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision, generatedAtUTC: baseDate,
            format: .cabrillo, header: makeHeader(name: fixture.name,
                addressLines: [String(repeating: "A", count: 161)])))
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision, generatedAtUTC: baseDate,
            format: .cabrillo, header: makeHeader(name: fixture.name, overlay: "CLASSIC")))
    }

    func testRealWorkerShapedStationAcceptsExplicitSubmissionIdentityAndRequiresActualOperator() async throws {
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op",
            name: "WW Saturday", operatorCallsign: "OM1ABC",
            stationOperators: ["OM1ABC"], stationLocation: "")
        let revision = try await fixture.store.openSession(id: fixture.sessionID).revision
        let service = ContestExportService(repository: fixture.store)
        await XCTAssertThrowsErrorAsync(try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: baseDate, format: .cabrillo,
            header: makeHeader(name: "Oliver Operator", operators: ["OM0RX"], location: "DX"))) {
            XCTAssertEqual($0 as? ContestExportServiceError, .contradictoryHeader("operators"))
        }

        let artifact = try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: revision,
            generatedAtUTC: baseDate, format: .cabrillo,
            header: makeHeader(name: "Oliver Operator", operators: ["OM0RX", "OM1ABC"], location: "DX"))
        let document = try XCTUnwrap(String(data: artifact.data, encoding: .utf8))
        XCTAssertEqual(artifact.sessionName, "WW Saturday")
        XCTAssertEqual(artifact.operatorCallsign, "OM1ABC")
        XCTAssertEqual(artifact.station.location, "")
        XCTAssertTrue(document.contains("NAME: Oliver Operator\r\n"))
        XCTAssertTrue(document.contains("LOCATION: DX\r\n"))
        XCTAssertTrue(document.contains("OPERATORS: OM0RX, OM1ABC\r\n"))
    }

    func testCorrectionDeletionAndDuplicateRetentionUseCurrentAtomicSnapshot() async throws {
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op")
        let first = try await commit(fixture, number: 1, call: "K1ABC", entity: usa)
        let second = try await commit(fixture, number: 2, call: "K1ABC", entity: usa)
        let service = ContestExportService(repository: fixture.store)
        let header = makeHeader(name: fixture.name)
        let duplicateArtifact = try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: second.session.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)
        XCTAssertEqual(duplicateArtifact.qsoCount, 2)
        XCTAssertEqual(duplicateArtifact.claimedScore, 6)
        XCTAssertEqual(String(data: duplicateArtifact.data, encoding: .utf8)?.components(separatedBy: "QSO: ").count, 3)

        let corrected = copy(second.qso, callsign: "DL1AAA", entity: germany)
        let correction = try await fixture.store.correctQSO(corrected, reason: "Correct call",
            operationTimestamp: baseDate.addingTimeInterval(30),
            scope: scope(fixture, request: 50, revision: second.session.revision, digest: "correct", includeDraft: false),
            committedAt: baseDate.addingTimeInterval(30))
        let correctedArtifact = try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: correction.session.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)
        XCTAssertEqual(correctedArtifact.qsoCount, 2)
        XCTAssertEqual(correctedArtifact.claimedScore, 12)

        let deleted = try await fixture.store.deleteQSO(id: first.qso.id, reason: "Remove contact",
            operationTimestamp: baseDate.addingTimeInterval(31),
            scope: scope(fixture, request: 51, revision: correction.session.revision, digest: "delete", includeDraft: false),
            committedAt: baseDate.addingTimeInterval(31))
        let deletedArtifact = try await service.export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: deleted.session.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)
        XCTAssertEqual(deletedArtifact.qsoCount, 1)
        XCTAssertEqual(deletedArtifact.claimedScore, 2)
        XCTAssertNotEqual(correctedArtifact.data, deletedArtifact.data)
    }

    func testCapturedSnapshotArtifactSurvivesLaterWriterAndNextExportAdvances() async throws {
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op")
        let first = try await commit(fixture, number: 1, call: "K1ABC", entity: usa)
        let captured = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID)
        let corrected = copy(first.qso, callsign: "DL1AAA", entity: germany)
        let correctionTime = baseDate.addingTimeInterval(40)
        let correctionScope = scope(fixture, request: 60, revision: captured.session.revision,
                                    digest: "later", includeDraft: false)
        let wrapper = SnapshotOnlyRepository(snapshot: captured) { [store = fixture.store] in
            _ = try await store.correctQSO(corrected, reason: "Writer after capture",
                operationTimestamp: correctionTime, scope: correctionScope, committedAt: correctionTime)
        }
        let header = makeHeader(name: fixture.name)
        let old = try await ContestExportService(repository: wrapper).export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: captured.session.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)
        let readCount = await wrapper.readCount
        XCTAssertEqual(readCount, 1)
        XCTAssertEqual(old.revision, captured.session.revision)
        XCTAssertEqual(old.claimedScore, 6)
        let current = try await fixture.store.openSession(id: fixture.sessionID)
        let next = try await ContestExportService(repository: fixture.store).export(sessionID: fixture.sessionID,
            expectedWorkspaceGeneration: generation, expectedRevision: current.revision,
            generatedAtUTC: baseDate, format: .cabrillo, header: header)
        XCTAssertEqual(String(data: old.data, encoding: .utf8)?.contains("K1ABC"), true)
        XCTAssertEqual(String(data: next.data, encoding: .utf8)?.contains("DL1AAA"), true)
        XCTAssertNotEqual(old.revision, next.revision)
        XCTAssertNotEqual(old.data, next.data)
    }

    func testSingleBandServiceMetadataUsesProjectionWhileDocumentRetainsOffBandQSO() async throws {
        let fixture = try await makeFixture(rule: CQWWCWRule(), category: "single-op")
        _ = try await commit(fixture, number: 1, call: "K1ABC", entity: usa, band: "40m")
        let selected = try await commit(fixture, number: 2, call: "DL1AAA", entity: germany, band: "20m")
        let artifact = try await ContestExportService(repository: fixture.store).export(
            sessionID: fixture.sessionID, expectedWorkspaceGeneration: generation,
            expectedRevision: selected.session.revision, generatedAtUTC: baseDate,
            format: .cabrillo, header: makeHeader(name: fixture.name, band: "20M"))
        let document = try XCTUnwrap(String(data: artifact.data, encoding: .utf8))
        XCTAssertEqual(artifact.formatterVersion, ContestExportInput.submissionProjectionFormatterVersion)
        XCTAssertEqual(artifact.qsoCount, 2)
        XCTAssertEqual(artifact.totalPoints, 1)
        XCTAssertEqual(artifact.multiplierCount, 2)
        XCTAssertEqual(artifact.claimedScore, 2)
        XCTAssertEqual(document.components(separatedBy: "QSO: ").count, 3)
        XCTAssertTrue(document.contains(" 7025 CW"))
        XCTAssertTrue(document.contains("14025 CW"))
        XCTAssertTrue(document.contains("CLAIMED-SCORE: 2\r\n"))
    }

    func testExportIsDeterministicAndDoesNotMutateStoreState() async throws {
        let fixture = try await makeFixture(rule: CQWPXCWRule(), category: "single-op")
        _ = try await commit(fixture, number: 1, call: "K1ABC", entity: usa)
        let before = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID)
        let createReceipt = try await fixture.store.operationReceipt(sessionID: fixture.sessionID,
            workspaceGeneration: generation, requestID: fixture.draftID, payloadDigest: "create")
        let service = ContestExportService(repository: fixture.store)
        let header = makeHeader(name: fixture.name)
        let first = try await service.export(sessionID: fixture.sessionID, expectedWorkspaceGeneration: generation,
            expectedRevision: before.session.revision, generatedAtUTC: baseDate, format: .adif, header: header)
        let second = try await service.export(sessionID: fixture.sessionID, expectedWorkspaceGeneration: generation,
            expectedRevision: before.session.revision, generatedAtUTC: baseDate, format: .adif, header: header)
        let after = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID)
        let afterReceipt = try await fixture.store.operationReceipt(sessionID: fixture.sessionID,
            workspaceGeneration: generation, requestID: fixture.draftID, payloadDigest: "create")
        XCTAssertEqual(first, second)
        XCTAssertEqual(before, after)
        XCTAssertEqual(createReceipt, afterReceipt)
    }

    private struct Fixture: Sendable {
        let store: SQLiteContestStore
        let sessionID: UUID
        let draftID: UUID
        let name: String
        let rule: ContestRuleIdentity
        let operatorCallsign: String
        let stationLocation: String
    }

    private func makeFixture(rule: any ContestRule, category: String,
                             name: String = "Pilot export", operatorCallsign: String = "OM0RX",
                             stationOperators: [String] = ["OM0RX"], stationLocation: String = "") async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("contest-export-service-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = try SQLiteContestStore(databaseURL: root.appendingPathComponent("contests.sqlite"))
        let sessionID = UUID(), draftID = UUID()
        let station = ContestStationSnapshot(callsign: "OM0RX", entity: om,
            sentExchange: rule.metadata.entry.exchange.sentDefault == .stationSnapshot ? "15" : "001",
            operatorCallsigns: stationOperators, location: stationLocation)
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
            rule: rule.metadata.identity, referenceDataVersion: "cty-fixture-1", startedAt: baseDate, station: station)
        let draft = ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: 1, updatedAt: baseDate,
            callsign: "", band: "20m", mode: rule.metadata.entry.mode, frequencyHz: 14_025_000,
            rstSent: rule.metadata.entry.report.defaultSent, rstReceived: rule.metadata.entry.report.defaultReceived,
            exchange: .init(rawSent: station.sentExchange, normalizedSent: station.sentExchange,
                            rawReceived: "", normalizedReceived: ""), entity: nil,
            operatorCallsign: operatorCallsign, stationLocation: stationLocation)
        _ = try await store.createSession(session,
            metadata: .init(name: name, operatorCallsign: operatorCallsign, operatorCategory: category),
            initialDraft: draft,
            scope: .init(sessionID: sessionID, workspaceGeneration: generation, requestID: draftID,
                         expectedRevision: 0, draftID: draftID, payloadDigest: "create"), committedAt: baseDate)
        return Fixture(store: store, sessionID: sessionID, draftID: draftID, name: name,
                       rule: rule.metadata.identity, operatorCallsign: operatorCallsign,
                       stationLocation: stationLocation)
    }

    private func commit(_ fixture: Fixture, number: Int, call: String,
                        entity: ContestEntitySnapshot, band: String = "20m") async throws -> ContestQSOCommitResult {
        let stored = try await fixture.store.openSession(id: fixture.sessionID)
        var revision = stored.revision
        var reservation: ContestSerialReservation?
        let rule = try XCTUnwrap(ContestRuleRegistry.pilots.rule(for: fixture.rule))
        if rule.metadata.entry.serial.requirement == .requiredForCommit {
            let result = try await fixture.store.reserveSerial(reservationID: fixedUUID(1_000 + number), serialScope: .session,
                scopeValue: "", scope: scope(fixture, request: 100 + number, revision: revision,
                                              digest: "reserve-\(number)"),
                committedAt: baseDate.addingTimeInterval(Double(number)))
            reservation = result.reservation
            revision = result.session.revision
        }
        let sent = reservation?.transmittedText ?? "15"
        let qso = ContestQSO(id: fixedUUID(2_000 + number), sessionID: fixture.sessionID,
            timestampUTC: baseDate.addingTimeInterval(Double(number)), callsign: call, band: band, mode: rule.metadata.entry.mode,
            frequencyHz: band == "40m" ? 7_025_000 : 14_025_000,
            rstSent: rule.metadata.entry.report.defaultSent, rstReceived: rule.metadata.entry.report.defaultReceived,
            exchange: .init(rawSent: sent, normalizedSent: sent,
                            rawReceived: rule.metadata.entry.exchange.received == .cqZone ? "5" : "101",
                            normalizedReceived: rule.metadata.entry.exchange.received == .cqZone ? "5" : "101"),
            entity: entity, operatorCallsign: fixture.operatorCallsign,
            stationLocation: fixture.stationLocation,
            provenance: .init(source: .operatorEntry))
        return try await fixture.store.commitQSO(qso, reservationID: reservation?.id,
            scope: scope(fixture, request: 200 + number, revision: revision, digest: "commit-\(number)"),
            committedAt: baseDate.addingTimeInterval(Double(10 + number)))
    }

    private func scope(_ fixture: Fixture, request: Int, revision: UInt64,
                       digest: String, includeDraft: Bool = true) -> ContestMutationScope {
        .init(sessionID: fixture.sessionID, workspaceGeneration: generation, requestID: fixedUUID(3_000 + request),
              expectedRevision: revision, draftID: includeDraft ? fixture.draftID : nil, payloadDigest: digest)
    }

    private func makeHeader(name: String, categoryOperator: String = "SINGLE-OP",
                            club: String? = "OM CONTEST CLUB", addressLines: [String] = ["Test Street 1"],
                             operators: [String] = ["OM0RX"], location: String = "DX",
                             band: String = "ALL", overlay: String? = nil,
                             mode: String = "CW") -> CabrilloHeader {
        CabrilloHeader(callsign: "OM0RX", categoryOperator: categoryOperator, categoryAssisted: "NON-ASSISTED",
            categoryBand: band, categoryMode: mode, categoryTransmitter: "ONE", categoryPower: "LOW",
            categoryOverlay: overlay, operators: operators, location: location, club: club,
            name: name, addressLines: addressLines, email: "operator@example.test")
    }

    private func copy(_ qso: ContestQSO, callsign: String, entity: ContestEntitySnapshot) -> ContestQSO {
        ContestQSO(id: qso.id, sessionID: qso.sessionID, timestampUTC: qso.timestampUTC,
            callsign: callsign, band: qso.band, mode: qso.mode, frequencyHz: qso.frequencyHz,
            rstSent: qso.rstSent, rstReceived: qso.rstReceived, exchange: qso.exchange, entity: entity,
            operatorCallsign: qso.operatorCallsign, stationLocation: qso.stationLocation, provenance: qso.provenance)
    }

    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!
    }
}

private func XCTAssertThrowsErrorAsync<T>(_ expression: @autoclosure () async throws -> T,
                                          _ verify: (Error) -> Void = { _ in }) async {
    do { _ = try await expression(); XCTFail("Expected error") }
    catch { verify(error) }
}

private actor SnapshotOnlyRepository: ContestDurableRepository {
    enum Failure: Error { case unexpected }
    let snapshot: ContestSessionReadSnapshot
    let afterRead: @Sendable () async throws -> Void
    private(set) var readCount = 0
    init(snapshot: ContestSessionReadSnapshot, afterRead: @escaping @Sendable () async throws -> Void) {
        self.snapshot = snapshot; self.afterRead = afterRead
    }
    func sessionReadSnapshot(id: UUID) async throws -> ContestSessionReadSnapshot {
        readCount += 1
        guard id == snapshot.session.session.id else { throw Failure.unexpected }
        let captured = snapshot
        try await afterRead()
        return captured
    }
    func createSession(_ session: ContestSessionSnapshot, metadata: ContestSessionMetadata, initialDraft: ContestDraftSnapshot, scope: ContestMutationScope, committedAt: Date) async throws -> ContestSessionCreationResult { throw Failure.unexpected }
    func openSession(id: UUID) async throws -> StoredContestSession { throw Failure.unexpected }
    func listStoredSessions() async throws -> [StoredContestSession] { throw Failure.unexpected }
    func sessionPageSnapshot(id: UUID, offset: Int, limit: Int) async throws -> ContestSessionPageSnapshot { throw Failure.unexpected }
    func listSessionReadSnapshots() async throws -> [ContestSessionReadSnapshot] { throw Failure.unexpected }
    func operationReceipt(sessionID: UUID, workspaceGeneration: UUID, requestID: UUID, payloadDigest: String) async throws -> ContestMutationReceipt? { throw Failure.unexpected }
    func draft(sessionID: UUID, id: UUID) async throws -> ContestDraftSnapshot { throw Failure.unexpected }
    func drafts(sessionID: UUID) async throws -> [ContestDraftSnapshot] { throw Failure.unexpected }
    func updateDraft(_ draft: ContestDraftSnapshot, scope: ContestMutationScope, committedAt: Date) async throws -> ContestDraftMutationResult { throw Failure.unexpected }
    func reserveSerial(reservationID: UUID, serialScope: ContestSerialScope, scopeValue: String, scope: ContestMutationScope, committedAt: Date) async throws -> ContestSerialReservationResult { throw Failure.unexpected }
    func reservation(id: UUID) async throws -> ContestSerialReservation { throw Failure.unexpected }
    func reservations(sessionID: UUID, draftID: UUID) async throws -> [ContestSerialReservation] { throw Failure.unexpected }
    func activeReservations(sessionID: UUID, draftID: UUID) async throws -> [ContestSerialReservation] { throw Failure.unexpected }
    func transitionSerial(reservationID: UUID, to state: ContestSerialState, scope: ContestMutationScope, committedAt: Date) async throws -> ContestSerialTransitionResult { throw Failure.unexpected }
    func commitQSO(_ qso: ContestQSO, reservationID: UUID?, scope: ContestMutationScope, committedAt: Date) async throws -> ContestQSOCommitResult { throw Failure.unexpected }
    func qso(sessionID: UUID, id: UUID) async throws -> ContestQSO { throw Failure.unexpected }
    func qsoReadSnapshot(sessionID: UUID, id: UUID, expectedWorkspaceGeneration: UUID, expectedRevision: UInt64) async throws -> ContestQSOReadSnapshot { throw Failure.unexpected }
    func correctQSO(_ corrected: ContestQSO, reason: String, operationTimestamp: Date, scope: ContestMutationScope, committedAt: Date) async throws -> ContestQSOChangeResult { throw Failure.unexpected }
    func deleteQSO(id: UUID, reason: String, operationTimestamp: Date, scope: ContestMutationScope, committedAt: Date) async throws -> ContestQSOChangeResult { throw Failure.unexpected }
    func qsoAuditTrail(sessionID: UUID, qsoID: UUID) async throws -> [ContestQSOAuditRecord] { throw Failure.unexpected }
    func logPage(sessionID: UUID, offset: Int, limit: Int) async throws -> ContestLogPage { throw Failure.unexpected }
    func scoreSnapshot(sessionID: UUID) async throws -> ContestScoreSnapshot { throw Failure.unexpected }
}
