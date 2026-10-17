import Foundation
import XCTest
import XContestCore
import XContestStore
@testable import XLogPrototypeSupport

final class ContestExportLaneTests: XCTestCase {
    private let generation = UUID(uuidString: "d1111111-2222-4333-8444-555555555555")!
    private let baseDate = Date(timeIntervalSince1970: 1_800_000_000)
    private let om = ContestEntitySnapshot(adif: 504, name: "SLOVAK REPUBLIC", countryPrefix: "OM", continent: "EU", cqZone: 15)

    func testPrepareAndChunkReassemblyForBothFormatsUsesActualService() async throws {
        let fixture = try await makeFixture()
        let lane = ContestExportLane(service: ContestExportService(repository: fixture.store)) { [generation] in generation }
        for (index, format) in [ContestExportFormat.cabrillo, .adif].enumerated() {
            let request = prepare(fixture, exportID: fixedUUID(100 + index), revision: fixture.revision, format: format)
            let prepared = try await lane.prepare(request)
            var bytes = Data(), offset = 0
            while offset < prepared.byteLength {
                let length = min(17, prepared.byteLength - offset)
                let chunk = try await lane.read(.init(exportID: request.exportID, sessionID: fixture.sessionID,
                    workspaceGeneration: generation, offset: offset, length: length))
                XCTAssertEqual(chunk.offset, offset)
                bytes.append(try XCTUnwrap(Data(base64Encoded: chunk.dataBase64)))
                offset += length
                XCTAssertEqual(chunk.eof, offset == prepared.byteLength)
            }
            XCTAssertEqual(bytes.count, prepared.byteLength)
            XCTAssertEqual(prepared.sha256.count, 64)
            let text = try XCTUnwrap(String(data: bytes, encoding: .utf8))
            XCTAssertTrue(format == .cabrillo ? text.hasPrefix("START-OF-LOG: 3.0\r\n") : text.contains("<ADIF_VER:5>3.1.7"))
        }
    }

    func testReplayKeepsHistoricalBytesAfterWriterAndChangedRequestConflicts() async throws {
        let fixture = try await makeFixture()
        let lane = ContestExportLane(service: ContestExportService(repository: fixture.store)) { [generation] in generation }
        let request = prepare(fixture, exportID: fixedUUID(200), revision: fixture.revision, format: .cabrillo)
        let first = try await lane.prepare(request)
        let firstBytes = try await readAll(lane, prepared: first)

        let draft = try await fixture.store.draft(sessionID: fixture.sessionID, id: fixture.draftID)
        let changed = ContestDraftSnapshot(id: draft.id, sessionID: draft.sessionID, revision: fixture.revision + 1,
            updatedAt: baseDate.addingTimeInterval(10), callsign: "K1ABC", band: draft.band, mode: draft.mode,
            frequencyHz: draft.frequencyHz, rstSent: draft.rstSent, rstReceived: draft.rstReceived,
            exchange: draft.exchange, entity: nil, operatorCallsign: draft.operatorCallsign,
            stationLocation: draft.stationLocation)
        let mutation = try await fixture.store.updateDraft(changed,
            scope: .init(sessionID: fixture.sessionID, workspaceGeneration: generation,
                         requestID: fixedUUID(201), expectedRevision: fixture.revision,
                         draftID: fixture.draftID, payloadDigest: "writer"),
            committedAt: baseDate.addingTimeInterval(10))

        let replay = try await lane.prepare(request)
        XCTAssertEqual(replay, first)
        let replayBytes = try await readAll(lane, prepared: replay)
        XCTAssertEqual(replayBytes, firstBytes)
        var changedRequest = request
        changedRequest = .init(exportID: request.exportID, sessionID: request.sessionID,
            workspaceGeneration: request.workspaceGeneration, expectedRevision: mutation.session.revision,
            generatedAtUTC: request.generatedAtUTC, format: request.format, header: request.header)
        await assertError("request_conflict") { try await lane.prepare(changedRequest) }

        let nextRequest = prepare(fixture, exportID: fixedUUID(202), revision: mutation.session.revision, format: .cabrillo)
        let next = try await lane.prepare(nextRequest)
        XCTAssertEqual(next.revision, mutation.session.revision)
    }

