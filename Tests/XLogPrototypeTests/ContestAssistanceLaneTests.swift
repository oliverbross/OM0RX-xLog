import Foundation
import XCTest
import XContestCore
@testable import XLogPrototypeSupport

final class ContestAssistanceLaneTests: XCTestCase {
    private let sessionA = "11111111-1111-4111-8111-111111111111"
    private let sessionB = "22222222-2222-4222-8222-222222222222"
    private let generation = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    private let digest = "2c7a711bc356ecd85e40e6e637e8118ae7c0b7d7d02c40fc39c805c484433a82"
    private let bytes = Data("!!Order,1,1\nK1ABC\nK1ABD\nN1ABC\nOM0RX\n".utf8)

    func testAbsentAndComputedOnlyDatasetsFailClosed() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA)])
        let absent = try ContestAssistanceLane(index: nil, admission: .expectedDigestMatched) {
            try await authority.validate($0)
        }
        await assertError(.dataUnavailable) { try await absent.query("K1", context: self.context(1)) }

        let unverified = try ContestSCPIndex(importing: bytes, provenance: provenance())
        XCTAssertThrowsError(try ContestAssistanceLane(index: unverified, admission: .expectedDigestMatched) { _ in }) {
            XCTAssertEqual($0 as? ContestAssistanceLaneError, .unverifiedDataset)
        }
        XCTAssertThrowsError(try ContestAssistanceLane(index: verifiedIndex(),
            admission: .operatorOrProviderPolicyApprovedComputedDigest) { _ in }) {
            XCTAssertEqual($0 as? ContestAssistanceLaneError, .unverifiedDataset)
        }
        let approved = try ContestAssistanceLane(index: unverified,
            admission: .operatorOrProviderPolicyApprovedComputedDigest) { try await authority.validate($0) }
        let approvedResult = try await approved.query("K1AB", context: context(2))
        XCTAssertEqual(approvedResult.dataset.digestVerification, .computedOnly)
    }

    func testQueryAndSelectionUseVerifiedIndexWithoutMutatingAuthorityState() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA)])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) {
            try await authority.validate($0)
        }
        let request = context(1)
        let before = await authority.snapshot()
        let result = try await lane.query("K1AB", context: request)
        XCTAssertEqual(result.context, request)
        XCTAssertEqual(result.dataset.sha256, digest)
        XCTAssertEqual(result.dataset.digestVerification, .matchedExpectedSHA256)
        XCTAssertFalse(result.isPartial)
        let first = try XCTUnwrap(result.matches.first)
        let selected = try await lane.selectedCallsign(matchID: first.matchID, context: request)
        let after = await authority.snapshot()
        let validationCount = await authority.validationCount
        XCTAssertEqual(selected, first.callsign)
        XCTAssertEqual(after, before)
        XCTAssertGreaterThanOrEqual(validationCount, 4)
    }

    func testSelectionRejectsUnknownMatchStaleRequestAndStaleAuthority() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA)])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) {
            try await authority.validate($0)
        }
        let request = context(1)
        _ = try await lane.query("K1", context: request)
        await assertError(.unknownMatch) {
            try await lane.selectedCallsign(matchID: "\(self.digest):999", context: request)
        }
        await assertError(.resultUnavailable) {
            try await lane.selectedCallsign(matchID: "\(self.digest):0", context: self.context(2))
        }
        await authority.setValid([])
        do {
            _ = try await lane.selectedCallsign(matchID: "\(digest):0", context: request)
            XCTFail("Stale session authority admitted selection")
        } catch {
            XCTAssertEqual(error as? AssistanceAuthority.Failure, .stale)
        }
    }

    func testExactCancellationDoesNotCancelAnotherRequestAndInvalidatesSelection() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA)])
        let starts = AssistanceSearchStarts()
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            validateScope: { try await authority.validate($0) },
            search: { _, _, context in
                await starts.record(context.requestID)
                try await Task.sleep(nanoseconds: 60_000_000_000)
                throw CancellationError()
            })
        let first = context(1), other = context(2)
        let task = Task { try await lane.query("K1", context: first) }
        await starts.wait(for: first.requestID)
        let cancelledOther = try await lane.cancel(context: other)
        let cancelledFirst = try await lane.cancel(context: first)
        XCTAssertFalse(cancelledOther)
        XCTAssertTrue(cancelledFirst)
        await assertTaskError(.cancelled, task)

        let normal = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) {
            try await authority.validate($0)
        }
        let result = try await normal.query("K1AB", context: first)
        let invalidated = try await normal.cancel(context: first)
        XCTAssertTrue(invalidated)
        await assertError(.resultUnavailable) {
            try await normal.selectedCallsign(matchID: result.matches[0].matchID, context: first)
        }
    }

    func testNewQuerySupersedesOnlyItsScopeAndShutdownStopsWork() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA), scope(sessionB)])
        let starts = AssistanceSearchStarts()
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            validateScope: { try await authority.validate($0) },
            search: { _, _, context in
                await starts.record(context.requestID)
                try await Task.sleep(nanoseconds: 60_000_000_000)
                throw CancellationError()
            })
        let a1 = context(1), a2 = context(2), b1 = context(3, sessionID: sessionB)
        let first = Task { try await lane.query("K1", context: a1) }
        await starts.wait(for: a1.requestID)
        let otherScope = Task { try await lane.query("N1", context: b1) }
        await starts.wait(for: b1.requestID)
        let replacement = Task { try await lane.query("K1A", context: a2) }
        await starts.wait(for: a2.requestID)
        await assertTaskError(.cancelled, first)
        await lane.shutdown()
        await assertTaskError(.stopped, replacement)
        await assertTaskError(.stopped, otherScope)
        await assertError(.stopped) { try await lane.query("K1", context: self.context(4)) }
    }

    func testAdmissionOrderPreventsDelayedOlderValidationFromSupersedingNewerQuery() async throws {
        let gate = AssistanceOrdinalGate(blocked: [1, 2])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) { _ in
            await gate.wait()
        }
        let olderContext = context(1), newerContext = context(2)
        let older = Task { try await lane.query("K1", context: olderContext) }
        await gate.waitUntilStarted(1)
        let newer = Task { try await lane.query("N1", context: newerContext) }
        await gate.waitUntilStarted(2)

        await gate.release(2)
        let newerResult = try await newer.value
        XCTAssertEqual(newerResult.context, newerContext)
        await gate.release(1)
        await assertTaskError(.cancelled, older)
    }

    func testCancelDuringValidationRetainsCapacityAndRequestOwnershipUntilSettlement() async throws {
        let gate = AssistanceOrdinalGate(blocked: [1])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 1, maximumCachedResults: 1, maximumKnownRequests: 1)) { _ in
            await gate.wait()
        }
        let firstContext = context(1)
        let first = Task { try await lane.query("K1", context: firstContext) }
        await gate.waitUntilStarted(1)
        let cancelled = try await lane.cancel(context: firstContext)
        XCTAssertTrue(cancelled)
        await assertError(.requestReused) { try await lane.query("K1", context: firstContext) }
        await assertError(.capacityExceeded) { try await lane.query("N1", context: self.context(2)) }

        await gate.release(1)
        await assertTaskError(.cancelled, first)
        let second = try await lane.query("N1", context: context(2))
        XCTAssertEqual(second.context, context(2))
    }

    func testShutdownDuringValidationStopsDelayedOperation() async throws {
        let gate = AssistanceOrdinalGate(blocked: [1])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) { _ in
            await gate.wait()
        }
        let task = Task { try await lane.query("K1", context: self.context(1)) }
        await gate.waitUntilStarted(1)
        await lane.shutdown()
        await gate.release(1)
        await assertTaskError(.stopped, task)
        await assertError(.stopped) { try await lane.query("N1", context: self.context(2)) }
    }

    func testCancellationIgnoringProducerRetainsCapacityUntilTokenSettles() async throws {
        let producer = AssistanceOrdinalGate(blocked: [1, 2])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 1, maximumCachedResults: 1, maximumKnownRequests: 1),
            validateScope: { _ in }, search: { index, query, context in
                await producer.wait()
                return try await Task.detached {
                    try await index.matches(query: query, context: context)
                }.value
            })
        let firstContext = context(1)
        let first = Task { try await lane.query("K1", context: firstContext) }
        await producer.waitUntilStarted(1)
        let cancelled = try await lane.cancel(context: firstContext)
        XCTAssertTrue(cancelled)
        await assertError(.requestReused) { try await lane.query("K1", context: firstContext) }
        await assertError(.capacityExceeded) { try await lane.query("N1", context: self.context(2)) }

        await producer.release(1)
        await assertTaskError(.cancelled, first)
        let secondContext = context(2)
        let second = Task { try await lane.query("N1", context: secondContext) }
        await producer.waitUntilStarted(2)
        await producer.release(2)
        let secondResult = try await second.value
        XCTAssertEqual(secondResult.context, secondContext)
    }

    func testCacheIsBoundedAndAQueryEvictsPriorEvidenceForItsScope() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA), scope(sessionB)])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 2, maximumCachedResults: 1)) {
            try await authority.validate($0)
        }
        let a1 = context(1)
        let first = try await lane.query("K1AB", context: a1)
        let b1 = context(2, sessionID: sessionB)
        _ = try await lane.query("N1AB", context: b1)
        await assertError(.resultUnavailable) {
            try await lane.selectedCallsign(matchID: first.matches[0].matchID, context: a1)
        }

        let a2 = context(3)
        _ = try await lane.query("K1A", context: a2)
        await assertError(.resultUnavailable) {
            try await lane.selectedCallsign(matchID: first.matches[0].matchID, context: a1)
        }
        await assertError(.requestReused) { try await lane.query("OM0", context: a2) }
    }

    func testCachedRequestCannotBeReusedAfterRecentRequestFenceAgesOut() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA), scope(sessionB)])
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 2, maximumCachedResults: 2, maximumKnownRequests: 1)) {
            try await authority.validate($0)
        }
        let first = context(1)
        _ = try await lane.query("K1AB", context: first)
        _ = try await lane.query("N1AB", context: context(2, sessionID: sessionB))

        await assertError(.requestReused) { try await lane.query("OM0", context: first) }
    }

    func testActiveScopeCapacityIsBoundedWithoutCancellingExistingScope() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA), scope(sessionB)])
        let starts = AssistanceSearchStarts()
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 1, maximumCachedResults: 1, maximumKnownRequests: 4),
            validateScope: { try await authority.validate($0) }, search: { _, _, context in
                await starts.record(context.requestID)
                try await Task.sleep(nanoseconds: 60_000_000_000)
                throw CancellationError()
            })
        let firstContext = context(10), otherContext = context(11, sessionID: sessionB)
        let first = Task { try await lane.query("K1AB", context: firstContext) }
        await starts.wait(for: firstContext.requestID)
        await assertError(.capacityExceeded) { try await lane.query("N1AB", context: otherContext) }
        let cancelled = try await lane.cancel(context: firstContext)
        XCTAssertTrue(cancelled)
        await assertTaskError(.cancelled, first)
    }

    func testInvalidContextsAndLimitsAreRejectedBeforeAuthority() async throws {
        let authority = AssistanceAuthority(valid: [scope(sessionA)])
        XCTAssertThrowsError(try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched,
            limits: .init(maximumOperations: 0, maximumCachedResults: 1, maximumKnownRequests: 1)) { _ in }) {
            XCTAssertEqual($0 as? ContestAssistanceLaneError, .invalidLimits)
        }
        let lane = try ContestAssistanceLane(index: verifiedIndex(), admission: .expectedDigestMatched) {
            try await authority.validate($0)
        }
        let invalid = ContestAssistanceContext(sessionID: sessionA, workspaceGeneration: generation.uppercased(),
                                               requestID: requestID(1))
        await assertError(.invalidContext) { try await lane.query("K1", context: invalid) }
        await assertCoreError(.invalidQuery) { try await lane.query("ß1", context: self.context(2)) }
        await assertCoreError(.invalidQuery) { try await lane.query(String(repeating: "A", count: 33), context: self.context(3)) }
        let validationCount = await authority.validationCount
        XCTAssertEqual(validationCount, 0)
    }

    private func verifiedIndex() throws -> ContestSCPIndex {
        try ContestSCPIndex(importing: bytes, provenance: provenance(), expectedSHA256: digest)
    }

    private func provenance() -> ContestSCPProvenance {
        .init(sourceID: "operator-managed-test", version: "fixture-1")
    }

    private func context(_ number: Int, sessionID: String? = nil) -> ContestAssistanceContext {
        .init(sessionID: sessionID ?? sessionA, workspaceGeneration: generation, requestID: requestID(number))
    }

    private func requestID(_ number: Int) -> String {
        String(format: "00000000-0000-4000-8000-%012d", number)
    }

    private func scope(_ sessionID: String) -> ContestAssistanceScope {
        .init(sessionID: sessionID, workspaceGeneration: generation)
    }

    private func assertError<T>(_ expected: ContestAssistanceLaneError,
                                _ operation: @escaping () async throws -> T,
                                file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? ContestAssistanceLaneError, expected, file: file, line: line) }
    }

    private func assertTaskError<T>(_ expected: ContestAssistanceLaneError, _ task: Task<T, Error>,
                                    file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await task.value; XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? ContestAssistanceLaneError, expected, file: file, line: line) }
    }

    private func assertCoreError<T>(_ expected: ContestSCPError,
                                    _ operation: @escaping () async throws -> T,
                                    file: StaticString = #filePath, line: UInt = #line) async {
        do { _ = try await operation(); XCTFail("Expected \(expected)", file: file, line: line) }
        catch { XCTAssertEqual(error as? ContestSCPError, expected, file: file, line: line) }
    }
}

