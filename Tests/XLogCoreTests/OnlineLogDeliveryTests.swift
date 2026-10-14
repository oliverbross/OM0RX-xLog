import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
@testable import XLogCore

@Suite("Online log delivery", .serialized)
struct OnlineLogDeliveryTests {
    private struct Step: Sendable {
        var status = 200
        var headers: [String: String] = [:]
        var body = Data("RESULT=OK&LOGID=123&COUNT=1".utf8)
        var fails = false
    }

    private actor HTTP: QRZLogbookHTTPClient {
        var steps: [Step]
        var requests: [URLRequest] = []
        init(_ steps: [Step]) { self.steps = steps }
        func send(_ request: URLRequest, maximumResponseBytes: Int) async throws -> QRZLogbookHTTPResponse {
            requests.append(request)
            let step = steps.removeFirst()
            if step.fails { throw URLError(.timedOut, userInfo: [NSLocalizedDescriptionKey: "secret-provider-detail"]) }
            return QRZLogbookHTTPResponse(statusCode: step.status, headers: step.headers, body: step.body)
        }
    }

    private func database() throws -> (LogbookDatabase, URL, QSO) {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("xlog-online-delivery-\(UUID())")
        let database = try LogbookDatabase(url: root.appendingPathComponent("isolated.sqlite"))
        let qso = QSO(call: "VK8NSB", start: Date(timeIntervalSince1970: 1_700_000_000),
                      band: "20m", mode: "CW", frequencyHz: 14_042_000,
                      rstSent: "599", rstReceived: "579", myCall: "OM0RX")
        try database.save(qso)
        return (database, root, qso)
    }