    func testExpiryRestartReleaseAndScopeFencesFailClosed() async throws {
        let fixture = try await makeFixture()
        let clock = ExportTestClock()
        let limits = ContestExportArtifactCache.Limits(maxArtifacts: 4, maxAggregateBytes: 1_000_000,
            maxArtifactBytes: 1_000_000, maxKnownRequests: 32, ttlNanoseconds: 100, chunkLimit: 64)
        let cache = ContestExportArtifactCache(limits: limits) { clock.now }
        let generationBox = ExportGenerationBox(generation)
        let lane = ContestExportLane(service: ContestExportService(repository: fixture.store),
            generationSource: { await generationBox.value }, cache: cache)
        let request = prepare(fixture, exportID: fixedUUID(300), revision: fixture.revision, format: .adif)
        let prepared = try await lane.prepare(request)
        let wrongSession = ContestExportReadRequest(exportID: request.exportID, sessionID: UUID(),
            workspaceGeneration: generation, offset: 0, length: min(1, prepared.byteLength))
        await assertError("wrong_scope") { try await lane.read(wrongSession) }
        await generationBox.set(UUID())
        await assertError("stale_workspace") { try await lane.read(.init(exportID: request.exportID,
            sessionID: fixture.sessionID, workspaceGeneration: generation, offset: 0, length: 1)) }
        await generationBox.set(generation)
        await assertError("artifact_unavailable") { try await lane.read(.init(exportID: request.exportID,
            sessionID: fixture.sessionID, workspaceGeneration: generation, offset: 0, length: 1)) }

        let releasable = prepare(fixture, exportID: fixedUUID(302), revision: fixture.revision, format: .adif)
        _ = try await lane.prepare(releasable)
        let released = try await lane.release(.init(exportID: releasable.exportID, sessionID: fixture.sessionID,
                                                    workspaceGeneration: generation))
        XCTAssertTrue(released.released)
        let releasedAgain = try await lane.release(.init(exportID: releasable.exportID, sessionID: fixture.sessionID,
                                                         workspaceGeneration: generation))
        XCTAssertFalse(releasedAgain.released)
        await assertError("artifact_unavailable") { try await lane.prepare(releasable) }

        let expiring = prepare(fixture, exportID: fixedUUID(301), revision: fixture.revision, format: .adif)
        _ = try await lane.prepare(expiring)
        clock.advance(100)
        await assertError("artifact_unavailable") { try await lane.read(.init(exportID: expiring.exportID,
            sessionID: fixture.sessionID, workspaceGeneration: generation, offset: 0, length: 1)) }
        await assertError("artifact_unavailable") { try await lane.prepare(expiring) }

        let restarted = ContestExportLane(service: ContestExportService(repository: fixture.store)) { [generation] in generation }
        await assertError("artifact_unavailable") { try await restarted.read(.init(exportID: expiring.exportID,
            sessionID: fixture.sessionID, workspaceGeneration: generation, offset: 0, length: 1)) }
        await lane.shutdown()
        await assertError("artifact_unavailable") { try await lane.prepare(
            prepare(fixture, exportID: fixedUUID(303), revision: fixture.revision, format: .adif)) }
    }

    func testCacheLimitsAndRangesAreBounded() async throws {
        let clock = ExportTestClock()
        let generationBox = ExportGenerationBox(generation)
        let limits = ContestExportArtifactCache.Limits(maxArtifacts: 1, maxAggregateBytes: 8,
            maxArtifactBytes: 6, maxKnownRequests: 8, ttlNanoseconds: 1_000, chunkLimit: 4)
        let cache = ContestExportArtifactCache(limits: limits) { clock.now }
        let sessionID = fixedUUID(400)
        let tooLargeID = fixedUUID(401)
        let om = om
        let lane = ContestExportLane(generationSource: { await generationBox.value }, cache: cache) { request in
            Self.artifact(request, bytes: request.exportID == tooLargeID ? 7 : 4, entity: om)
        }
        let tooLarge = directRequest(exportID: tooLargeID, sessionID: sessionID)
        await assertError("export_too_large") { try await lane.prepare(tooLarge) }
        let accepted = directRequest(exportID: fixedUUID(402), sessionID: sessionID)
        let prepared = try await lane.prepare(accepted)
        await assertError("invalid_range") { try await lane.read(.init(exportID: accepted.exportID,
            sessionID: sessionID, workspaceGeneration: generation, offset: 0, length: 5)) }
        await assertError("invalid_range") { try await lane.read(.init(exportID: accepted.exportID,
            sessionID: sessionID, workspaceGeneration: generation, offset: -1, length: 1)) }
        await assertError("cache_full") { try await lane.prepare(directRequest(exportID: fixedUUID(403), sessionID: sessionID)) }
        XCTAssertEqual(prepared.byteLength, 4)
    }

