import Foundation
#if canImport(CryptoKit)
import CryptoKit
#else
import Crypto
#endif
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif

/// Native owner for copying an immutable contest snapshot into the ordinary log.
/// Source reads stay in the contest lane; all destination writes stay in the
/// existing LiveLogbookMethods/LogbookDatabase ownership boundary.
actor ContestLogTransferService {
    typealias ContestRequest = @Sendable (String, [String: Any]) async throws -> [String: Any]

    private let logbook: LiveLogbookMethods
    private let encoder = JSONEncoder()

    init(logbook: LiveLogbookMethods) { self.logbook = logbook }

    func handle(method: String, params: [String: Any], request: ContestRequest) async throws -> [String: Any] {
        switch method {
        case "contest_log_transfer_prepare":
            return try await prepare(params, request: request)
        case "contest_log_transfer_commit":
            let scope = try Scope(params, requiresManifest: true, requiresRevision: true)
            _ = try await sourceProjection(scope, request: request)
            let result = try logbook.applyContestLogTransfer(
                manifestID: scope.manifestID!, workspaceGeneration: scope.workspaceGeneration,
                contestSessionID: scope.sessionID, sourceRevision: scope.revision!)
            return try wire(result, phase: "committed")
        case "contest_log_transfer_status":
            let scope = try Scope(params, requiresManifest: true, requiresRevision: false)
            let result = try logbook.contestLogTransferStatus(
                manifestID: scope.manifestID!, workspaceGeneration: scope.workspaceGeneration,
                contestSessionID: scope.sessionID)
            return try wire(result, phase: "status")
        default:
            throw ContestLaneError.confirmed("unknown_method", "Unknown contest transfer method.")
        }
    }

    private func prepare(_ params: [String: Any], request: ContestRequest) async throws -> [String: Any] {
        let scope = try Scope(params, requiresManifest: false, requiresRevision: true)
        let projection = try await sourceProjection(scope, request: request)
        let sourceRevision = scope.revision!
        let provenance = "not1mm-python:\(projection["sourceRevision"] as? String ?? "unknown")"
        var rows: [[String: Any]] = [], offset = 0
        var expectedTotal: Int64?
        repeat {
            let page = try await request("contest_log_page", [
                "sessionID": scope.sessionID.uuidString.lowercased(),
                "expectedRevision": sourceRevision, "offset": offset, "limit": 100,
            ])
            guard integer(page["revision"]) == sourceRevision,
                  let total = integer(page["total"]), total >= 0, total <= 100_000,
                  let pageRows = page["rows"] as? [[String: Any]], pageRows.count <= 100,
                  expectedTotal == nil || expectedTotal! == total else { throw invalidSource() }
            expectedTotal = total
            rows.append(contentsOf: pageRows)
            offset += pageRows.count
            guard pageRows.count > 0 || Int64(offset) == total else { throw invalidSource() }
        } while Int64(offset) < (expectedTotal ?? 0)
        guard Int64(rows.count) == expectedTotal else { throw invalidSource() }

        var ids = Set<UUID>()
        var items: [ContestLogTransferItem] = []
        var sourceBytes = 0
        for row in rows {
            let payload = try canonical(row)
            sourceBytes += payload.count
            guard payload.count <= 64 * 1024, sourceBytes <= 128 * 1024 * 1024,
                  let rawID = row["ID"] as? String, let qsoID = UUID(uuidString: rawID),
                  ids.insert(qsoID).inserted else { throw invalidSource() }
            let digest = sha256(payload)
            items.append(.init(qsoID: qsoID, sourceDigest: digest, sourcePayload: payload,
                qso: try qso(row, sessionID: scope.sessionID, qsoID: qsoID,
                             sourceRevision: sourceRevision, sourceDigest: digest)))
        }
        items.sort { $0.qsoID.uuidString < $1.qsoID.uuidString }
        let digestPayload = items.reduce(into: Data()) { data, item in
            data.append(contentsOf: item.qsoID.uuidString.lowercased().utf8)
            data.append(0); data.append(contentsOf: item.sourceDigest.utf8); data.append(10)
        }
        let manifest = ContestLogTransferManifest(contestSessionID: scope.sessionID,
            workspaceGeneration: scope.workspaceGeneration, sourceRevision: sourceRevision,
            sourceDigest: sha256(digestPayload), provenance: provenance, items: items)
        let stored = try logbook.prepareContestLogTransfer(manifest,
            workspaceGeneration: scope.workspaceGeneration)
        let status = try logbook.contestLogTransferStatus(manifestID: stored.id,
            workspaceGeneration: scope.workspaceGeneration, contestSessionID: scope.sessionID)
        return try wire(status, phase: "prepared")
    }

    private func sourceProjection(_ scope: Scope, request: ContestRequest) async throws -> [String: Any] {
        let result = try await request("contest_draft_get", ["sessionID": scope.sessionID.uuidString.lowercased()])
        guard let projection = result["projection"] as? [String: Any],
              projection["sessionID"] as? String == scope.sessionID.uuidString.lowercased(),
              projection["workspaceGeneration"] as? String == scope.workspaceGeneration.uuidString.lowercased(),
              scope.revision == nil || integer(projection["revision"]) == scope.revision else {
            throw ContestLaneError.confirmed("stale_revision", "The contest session changed; prepare the transfer again.")
        }
        return projection
    }

    private struct Scope {
        let sessionID: UUID
        let workspaceGeneration: UUID
        let revision: Int64?
        let manifestID: UUID?

        init(_ params: [String: Any], requiresManifest: Bool, requiresRevision: Bool) throws {
            var expected: Set<String> = ["sessionID", "workspaceGeneration"]
            if requiresManifest { expected.insert("manifestID") }
            if requiresRevision { expected.insert("expectedRevision") }
            guard Set(params.keys) == expected,
                  let session = params["sessionID"] as? String,
                  let sessionID = UUID(uuidString: session), session == sessionID.uuidString.lowercased(),
                  let generation = params["workspaceGeneration"] as? String,
                  let workspaceGeneration = UUID(uuidString: generation), generation == workspaceGeneration.uuidString.lowercased() else {
                throw ContestLogTransferService.invalidParams()
            }
            self.sessionID = sessionID; self.workspaceGeneration = workspaceGeneration
            if requiresRevision {
                guard let revision = ContestLogTransferService.integer(params["expectedRevision"]),
                      (0...9_007_199_254_740_991).contains(revision) else {
                    throw ContestLogTransferService.invalidParams()
                }
                self.revision = revision
            } else { revision = nil }
            if requiresManifest {
                guard let raw = params["manifestID"] as? String, let id = UUID(uuidString: raw),
                      raw == id.uuidString.lowercased() else { throw ContestLogTransferService.invalidParams() }
                manifestID = id
            } else { manifestID = nil }
        }
    }

    private func qso(_ row: [String: Any], sessionID: UUID, qsoID: UUID,
                     sourceRevision: Int64, sourceDigest: String) throws -> QSO {
        guard let call = string(row["Call"], maximum: 32),
              call.range(of: #"^[A-Za-z0-9/\-]{2,32}$"#, options: .regularExpression) != nil,
              let timestamp = row["TS"] as? String, let start = utcDate(timestamp),
              let frequencyKHz = double(row["Freq"]), frequencyKHz.isFinite,
              frequencyKHz > 0, frequencyKHz <= 1_000_000,
              let frequencyHz = Int64(exactly: (frequencyKHz * 1_000).rounded()),
              let sourceMode = string(row["Mode"], maximum: 16), !sourceMode.isEmpty else {
            throw invalidSource()
        }
        let upperMode = sourceMode.uppercased()
        let mode = ["USB", "LSB"].contains(upperMode) ? "SSB" :
            (upperMode == "CWR" ? "CW" : (upperMode == "RTTYR" ? "RTTY" : upperMode))
        let submode = ["USB", "LSB", "CWR", "RTTYR"].contains(upperMode) ? upperMode : ""
        var extra = [
            "APP_XLOG_CONTEST_SESSION_ID": sessionID.uuidString.lowercased(),
            "APP_XLOG_CONTEST_QSO_ID": qsoID.uuidString.lowercased(),
            "APP_XLOG_CONTEST_SOURCE_REVISION": String(sourceRevision),
            "APP_XLOG_CONTEST_SOURCE_SHA256": sourceDigest,
        ]
        if let value = string(row["ContestName"], maximum: 128), !value.isEmpty { extra["CONTEST_ID"] = value }
        if let value = string(row["SentNr"], maximum: 128), !value.isEmpty { extra["STX_STRING"] = value }
        if let value = string(row["NR"], maximum: 128), !value.isEmpty { extra["SRX_STRING"] = value }
        if let raw = row["raw_fields"] as? [String: Any] {
            if let value = string(raw["other_1"], maximum: 512), !value.isEmpty { extra["APP_XLOG_CONTEST_SENT_EXCHANGE"] = value }
            if let value = string(raw["other_2"], maximum: 512), !value.isEmpty { extra["APP_XLOG_CONTEST_RECEIVED_EXCHANGE"] = value }
        }
        return QSO(call: call, start: start, band: BandPlan.band(for: frequencyHz), mode: mode,
            submode: submode, frequencyHz: frequencyHz,
            rstSent: string(row["SNT"], maximum: 16), rstReceived: string(row["RCV"], maximum: 16),
            name: string(row["Name"], maximum: 128) ?? "", gridSquare: string(row["GridSquare"], maximum: 16) ?? "",
            continent: string(row["Continent"], maximum: 8) ?? "", cqZone: string(row["ZN"], maximum: 8) ?? "",
            qth: string(row["QTH"], maximum: 128) ?? "", comment: string(row["Comment"], maximum: 512) ?? "",
            txPower: string(row["Power"], maximum: 32) ?? "", operatorCall: string(row["Operator"], maximum: 32) ?? "",
            myCall: string(row["StationPrefix"], maximum: 32) ?? "", extraFields: extra)
    }

    private func wire(_ result: ContestLogTransferResult, phase: String) throws -> [String: Any] {
        let manifest = result.manifest
        let receipts: (ContestLogTransferReceipt) throws -> [String: Any] = { receipt in
            ["qsoID": receipt.qsoID.uuidString.lowercased(),
             "targetQSOID": receipt.targetQSOID.uuidString.lowercased(),
             "sourceDigest": receipt.sourceDigest, "sourceRevision": receipt.sourceRevision,
             "manifestID": receipt.manifestID.uuidString.lowercased()]
        }
        let issue: (ContestLogTransferIssue) -> [String: Any] = {
            ["qsoID": $0.qsoID.uuidString.lowercased(), "code": $0.code, "message": $0.message]
        }
        let completed = result.inserted.count + result.alreadyTransferred.count
        return ["phase": phase,
            "manifest": ["manifestID": manifest.id.uuidString.lowercased(),
                "contestSessionID": manifest.contestSessionID.uuidString.lowercased(),
                "workspaceGeneration": manifest.workspaceGeneration.uuidString.lowercased(),
                "sourceRevision": manifest.sourceRevision, "sourceDigest": manifest.sourceDigest,
                "provenance": manifest.provenance, "qsoCount": manifest.items.count],
            "inserted": try result.inserted.map(receipts),
            "alreadyTransferred": try result.alreadyTransferred.map(receipts),
            "conflicts": result.conflicts.map(issue), "errors": result.errors.map(issue),
            "counts": ["total": manifest.items.count, "inserted": result.inserted.count,
                "alreadyTransferred": result.alreadyTransferred.count,
                "conflicts": result.conflicts.count, "errors": result.errors.count,
                "pending": max(0, manifest.items.count - completed - result.conflicts.count - result.errors.count)]]
    }

    private func canonical(_ value: Any) throws -> Data {
        guard JSONSerialization.isValidJSONObject(value) else { throw Self.invalidSource() }
        return try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    }

    private func sha256(_ data: Data) -> String {
        SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
    }

    private func utcDate(_ text: String) -> Date? {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        formatter.isLenient = false
        guard let date = formatter.date(from: text), formatter.string(from: date) == text else { return nil }
        return date
    }

    private static func integer(_ value: Any?) -> Int64? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        guard double.isFinite, double.rounded() == double else { return nil }
        return Int64(exactly: double)
    }
    private func integer(_ value: Any?) -> Int64? { Self.integer(value) }
    private func double(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        return number.doubleValue
    }
    private func string(_ value: Any?, maximum: Int) -> String? {
        let result: String
        if let value = value as? String { result = value }
        else if let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() { result = number.stringValue }
        else if value == nil || value is NSNull { return nil }
        else { return nil }
        return result.utf8.count <= maximum ? result : nil
    }
    private static func invalidParams() -> ContestLaneError {
        .confirmed("invalid_params", "Invalid contest transfer parameters.")
    }
    private static func invalidSource() -> ContestLaneError {
        .confirmed("invalid_contest_log", "The revision-bound contest log could not be transferred losslessly.")
    }
    private func invalidSource() -> ContestLaneError { Self.invalidSource() }
}