    @Test func qrzInsertUsesOneRecordAndNeverRequestsReplace() async throws {
        let http = HTTP([Step()])
        let transport = try QRZLogbookTransport(userAgent: "OM0RX-xLog/fixture", http: http)
        let outcome = await transport.insert(adif: ADIFRecord(fields: [
            "CALL": "VK8NSB", "QSO_DATE": "20231114", "TIME_ON": "221320", "BAND": "20m", "MODE": "CW",
            "COMMENT": "A+B & C=D",
        ]).recordDocument, accessKey: "ABCD-0A0B-1C1D-2E2F")
        #expect(outcome == .delivered(remoteID: "123"))
        let request = try #require(await http.requests.first)
        #expect(request.url == QRZLogbookTransport.endpoint)
        #expect(request.httpMethod == "POST")
        #expect(request.value(forHTTPHeaderField: "User-Agent") == "OM0RX-xLog/fixture")
        let encoded = String(decoding: try #require(request.httpBody), as: UTF8.self)
        #expect(encoded.contains("A%2BB+%26+C%3DD"))
        #expect(!encoded.contains("A+B"))
        let items = try #require(URLComponents(string: "?\(encoded)")?.queryItems)
        let values = Dictionary(uniqueKeysWithValues: items.map { ($0.name, $0.value ?? "") })
        #expect(Set(values.keys) == ["KEY", "ACTION", "ADIF"])
        #expect(values["ACTION"] == "INSERT")
        #expect(values["ADIF"]?.contains("<EOR>") == true)
        #expect(values["ADIF"]?.contains("<EOH>") == false)
        #expect(values["OPTION"] == nil)
    }

    @Test func deliveredReceiptSurvivesRestartAndPreventsReplay() async throws {
        let (database, root, qso) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let http = HTTP([Step()])
        let coordinator = QRZLogbookDeliveryCoordinator(database: database,
            transport: try QRZLogbookTransport(userAgent: "OM0RX-xLog/fixture", http: http))
        let delivered = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            attemptID: UUID(), now: Date(timeIntervalSince1970: 100))
        #expect(delivered.state == .delivered)
        #expect(delivered.remoteID == "123")
        let replay = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            attemptID: UUID(), now: Date(timeIntervalSince1970: 200))
        #expect(replay == delivered)
        #expect(await http.requests.count == 1)
    }

    @Test func ambiguousTransportIsNeverAutomaticallyReplayed() async throws {
        let (database, root, qso) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let http = HTTP([Step(fails: true)])
        let coordinator = QRZLogbookDeliveryCoordinator(database: database,
            transport: try QRZLogbookTransport(userAgent: "OM0RX-xLog/fixture", http: http))
        await #expect(throws: OnlineLogDeliveryError.deliveryUncertain) {
            try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key", now: Date(timeIntervalSince1970: 100))
        }
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        let stored = try database.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id,
                                                            contactRevision: plan.contact.revision)
        let receipt = try #require(stored)
        #expect(receipt.state == .uncertain)
        #expect(receipt.safeErrorCode == "transport_unknown")
        #expect(receipt.safeErrorCode?.contains("secret-provider-detail") == false)
        let replay = try database.claimOnlineLogDelivery(plan, attemptID: UUID(), at: Date(timeIntervalSince1970: 200))
        #expect(replay.shouldDispatch == false)
        #expect(await http.requests.count == 1)
    }

    @Test func onlyExplicitRateLimitResponsesReceiveBoundedRetry() async throws {
        let (database, root, qso) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let rateLimit = Step(status: 429, headers: ["Retry-After": "10"], body: Data())
        let http = HTTP([rateLimit, rateLimit, rateLimit])
        let coordinator = QRZLogbookDeliveryCoordinator(database: database,
            transport: try QRZLogbookTransport(userAgent: "OM0RX-xLog/fixture", http: http))
        let first = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            now: Date(timeIntervalSince1970: 100))
        #expect(first.state == .deferred)
        #expect(first.nextAttemptAt == Date(timeIntervalSince1970: 130))
        await #expect(throws: OnlineLogDeliveryError.notDue) {
            try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key", now: Date(timeIntervalSince1970: 129))
        }
        let second = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            now: Date(timeIntervalSince1970: 130))
        #expect(second.state == .deferred)
        #expect(second.nextAttemptAt == Date(timeIntervalSince1970: 190))
        let third = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            now: Date(timeIntervalSince1970: 190))
        #expect(third.state == .rejected)
        #expect(third.safeErrorCode == "retry_limit")
        let terminal = try await coordinator.deliver(contactID: qso.id, accessKey: "fixture-key",
            now: Date(timeIntervalSince1970: 1_000))
        #expect(terminal == third)
        #expect(await http.requests.count == 3)
    }

    @Test func editedContactInvalidatesPreparedPlanBeforeDispatch() throws {
        let (database, root, qso) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        var edited = qso; edited.comment = "changed after review"
        try database.save(edited)
        #expect(throws: OnlineLogDeliveryError.staleContact) {
            try database.claimOnlineLogDelivery(plan, attemptID: UUID())
        }
    }

    @Test func interruptedDispatchRecoversAsUncertainWithoutReplay() throws {
        let (database, root, qso) = try database()
        defer { database.close(); try? FileManager.default.removeItem(at: root) }
        let plan = try database.prepareOnlineLogDelivery(service: .qrz, contactID: qso.id)
        let claim = try database.claimOnlineLogDelivery(plan, attemptID: UUID(), at: Date(timeIntervalSince1970: 100))
        #expect(claim.shouldDispatch)
        #expect(try database.recoverInterruptedOnlineLogDeliveries() == 1)
        let stored = try database.onlineLogDeliveryReceipt(service: .qrz, contactID: qso.id,
                                                            contactRevision: plan.contact.revision)
        let recovered = try #require(stored)
        #expect(recovered.state == .uncertain)
        #expect(recovered.safeErrorCode == "interrupted_after_dispatch")
        #expect(try database.claimOnlineLogDelivery(plan, attemptID: UUID()).shouldDispatch == false)
    }
}