    func testWireParsingRejectsUnknownBooleanFractionalNegativeAndOversizedFields() async throws {
        let fixture = try await makeFixture()
        let lane = ContestExportLane(service: ContestExportService(repository: fixture.store)) { [generation] in generation }
        var params = wire(prepare(fixture, exportID: fixedUUID(500), revision: fixture.revision, format: .cabrillo))
        params["unexpected"] = true
        await assertError("invalid_params") { try await lane.handle(method: "contest_export_prepare", params: params) }
        params.removeValue(forKey: "unexpected"); params["expectedRevision"] = 1.5
        await assertError("invalid_params") { try await lane.handle(method: "contest_export_prepare", params: params) }
        params["expectedRevision"] = true
        await assertError("invalid_params") { try await lane.handle(method: "contest_export_prepare", params: params) }
        params = wire(prepare(fixture, exportID: fixedUUID(500), revision: fixture.revision, format: .cabrillo))
        var header = try XCTUnwrap(params["header"] as? [String: Any]); header["name"] = String(repeating: "x", count: 76)
        params["header"] = header
        await assertError("invalid_params") { try await lane.handle(method: "contest_export_prepare", params: params) }

        let valid = try await lane.handle(method: "contest_export_prepare",
            params: wire(prepare(fixture, exportID: fixedUUID(501), revision: fixture.revision, format: .cabrillo)))
        let byteLength = try XCTUnwrap((valid["byteLength"] as? NSNumber)?.intValue)
        await assertError("invalid_params") { try await lane.handle(method: "contest_export_read", params: [
            "exportID": wireID(fixedUUID(501)), "sessionID": wireID(fixture.sessionID),
            "workspaceGeneration": wireID(generation), "offset": -1, "length": min(1, byteLength)]) }

        let generationBox = ExportGenerationBox(generation), entity = om
        let attempts = ExportAttemptCounter { request in Self.artifact(request, bytes: 4, entity: entity) }
        let parsingLane = ContestExportLane(generationSource: { await generationBox.value },
            cache: ContestExportArtifactCache()) { request in try await attempts.produce(request) }
        let dateRequest = directRequest(exportID: fixedUUID(502), sessionID: fixture.sessionID)
        var invalidDate = wire(dateRequest); invalidDate["generatedAtUTC"] = "2027-02-30T08:01:00.000Z"
        await assertError("invalid_params") { try await parsingLane.handle(method: "contest_export_prepare", params: invalidDate) }
        invalidDate["generatedAtUTC"] = "2027-01-15T24:00:00.000Z"
        await assertError("invalid_params") { try await parsingLane.handle(method: "contest_export_prepare", params: invalidDate) }
        let callsAfterInvalidDates = await attempts.callCount
        XCTAssertEqual(callsAfterInvalidDates, 0)
        _ = try await parsingLane.handle(method: "contest_export_prepare", params: wire(dateRequest))
        let callsAfterValidDate = await attempts.callCount
        XCTAssertEqual(callsAfterValidDate, 1)
    }

    func testPendingProducerReservationsBoundArtifactAndAggregateCapacity() async throws {
        let sessionID = fixedUUID(800), entity = om
        let generationBox = ExportGenerationBox(generation)
        let gate = ExportProducerGate { request in Self.artifact(request, bytes: 4, entity: entity) }
        let oneSlot = ContestExportArtifactCache.Limits(maxArtifacts: 1, maxAggregateBytes: 100,
            maxArtifactBytes: 10, maxKnownRequests: 16, ttlNanoseconds: 1_000, chunkLimit: 4)
        let lane = ContestExportLane(generationSource: { await generationBox.value },
            cache: ContestExportArtifactCache(limits: oneSlot)) { request in try await gate.produce(request) }
        let first = directRequest(exportID: fixedUUID(801), sessionID: sessionID)
        let firstTask = Task { try await lane.prepare(first) }
        await gate.waitForStarts(1)
        await assertError("cache_full") { try await lane.prepare(
            directRequest(exportID: fixedUUID(802), sessionID: sessionID)) }
        let startsAtCapacity = await gate.startCount
        XCTAssertEqual(startsAtCapacity, 1)
        let released = try await lane.release(.init(exportID: first.exportID, sessionID: sessionID,
                                                    workspaceGeneration: generation))
        XCTAssertFalse(released.released)
        await assertError("cache_full") { try await lane.prepare(
            directRequest(exportID: fixedUUID(806), sessionID: sessionID)) }
        let startsWhileRetiredProducerRuns = await gate.startCount
        XCTAssertEqual(startsWhileRetiredProducerRuns, 1)
        await gate.resume(1)
        await assertTaskError("artifact_unavailable", firstTask)

        let third = directRequest(exportID: fixedUUID(803), sessionID: sessionID)
        let thirdTask = Task { try await lane.prepare(third) }
        await gate.waitForStarts(2)
        await gate.resume(2)
        let thirdPrepared = try await thirdTask.value
        XCTAssertEqual(thirdPrepared.byteLength, 4)

        let aggregateGate = ExportProducerGate { request in Self.artifact(request, bytes: 4, entity: entity) }
        let aggregateLimits = ContestExportArtifactCache.Limits(maxArtifacts: 2, maxAggregateBytes: 6,
            maxArtifactBytes: 4, maxKnownRequests: 16, ttlNanoseconds: 1_000, chunkLimit: 4)
        let aggregateLane = ContestExportLane(generationSource: { await generationBox.value },
            cache: ContestExportArtifactCache(limits: aggregateLimits)) { request in try await aggregateGate.produce(request) }
        let aggregateFirst = directRequest(exportID: fixedUUID(804), sessionID: sessionID)
        let aggregateTask = Task { try await aggregateLane.prepare(aggregateFirst) }
        await aggregateGate.waitForStarts(1)
        await assertError("cache_full") { try await aggregateLane.prepare(
            directRequest(exportID: fixedUUID(805), sessionID: sessionID)) }
        let aggregateStarts = await aggregateGate.startCount
        XCTAssertEqual(aggregateStarts, 1)
        await aggregateGate.resume(1)
        _ = try await aggregateTask.value

        let discardedGate = ExportProducerGate { request in Self.artifact(request, bytes: 4, entity: entity) }
        let discardedCache = ContestExportArtifactCache(limits: oneSlot)
        let obsoleteGeneration = fixedUUID(807)
        let obsolete = ContestExportPrepareRequest(exportID: fixedUUID(808), sessionID: sessionID,
            workspaceGeneration: obsoleteGeneration, expectedRevision: 1, generatedAtUTC: baseDate,
            format: .cabrillo, header: header())
        let obsoleteTask = Task { try await discardedCache.prepare(obsolete) {
            try await discardedGate.produce(obsolete)
        } }
        await discardedGate.waitForStarts(1)
        let applied = await discardedCache.applyGeneration(generation, ticket: 1)
        XCTAssertTrue(applied)
        let replacement = directRequest(exportID: fixedUUID(809), sessionID: sessionID)
        await assertError("cache_full") { try await discardedCache.prepare(replacement) {
            try await discardedGate.produce(replacement)
        } }
        let discardStartsAtCapacity = await discardedGate.startCount
        XCTAssertEqual(discardStartsAtCapacity, 1)
        await discardedGate.resume(1)
        await assertTaskError("artifact_unavailable", obsoleteTask)
        let replacementTask = Task { try await discardedCache.prepare(replacement) {
            try await discardedGate.produce(replacement)
        } }
        await discardedGate.waitForStarts(2)
        await discardedGate.resume(2)
        _ = try await replacementTask.value
    }