private actor AssistanceAuthority {
    enum Failure: Error, Equatable { case stale }
    private var valid: Set<ContestAssistanceScope>
    private(set) var validationCount = 0
    private let revision = 7
    private let draft = "unchanged-draft"

    init(valid: Set<ContestAssistanceScope>) { self.valid = valid }

    func validate(_ scope: ContestAssistanceScope) throws {
        validationCount += 1
        guard valid.contains(scope) else { throw Failure.stale }
    }

    func setValid(_ scopes: Set<ContestAssistanceScope>) { valid = scopes }
    func snapshot() -> String { "\(revision):\(draft)" }
}

private actor AssistanceSearchStarts {
    private var started: Set<String> = []
    func record(_ requestID: String) { started.insert(requestID) }
    func wait(for requestID: String) async {
        while !started.contains(requestID) { await Task.yield() }
    }
}

private actor AssistanceOrdinalGate {
    private let blocked: Set<Int>
    private var started = 0
    private var released: Set<Int> = []
    private var waiters: [Int: CheckedContinuation<Void, Never>] = [:]

    init(blocked: Set<Int>) { self.blocked = blocked }

    func wait() async {
        started += 1
        let ordinal = started
        guard blocked.contains(ordinal), !released.contains(ordinal) else { return }
        await withCheckedContinuation { waiters[ordinal] = $0 }
    }

    func waitUntilStarted(_ ordinal: Int) async {
        while started < ordinal { await Task.yield() }
    }

    func release(_ ordinal: Int) {
        released.insert(ordinal)
        waiters.removeValue(forKey: ordinal)?.resume()
    }
}