    func testPreparationAndReadsDoNotMutateDatabase() async throws {
        let fixture = try await makeFixture()
        let before = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID)
        let receiptBefore = try await fixture.store.operationReceipt(sessionID: fixture.sessionID,
            workspaceGeneration: generation, requestID: fixture.draftID, payloadDigest: "create")
        let lane = ContestExportLane(service: ContestExportService(repository: fixture.store)) { [generation] in generation }
        let prepared = try await lane.prepare(prepare(fixture, exportID: fixedUUID(600), revision: fixture.revision, format: .cabrillo))
        _ = try await readAll(lane, prepared: prepared)
        let after = try await fixture.store.sessionReadSnapshot(id: fixture.sessionID)
        let receiptAfter = try await fixture.store.operationReceipt(sessionID: fixture.sessionID,
            workspaceGeneration: generation, requestID: fixture.draftID, payloadDigest: "create")
        XCTAssertEqual(before, after)
        XCTAssertEqual(receiptBefore, receiptAfter)
    }

    func testOutOfOrderGenerationObservationsCannotDiscardNewerArtifactsOrSurviveShutdown() async throws {
        let controller = ExportGenerationController(), entity = om
        let cache = ContestExportArtifactCache()
        let lane = ContestExportLane(generationSource: { await controller.next() }, cache: cache) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let sessionID = fixedUUID(900)
        let oldGeneration = UUID(uuidString: "a1111111-2222-4333-8444-555555555555")!
        let oldRequest = ContestExportPrepareRequest(exportID: fixedUUID(901), sessionID: sessionID,
            workspaceGeneration: oldGeneration, expectedRevision: 1, generatedAtUTC: baseDate,
            format: .cabrillo, header: header())
        let delayedPre = Task { try await lane.prepare(oldRequest) }
        await controller.waitForCalls(1)

        let currentRequest = directRequest(exportID: fixedUUID(902), sessionID: sessionID)
        let currentTask = Task { try await lane.prepare(currentRequest) }
        await controller.waitForCalls(2); await controller.resolve(2, with: generation)
        await controller.waitForCalls(3); await controller.resolve(3, with: generation)
        let current = try await currentTask.value
        await controller.resolve(1, with: oldGeneration)
        await assertTaskError("workspace_fence_failed", delayedPre)
        let currentRead = Task { try await lane.read(.init(exportID: current.artifactID, sessionID: sessionID,
            workspaceGeneration: generation, offset: 0, length: 1)) }
        await controller.waitForCalls(4); await controller.resolve(4, with: generation)
        await controller.waitForCalls(5); await controller.resolve(5, with: generation)
        let currentChunk = try await currentRead.value
        XCTAssertEqual(currentChunk.dataBase64, "QQ==")

        let delayedPostRequest = directRequest(exportID: fixedUUID(903), sessionID: sessionID)
        let delayedPost = Task { try await lane.prepare(delayedPostRequest) }
        await controller.waitForCalls(6); await controller.resolve(6, with: generation)
        await controller.waitForCalls(7)
        let newerRequest = directRequest(exportID: fixedUUID(904), sessionID: sessionID)
        let newerTask = Task { try await lane.prepare(newerRequest) }
        await controller.waitForCalls(8); await controller.resolve(8, with: generation)
        await controller.waitForCalls(9); await controller.resolve(9, with: generation)
        let newer = try await newerTask.value
        await controller.resolve(7, with: oldGeneration)
        await assertTaskError("workspace_fence_failed", delayedPost)
        let newerRead = Task { try await lane.read(.init(exportID: newer.artifactID, sessionID: sessionID,
            workspaceGeneration: generation, offset: 0, length: 1)) }
        await controller.waitForCalls(10); await controller.resolve(10, with: generation)
        await controller.waitForCalls(11); await controller.resolve(11, with: generation)
        let newerChunk = try await newerRead.value
        XCTAssertEqual(newerChunk.dataBase64, "QQ==")

        let afterShutdown = Task { try await lane.prepare(
            directRequest(exportID: fixedUUID(905), sessionID: sessionID)) }
        await controller.waitForCalls(12)
        await lane.shutdown()
        await controller.resolve(12, with: generation)
        await assertTaskError("artifact_unavailable", afterShutdown)
    }

    func testGenerationApplicationIsOrderedAndRecheckedAfterCacheAwait() async throws {
        let entity = om, sessionID = fixedUUID(910)
        let oldGeneration = fixedUUID(911)
        let generationBox = ExportGenerationBox(oldGeneration)
        let applyGate = ExportGenerationApplyGate(blockedTickets: [1])
        let cache = ContestExportArtifactCache(beforeGenerationApply: { ticket in
            await applyGate.pauseIfBlocked(ticket)
        })
        let lane = ContestExportLane(generationSource: { await generationBox.value }, cache: cache) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let oldRequest = ContestExportPrepareRequest(exportID: fixedUUID(912), sessionID: sessionID,
            workspaceGeneration: oldGeneration, expectedRevision: 1, generatedAtUTC: baseDate,
            format: .cabrillo, header: header())
        let oldTask = Task { try await lane.prepare(oldRequest) }
        await applyGate.waitUntilPaused(1)

        await generationBox.set(generation)
        let currentRequest = directRequest(exportID: fixedUUID(913), sessionID: sessionID)
        let current = try await lane.prepare(currentRequest)
        await applyGate.resume(1)
        await assertTaskError("workspace_fence_failed", oldTask)
        let currentChunk = try await lane.read(.init(exportID: current.artifactID, sessionID: sessionID,
            workspaceGeneration: generation, offset: 0, length: 1))
        XCTAssertEqual(currentChunk.dataBase64, "QQ==")

        let shutdownGate = ExportGenerationApplyGate(blockedTickets: [1])
        let shutdownCache = ContestExportArtifactCache(beforeGenerationApply: { ticket in
            await shutdownGate.pauseIfBlocked(ticket)
        })
        let shutdownLane = ContestExportLane(generationSource: { [generation] in generation }, cache: shutdownCache) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let shutdownRequest = directRequest(exportID: fixedUUID(914), sessionID: sessionID)
        let shutdownPrepare = Task { try await shutdownLane.prepare(shutdownRequest) }
        await shutdownGate.waitUntilPaused(1)
        await shutdownLane.shutdown()
        await shutdownGate.resume(1)
        await assertTaskError("artifact_unavailable", shutdownPrepare)
    }

    func testConcurrentSameIDSingleFlightFailureRetryAndReleaseCancellation() async throws {
        let sessionID = fixedUUID(700), entity = om
        let generationBox = ExportGenerationBox(generation)
        let cache = ContestExportArtifactCache()
        let attempts = ExportAttemptCounter(failFirst: true) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let lane = ContestExportLane(generationSource: { await generationBox.value }, cache: cache) { request in
            try await attempts.produce(request)
        }
        let request = directRequest(exportID: fixedUUID(701), sessionID: sessionID)
        async let first: ContestExportPreparedArtifact = lane.prepare(request)
        async let second: ContestExportPreparedArtifact = lane.prepare(request)
        do { _ = try await first; XCTFail("Expected exporter failure") } catch { }
        let changedAfterFailure = ContestExportPrepareRequest(exportID: request.exportID,
            sessionID: request.sessionID, workspaceGeneration: request.workspaceGeneration,
            expectedRevision: request.expectedRevision, generatedAtUTC: request.generatedAtUTC.addingTimeInterval(1),
            format: request.format, header: request.header)
        await assertError("request_conflict") { try await lane.prepare(changedAfterFailure) }
        let retryTask = Task { try await lane.prepare(request) }
        do { _ = try await second; XCTFail("Expected shared exporter failure") } catch { }
        let retried = try await retryTask.value
        XCTAssertEqual(retried.byteLength, 4)
        let retryCallCount = await attempts.callCount
        XCTAssertEqual(retryCallCount, 2)
        let conflict = ContestExportPrepareRequest(exportID: request.exportID, sessionID: request.sessionID,
            workspaceGeneration: request.workspaceGeneration, expectedRevision: request.expectedRevision,
            generatedAtUTC: request.generatedAtUTC.addingTimeInterval(1), format: request.format, header: request.header)
        await assertError("request_conflict") { try await lane.prepare(conflict) }

        let typedAttempts = ExportAttemptCounter(failFirst: true, failWithLaneError: true) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let typedLane = ContestExportLane(generationSource: { await generationBox.value },
            cache: ContestExportArtifactCache()) { request in try await typedAttempts.produce(request) }
        let typedRequest = directRequest(exportID: fixedUUID(704), sessionID: sessionID)
        await assertError("planned_failure") { try await typedLane.prepare(typedRequest) }
        let typedChanged = ContestExportPrepareRequest(exportID: typedRequest.exportID,
            sessionID: typedRequest.sessionID, workspaceGeneration: typedRequest.workspaceGeneration,
            expectedRevision: typedRequest.expectedRevision + 1, generatedAtUTC: typedRequest.generatedAtUTC,
            format: typedRequest.format, header: typedRequest.header)
        await assertError("request_conflict") { try await typedLane.prepare(typedChanged) }
        _ = try await typedLane.prepare(typedRequest)
        let typedCallCount = await typedAttempts.callCount
        XCTAssertEqual(typedCallCount, 2)

        let successAttempts = ExportAttemptCounter(delayNanoseconds: 50_000_000) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let successCache = ContestExportArtifactCache()
        let successRequest = directRequest(exportID: fixedUUID(703), sessionID: sessionID)
        async let successFirst: ContestExportPreparedArtifact = successCache.prepare(successRequest) {
            try await successAttempts.produce(successRequest)
        }
        try await Task.sleep(nanoseconds: 5_000_000)
        let inFlightConflict = ContestExportPrepareRequest(exportID: successRequest.exportID,
            sessionID: successRequest.sessionID, workspaceGeneration: successRequest.workspaceGeneration,
            expectedRevision: successRequest.expectedRevision,
            generatedAtUTC: successRequest.generatedAtUTC.addingTimeInterval(1),
            format: successRequest.format, header: successRequest.header)
        await assertError("request_conflict") { try await successCache.prepare(inFlightConflict) {
            try await successAttempts.produce(inFlightConflict)
        } }
        async let successSecond: ContestExportPreparedArtifact = successCache.prepare(successRequest) {
            try await successAttempts.produce(successRequest)
        }
        let successValues = try await (successFirst, successSecond)
        XCTAssertEqual(successValues.0, successValues.1)
        let successfulCallCount = await successAttempts.callCount
        XCTAssertEqual(successfulCallCount, 1)

        let overlapAttempts = ExportAttemptCounter(delayNanoseconds: 50_000_000) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let overlapLane = ContestExportLane(generationSource: { await generationBox.value },
            cache: ContestExportArtifactCache()) { request in try await overlapAttempts.produce(request) }
        let overlapRequest = directRequest(exportID: fixedUUID(705), sessionID: sessionID)
        let overlapTasks = [Task { try await overlapLane.prepare(overlapRequest) },
                            Task { try await overlapLane.prepare(overlapRequest) }]
        var overlapValues: [ContestExportPreparedArtifact] = []
        var fenceFailures = 0
        for task in overlapTasks {
            do { overlapValues.append(try await task.value) }
            catch let error as ContestExportLaneError where error.code == "workspace_fence_failed" { fenceFailures += 1 }
            catch { XCTFail("Unexpected overlapping prepare error: \(error)") }
        }
        XCTAssertEqual(overlapValues.count + fenceFailures, 2)
        let recovered = try await overlapLane.prepare(overlapRequest)
        for value in overlapValues { XCTAssertEqual(value, recovered) }
        let overlapCallCount = await overlapAttempts.callCount
        XCTAssertEqual(overlapCallCount, 1)

        let slowAttempts = ExportAttemptCounter(delayNanoseconds: 100_000_000) { request in
            Self.artifact(request, bytes: 4, entity: entity)
        }
        let slowCache = ContestExportArtifactCache()
        let slowLane = ContestExportLane(generationSource: { await generationBox.value }, cache: slowCache) { request in
            try await slowAttempts.produce(request)
        }
        let slowRequest = directRequest(exportID: fixedUUID(702), sessionID: sessionID)
        let pending = Task { try await slowLane.prepare(slowRequest) }
        try await Task.sleep(nanoseconds: 10_000_000)
        let released = try await slowLane.release(.init(exportID: slowRequest.exportID,
            sessionID: sessionID, workspaceGeneration: generation))
        XCTAssertFalse(released.released)
        do { _ = try await pending.value; XCTFail("Expected released in-flight request to fail") }
        catch let error as ContestExportLaneError { XCTAssertEqual(error.code, "artifact_unavailable") }
        catch { XCTFail("Unexpected error: \(error)") }
        let cancelledCallCount = await slowAttempts.callCount
        XCTAssertEqual(cancelledCallCount, 1)
    }

    private struct Fixture: Sendable {
        let store: SQLiteContestStore
        let sessionID: UUID
        let draftID: UUID
        let revision: UInt64
    }

    private func makeFixture() async throws -> Fixture {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("contest-export-lane-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(at: root) }
        let store = try SQLiteContestStore(databaseURL: root.appendingPathComponent("contests.sqlite"))
        let sessionID = UUID(), draftID = UUID()
        let station = ContestStationSnapshot(callsign: "OM0RX", entity: om, sentExchange: "15",
                                             operatorCallsigns: ["OM0RX"], location: "")
        let session = ContestSessionSnapshot(id: sessionID, workspaceGeneration: generation,
            rule: CQWWCWRule.identity, referenceDataVersion: "cty-fixture-1", startedAt: baseDate, station: station)
        let draft = ContestDraftSnapshot(id: draftID, sessionID: sessionID, revision: 1, updatedAt: baseDate,
            callsign: "", band: "20m", mode: "CW", frequencyHz: 14_025_000, rstSent: "599", rstReceived: "599",
            exchange: .init(rawSent: "15", normalizedSent: "15", rawReceived: "", normalizedReceived: ""),
            entity: nil, operatorCallsign: "OM0RX", stationLocation: "")
        let created = try await store.createSession(session,
            metadata: .init(name: "WW Saturday", operatorCallsign: "OM0RX", operatorCategory: "single-op"),
            initialDraft: draft, scope: .init(sessionID: sessionID, workspaceGeneration: generation,
                requestID: draftID, expectedRevision: 0, draftID: draftID, payloadDigest: "create"),
            committedAt: baseDate)
        return Fixture(store: store, sessionID: sessionID, draftID: draftID, revision: created.session.revision)
    }

    private func prepare(_ fixture: Fixture, exportID: UUID, revision: UInt64,
                         format: ContestExportFormat) -> ContestExportPrepareRequest {
        .init(exportID: exportID, sessionID: fixture.sessionID, workspaceGeneration: generation,
              expectedRevision: revision, generatedAtUTC: baseDate.addingTimeInterval(60), format: format,
              header: header())
    }

    private func directRequest(exportID: UUID, sessionID: UUID) -> ContestExportPrepareRequest {
        .init(exportID: exportID, sessionID: sessionID, workspaceGeneration: generation, expectedRevision: 1,
              generatedAtUTC: baseDate, format: .cabrillo, header: header())
    }

    private func header() -> CabrilloHeader {
        .init(callsign: "OM0RX", categoryOperator: "SINGLE-OP", categoryAssisted: "NON-ASSISTED",
              categoryBand: "ALL", categoryMode: "CW", categoryTransmitter: "ONE", categoryPower: "LOW",
              categoryOverlay: "CLASSIC", operators: ["OM0RX"], location: "DX", club: "OM CONTEST CLUB",
              name: "Oliver Operator", addressLines: ["Test Street 1"], email: "operator@example.test")
    }

    private static func artifact(_ request: ContestExportPrepareRequest, bytes: Int,
                                 entity: ContestEntitySnapshot) -> ContestExportArtifact {
        .init(data: Data(repeating: 0x41, count: bytes), format: request.format,
              inputSchemaVersion: "1", formatterVersion: "pilot-1", generatedAtUTC: request.generatedAtUTC,
              sessionID: request.sessionID, workspaceGeneration: request.workspaceGeneration,
              revision: request.expectedRevision, ruleIdentity: CQWWCWRule.identity,
              referenceDataVersion: "cty-fixture-1", sessionName: "Fixture", operatorCallsign: "OM0RX",
              station: .init(callsign: "OM0RX", entity: entity, sentExchange: "15", operatorCallsigns: ["OM0RX"]),
              qsoCount: 0, totalPoints: 0, multiplierCount: 0, claimedScore: 0, requestedHeader: request.header)
    }

    private func readAll(_ lane: ContestExportLane, prepared: ContestExportPreparedArtifact) async throws -> Data {
        var data = Data(), offset = 0
        while offset < prepared.byteLength {
            let length = min(prepared.chunkLimit, prepared.byteLength - offset)
            let chunk = try await lane.read(.init(exportID: prepared.artifactID, sessionID: prepared.sessionID,
                workspaceGeneration: prepared.workspaceGeneration, offset: offset, length: length))
            data.append(try XCTUnwrap(Data(base64Encoded: chunk.dataBase64)))
            offset += length
        }
        return data
    }

    private func wire(_ request: ContestExportPrepareRequest) -> [String: Any] {
        ["exportID": wireID(request.exportID), "sessionID": wireID(request.sessionID),
         "workspaceGeneration": wireID(request.workspaceGeneration), "expectedRevision": request.expectedRevision,
         "generatedAtUTC": "2027-01-15T08:01:00.000Z", "format": request.format.rawValue,
         "header": ["callsign": "OM0RX", "categoryOperator": "SINGLE-OP", "categoryAssisted": "NON-ASSISTED",
                    "categoryBand": "ALL", "categoryMode": "CW", "categoryTransmitter": "ONE",
                    "categoryPower": "LOW", "categoryOverlay": "CLASSIC", "operators": ["OM0RX"],
                    "location": "DX", "club": "OM CONTEST CLUB", "name": "Oliver Operator",
                    "addressLines": ["Test Street 1"], "email": "operator@example.test"]]
    }

    private func wireID(_ value: UUID) -> String { value.uuidString.lowercased() }
    private func fixedUUID(_ number: Int) -> UUID {
        UUID(uuidString: String(format: "00000000-0000-0000-0000-%012d", number))!
    }

    private func assertError<T>(_ code: String, _ operation: () async throws -> T,
                                file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await operation(); XCTFail("Expected \(code)", file: file, line: line) }
        catch let error as ContestExportLaneError { XCTAssertEqual(error.code, code, file: file, line: line) }
        catch { XCTFail("Unexpected error: \(error)", file: file, line: line) }
    }

    private func assertTaskError<T>(_ code: String, _ task: Task<T, Error>,
                                    file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await task.value; XCTFail("Expected \(code)", file: file, line: line) }
        catch let error as ContestExportLaneError { XCTAssertEqual(error.code, code, file: file, line: line) }
        catch { XCTFail("Unexpected error: \(error)", file: file, line: line) }
    }
}

private final class ExportTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var value: UInt64 = 0
    var now: UInt64 { lock.withLock { value } }
    func advance(_ amount: UInt64) { lock.withLock { value += amount } }
}

private actor ExportGenerationBox {
    private var generation: UUID
    init(_ generation: UUID) { self.generation = generation }
    var value: UUID { generation }
    func set(_ value: UUID) { generation = value }
}

private actor ExportAttemptCounter {
    enum Failure: Error { case planned }
    private(set) var callCount = 0
    private var failFirst: Bool
    private let failWithLaneError: Bool
    private let delayNanoseconds: UInt64
    private let factory: @Sendable (ContestExportPrepareRequest) -> ContestExportArtifact

    init(failFirst: Bool = false, failWithLaneError: Bool = false,
         delayNanoseconds: UInt64 = 20_000_000,
         factory: @escaping @Sendable (ContestExportPrepareRequest) -> ContestExportArtifact) {
        self.failFirst = failFirst
        self.failWithLaneError = failWithLaneError
        self.delayNanoseconds = delayNanoseconds
        self.factory = factory
    }

    func produce(_ request: ContestExportPrepareRequest) async throws -> ContestExportArtifact {
        callCount += 1
        let shouldFail = failFirst
        failFirst = false
        try await Task.sleep(nanoseconds: delayNanoseconds)
        if shouldFail {
            if failWithLaneError { throw ContestExportLaneError("planned_failure", "Planned typed failure.") }
            throw Failure.planned
        }
        return factory(request)
    }
}

private actor ExportProducerGate {
    private(set) var startCount = 0
    private var continuations: [Int: CheckedContinuation<Void, Never>] = [:]
    private let factory: @Sendable (ContestExportPrepareRequest) -> ContestExportArtifact

    init(factory: @escaping @Sendable (ContestExportPrepareRequest) -> ContestExportArtifact) {
        self.factory = factory
    }

    func produce(_ request: ContestExportPrepareRequest) async throws -> ContestExportArtifact {
        startCount += 1
        let index = startCount
        await withCheckedContinuation { continuations[index] = $0 }
        return factory(request)
    }

    func waitForStarts(_ count: Int) async {
        while startCount < count { await Task.yield() }
    }

    func resume(_ index: Int) { continuations.removeValue(forKey: index)?.resume() }
}

private actor ExportGenerationController {
    private var callCount = 0
    private var continuations: [Int: CheckedContinuation<UUID, Never>] = [:]

    func next() async -> UUID {
        callCount += 1
        let index = callCount
        return await withCheckedContinuation { continuations[index] = $0 }
    }

    func waitForCalls(_ count: Int) async {
        while callCount < count { await Task.yield() }
    }

    func resolve(_ index: Int, with generation: UUID) {
        continuations.removeValue(forKey: index)?.resume(returning: generation)
    }
}

private actor ExportGenerationApplyGate {
    private var blockedTickets: Set<UInt64>
    private var paused: Set<UInt64> = []
    private var continuations: [UInt64: CheckedContinuation<Void, Never>] = [:]

    init(blockedTickets: Set<UInt64>) { self.blockedTickets = blockedTickets }

    func pauseIfBlocked(_ ticket: UInt64) async {
        guard blockedTickets.contains(ticket) else { return }
        paused.insert(ticket)
        await withCheckedContinuation { continuations[ticket] = $0 }
    }

    func waitUntilPaused(_ ticket: UInt64) async {
        while !paused.contains(ticket) { await Task.yield() }
    }

    func resume(_ ticket: UInt64) {
        blockedTickets.remove(ticket)
        continuations.removeValue(forKey: ticket)?.resume()
    }
}
