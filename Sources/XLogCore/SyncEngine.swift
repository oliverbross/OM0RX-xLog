import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct SyncReport: Equatable, Sendable {
    public init() {}
    public var pushed = 0
    public var pulled = 0
    public var deleted = 0
    public var conflicts = 0
    public var failed = 0
    public var held = 0
}

public struct RemoteHistoryPreview: Sendable {
    public let qsos: [QSO]
    public let remoteIDs: Set<Int>
    public let heldRemoteIDs: Set<Int>
    fileprivate let heldIdentities: Set<String>
}

private enum HistoryJoinError: Error { case ambiguous }

private func historyIdentity(_ qso: QSO) -> String {
    let mode = qso.submode.isEmpty ? qso.mode : qso.submode
    return "\(qso.call)|\(Int(qso.start.timeIntervalSince1970.rounded()))|\(qso.band)|\(mode)|\(qso.frequencyHz ?? 0)"
}

public actor SyncEngine {
    private let database: LogbookDatabase
    private let client: WavelogClient

    public init(database: LogbookDatabase, configuration: WavelogConfiguration, session: URLSession = .shared) {
        self.database = database
        self.client = WavelogClient(configuration: configuration, session: session)
    }

    /// Validates the same complete remote snapshot used by synchronization,
    /// without opening or mutating a local database or issuing remote writes.
    public static func previewRemoteHistory(configuration: WavelogConfiguration, session: URLSession = .shared) async throws -> RemoteHistoryPreview {
        try await readRemoteHistory(client: WavelogClient(configuration: configuration, session: session))
    }

    private static func readRemoteHistory(client: WavelogClient) async throws -> RemoteHistoryPreview {
        try Task.checkCancellation()
        var remoteIDs: Set<Int> = []
        var jsonByIdentity: [String: [WavelogQSO]] = [:]
        var adifByIdentity: [String: [QSO]] = [:]

        func hasStableMetadata(_ page: WavelogQSOPage, matching baseline: WavelogListMeta) -> Bool {
            page.meta.total == baseline.total &&
                page.meta.totalPages == baseline.totalPages &&
                page.meta.perPage == baseline.perPage &&
                page.meta.count == page.data.count
        }

        func hasStableMetadata(_ page: WavelogADIFPage, matching baseline: WavelogListMeta) -> Bool {
            page.meta.total == baseline.total &&
                page.meta.totalPages == baseline.totalPages &&
                page.meta.perPage == baseline.perPage &&
                page.meta.count == page.data.exported
        }

        func index(_ page: WavelogQSOPage) {
            remoteIDs.formUnion(page.data.map(\.id))
            for remote in page.data {
                guard let qso = QSO(wavelog: remote) else { continue }
                jsonByIdentity[historyIdentity(qso), default: []].append(remote)
            }
        }

        func stage(_ page: WavelogADIFPage) throws {
            try Task.checkCancellation()
            let records = ADIFParser().records(in: page.data.adif)
            guard records.count == page.meta.count else {
                throw WavelogClientError.invalidData(
                    "ADIF page \(page.meta.page) declared \(page.meta.count) records but contained \(records.count)."
                )
            }
            for record in records {
                guard let qso = QSO(adif: record) else {
                    throw WavelogClientError.invalidData("ADIF page \(page.meta.page) contained an unreadable QSO.")
                }
                adifByIdentity[historyIdentity(qso), default: []].append(qso)
            }
        }

        let firstPage = try await client.listQSOs(page: 1, perPage: 5_000)
        guard firstPage.meta.page == 1,
              firstPage.meta.count == firstPage.data.count else {
            throw WavelogClientError.invalidResponse
        }
        let baselineMeta = firstPage.meta
        let baselineFirstPageIDs = firstPage.data.map(\.id)
        index(firstPage)
        if firstPage.meta.hasMore {
            guard !firstPage.data.isEmpty, firstPage.meta.totalPages > 1 else {
                throw WavelogClientError.invalidResponse
            }
            // Wavelog installations commonly cap responses below the requested
            // page size. Four in-flight reads keep large initial imports fast
            // without turning synchronization into an aggressive API client.
            let pageSize = max(1, firstPage.meta.perPage)
            var nextPage = 2
            while nextPage <= firstPage.meta.totalPages {
                try Task.checkCancellation()
                let lastPage = min(firstPage.meta.totalPages, nextPage + 3)
                let pages = try await withThrowingTaskGroup(of: WavelogQSOPage.self) { group in
                    for pageNumber in nextPage...lastPage {
                        group.addTask {
                            try await client.listQSOs(page: pageNumber, perPage: pageSize)
                        }
                    }
                    var fetched: [WavelogQSOPage] = []
                    for try await page in group { fetched.append(page) }
                    return fetched.sorted { $0.meta.page < $1.meta.page }
                }
                for page in pages {
                    guard hasStableMetadata(page, matching: baselineMeta),
                          !page.data.isEmpty || page.meta.page == page.meta.totalPages else {
                        throw WavelogClientError.invalidResponse
                    }
                    index(page)
                }
                nextPage = lastPage + 1
            }
        }

        let convertibleJSONCount = jsonByIdentity.values.reduce(0) { $0 + $1.count }
        let firstADIFPage = try await client.exportADIF(page: 1, perPage: 1_000)
        guard firstADIFPage.meta.page == 1,
              firstADIFPage.meta.total == baselineMeta.total,
              firstADIFPage.meta.count == firstADIFPage.data.exported else {
            throw WavelogClientError.invalidResponse
        }
        let adifBaselineMeta = firstADIFPage.meta
        var adifRecordCount = firstADIFPage.meta.count
        try stage(firstADIFPage)
        if firstADIFPage.meta.hasMore {
            let pageSize = max(1, firstADIFPage.meta.perPage)
            var nextPage = 2
            while nextPage <= firstADIFPage.meta.totalPages {
                try Task.checkCancellation()
                let lastPage = min(firstADIFPage.meta.totalPages, nextPage + 3)
                let pages = try await withThrowingTaskGroup(of: WavelogADIFPage.self) { group in
                    for pageNumber in nextPage...lastPage {
                        group.addTask { try await client.exportADIF(page: pageNumber, perPage: pageSize) }
                    }
                    var fetched: [WavelogADIFPage] = []
                    for try await page in group { fetched.append(page) }
                    return fetched.sorted { $0.meta.page < $1.meta.page }
                }
                for page in pages {
                    guard hasStableMetadata(page, matching: adifBaselineMeta),
                          !page.data.adif.isEmpty || page.meta.page == page.meta.totalPages else {
                        throw WavelogClientError.invalidResponse
                    }
                    adifRecordCount += page.meta.count
                    try stage(page)
                }
                nextPage = lastPage + 1
            }
        }

        // Both endpoints paginate independently. Resolve complete identity
        // groups before writing: neither endpoint's order identifies a QSO.
        var remoteQSOs: [QSO] = []
        var heldRemoteIDs: Set<Int> = []
        var heldIdentities: Set<String> = []
        var unmatchedADIFCount = 0
        for (key, rows) in adifByIdentity {
            try Task.checkCancellation()
            guard let candidates = jsonByIdentity.removeValue(forKey: key) else {
                unmatchedADIFCount += rows.count
                continue
            }
            do {
                remoteQSOs += try joinedADIF(rows, with: candidates)
            } catch HistoryJoinError.ambiguous {
                // Hold the entire identity group, including any partially
                // resolved members. Never assign an arbitrary ID or overwrite
                // its local baseline; unrelated contacts can still sync.
                heldRemoteIDs.formUnion(candidates.map(\.id))
                heldIdentities.insert(key)
            }
        }
        let unmatchedJSONCount = jsonByIdentity.values.reduce(0) { $0 + $1.count }
        guard adifRecordCount == baselineMeta.total,
              remoteQSOs.count + heldRemoteIDs.count == convertibleJSONCount,
              unmatchedJSONCount == 0,
              unmatchedADIFCount == baselineMeta.total - convertibleJSONCount else {
            throw WavelogClientError.invalidData(
                "JSON and ADIF histories did not produce the same set of identifiable QSOs."
            )
        }

        // Offset pagination can shift if a QSO is created or removed while a
        // full scan is running. Never infer deletions from a hybrid snapshot:
        // require consistent metadata, complete unique-ID coverage and an
        // unchanged first page before tombstoning anything or pushing writes.
        let verificationPage = try await client.listQSOs(page: 1, perPage: baselineMeta.perPage)
        guard hasStableMetadata(verificationPage, matching: baselineMeta),
              verificationPage.meta.page == 1,
              verificationPage.data.map(\.id) == baselineFirstPageIDs,
              remoteIDs.count == baselineMeta.total else {
            throw WavelogClientError.invalidResponse
        }
        try Task.checkCancellation()
        return RemoteHistoryPreview(qsos: remoteQSOs, remoteIDs: remoteIDs,
                                    heldRemoteIDs: heldRemoteIDs, heldIdentities: heldIdentities)
    }

    public func synchronize() async throws -> SyncReport {
        let snapshot = try await Self.readRemoteHistory(client: client)
        let remoteQSOs = snapshot.qsos
        let remoteIDs = snapshot.remoteIDs
        var report = SyncReport()
        report.held = snapshot.heldRemoteIDs.count
        func held(_ qso: QSO) -> Bool {
            qso.wavelogID.map(snapshot.heldRemoteIDs.contains) == true || snapshot.heldIdentities.contains(historyIdentity(qso))
        }
        report.conflicts += try database.mergeRemoteBatch(remoteQSOs, preservingLocal: held)
        report.pulled += remoteQSOs.count
        report.conflicts += try database.recordRemoteDeletionConflicts(notIn: remoteIDs)
        report.deleted += try database.removeCleanRemoteRecords(notIn: remoteIDs)

        for qso in try database.pending(limit: 500, excluding: held) {
            try Task.checkCancellation()
            // Preserve both pending edits/deletes of held IDs and unlinked
            // local contacts which could otherwise create another duplicate.
            if held(qso) { continue }
            if try database.hasConflict(localID: qso.id) { continue }
            do {
                if qso.deletedAt != nil {
                    // A prior delete may have succeeded before its response was
                    // lost. The verified complete scan already proves absence.
                    if let remoteID = qso.wavelogID, remoteIDs.contains(remoteID) {
                        try await client.deleteQSO(id: remoteID); report.deleted += 1
                    }
                    try database.acknowledgeSynced(qso)
                    continue
                }
                if let remoteID = qso.wavelogID {
                    _ = try await client.updateQSO(id: remoteID, fields: WavelogQSOUpdate(qso))
                    try database.acknowledgeSynced(qso)
                } else {
                    guard let create = WavelogQSOCreate(adif: qso.adifRecord) else {
                        try database.recordSyncFailure(localID: qso.id, message: "This QSO cannot be converted to a valid Wavelog request.")
                        report.failed += 1
                        continue
                    }
                    let remote = try await client.createQSO(create)
                    try database.acknowledgeSynced(qso, wavelogID: remote.id)
                }
                report.pushed += 1
            } catch {
                try Task.checkCancellation()
                try database.recordSyncFailure(localID: qso.id, message: error.localizedDescription)
                report.failed += 1
            }
        }

        return report
    }
}

private func joinedADIF(_ rows: [QSO], with remotes: [WavelogQSO]) throws -> [QSO] {
    guard rows.count == remotes.count else {
        throw WavelogClientError.invalidData("JSON and ADIF identity groups have different record counts.")
    }
    // Malformed fields are not an identity ambiguity. Keep rejecting corrupt
    // snapshots before any write instead of quietly treating them as held.
    for row in rows {
        if let value = row.extraFields["FREQ_RX"], roundedHertz(value, multiplier: 1_000_000) == nil {
            throw WavelogClientError.invalidData("ADIF receive frequency is invalid.")
        }
    }
    for remote in remotes {
        if let value = remote.receiveFrequency, roundedHertz(value) == nil {
            throw WavelogClientError.invalidData("JSON receive frequency is invalid.")
        }
    }
    if rows.count == 1 {
        var row = rows[0]
        row.wavelogID = remotes[0].id
        return [row]
    }
    var pending = rows
    var candidates = remotes
    var joined: [QSO] = []
    while !pending.isEmpty {
        try Task.checkCancellation()
        // This also handles identical residual duplicates after a distinct
        // contact has been uniquely resolved. Export-only/unknown fields must
        // agree across the complete residual group, and every candidate must
        // agree with that payload before interchangeable IDs can be assigned.
        if pending.dropFirst().allSatisfy({ $0.extraFields == pending[0].extraFields }) {
            guard candidates.allSatisfy({ compatibleADIF(pending[0], with: $0) }) else {
                throw WavelogClientError.invalidData(duplicateMismatchSummary(pending, candidates))
            }
            joined += zip(pending, candidates.sorted { $0.id < $1.id }).map { original, remote in
                var row = original
                row.wavelogID = remote.id
                return row
            }
            break
        }
        var resolved = false
        for index in pending.indices {
            let matches = candidates.indices.filter { compatibleADIF(pending[index], with: candidates[$0]) }
            guard matches.count == 1 else { continue }
            var row = pending.remove(at: index)
            row.wavelogID = candidates.remove(at: matches[0]).id
            joined.append(row)
            resolved = true
            break
        }
        guard resolved else {
            guard hasCompleteMatching(pending, candidates) else {
                throw WavelogClientError.invalidData(duplicateMismatchSummary(pending, candidates))
            }
            throw HistoryJoinError.ambiguous
        }
    }
    return joined
}

/// Establish that at least one complete one-to-one assignment exists before
/// classifying a group as ambiguous. A zero-match or Hall-deficient group is
/// inconsistent data, not a safe hold. Iterative paths avoid recursive stacks.
private func hasCompleteMatching(_ rows: [QSO], _ remotes: [WavelogQSO]) -> Bool {
    let edges = rows.map { row in remotes.indices.filter { compatibleADIF(row, with: remotes[$0]) } }
    var owner = Array(repeating: -1, count: remotes.count)
    for start in rows.indices {
        var queue = [start], head = 0
        var seen = Set([start]), via = Array(repeating: -1, count: rows.count)
        var end = -1, lastRow = -1
        while head < queue.count && end == -1 {
            let row = queue[head]; head += 1
            for candidate in edges[row] {
                if owner[candidate] == -1 { end = candidate; lastRow = row; break }
                let next = owner[candidate]
                if seen.insert(next).inserted { via[next] = row; queue.append(next) }
            }
        }
        guard end != -1 else { return false }
        while lastRow != -1 {
            let old = owner.firstIndex(of: lastRow) ?? -1
            owner[end] = lastRow
            end = old
            lastRow = via[lastRow]
        }
    }
    return true
}

private func duplicateMismatchSummary(_ rows: [QSO], _ remotes: [WavelogQSO]) -> String {
    let differences = Set(rows.flatMap { row in remotes.flatMap { incompatibleADIFFields(row, with: $0) } })
    return "JSON and ADIF duplicate fields disagree: " + differences.sorted().joined(separator: ", ")
}

private func compatibleADIF(_ row: QSO, with remote: WavelogQSO) -> Bool {
    incompatibleADIFFields(row, with: remote).isEmpty
}

private func incompatibleADIFFields(_ row: QSO, with remote: WavelogQSO) -> [String] {
    var differences: [String] = []
    let fields: [(String, String?)] = [
        ("RST_SENT", remote.rstSent), ("RST_RCVD", remote.rstReceived),
        ("GRIDSQUARE", remote.gridSquare), ("NAME", remote.name),
        ("COMMENT", remote.comment), ("NOTES", remote.notes),
        ("QTH", remote.qth), ("STATE", remote.state), ("CNTY", remote.county),
        ("IOTA", remote.iota), ("QSL_VIA", remote.qslVia),
        ("TX_PWR", remote.power), ("CQZ", remote.cqZone), ("ITUZ", remote.ituZone),
        ("PROP_MODE", remote.propagationMode), ("SAT_NAME", remote.satelliteName),
        ("SAT_MODE", remote.satelliteMode), ("SOTA_REF", remote.sotaReference),
        ("POTA_REF", remote.potaReference), ("WWFF_REF", remote.wwffReference),
        ("BAND_RX", remote.receiveBand),
    ]
    for (key, value) in fields {
        // An omitted JSON field provides no evidence for or against a match.
        guard let value else { continue }
        let exported = row.extraFields[key] ?? ""
        if ["TX_PWR", "CQZ", "ITUZ"].contains(key),
           let lhs = Decimal(string: exported), let rhs = Decimal(string: value) {
            if lhs != rhs { differences.append(key) }
        } else if exported != value {
            let shape = exported.isEmpty ? "ADIF empty" : value.isEmpty ? "JSON empty" : "both present"
            differences.append("\(key) (\(shape))")
        }
    }
    if let value = remote.receiveFrequency {
        // The validated live duplicate group represents an unrecorded RX
        // frequency as literal JSON zero and an omitted ADIF FREQ_RX. Treat
        // only those two representations as equivalent; retain the original
        // ADIF payload and reject positive, malformed or TX-default mismatches.
        if isLiteralReceiveZero(value), row.extraFields["FREQ_RX"] == nil { return differences }
        let jsonHz = roundedHertz(value)
        let adifHz = row.extraFields["FREQ_RX"].flatMap { roundedHertz($0, multiplier: 1_000_000) }
        if jsonHz == nil || adifHz == nil || jsonHz != adifHz {
            // Fixed representation shapes aid read-only diagnostics without
            // exposing identities, frequencies or other contact values.
            let jsonShape = jsonHz == nil ? "invalid" : Double(value).map { $0 == 0 ? "zero" : $0 > 0 ? "positive" : "negative" } ?? "invalid"
            let adifShape: String
            if row.extraFields["FREQ_RX"] == nil {
                adifShape = "missing"
            } else if let adifHz {
                adifShape = adifHz == 0 ? "zero" : adifHz < 0 ? "negative" : adifHz == row.frequencyHz ? "transmit default" : "different positive"
            } else {
                adifShape = "invalid"
            }
            differences.append("FREQ_RX (JSON \(jsonShape); ADIF \(adifShape))")
        }
    }
    return differences
}

private func roundedHertz(_ text: String, multiplier: Double = 1) -> Int64? {
    guard let value = Double(text), value.isFinite else { return nil }
    let scaled = value * multiplier
    guard scaled.isFinite else { return nil }
    return Int64(exactly: scaled.rounded())
}

private func isLiteralReceiveZero(_ text: String) -> Bool {
    guard Double(text) == 0 else { return false }
    // Floating-point parsing can underflow a nonzero value such as 1e-400 to
    // zero. Require an all-zero decimal significand, independent of exponent.
    let significand = text.prefix { $0 != "e" && $0 != "E" }
    return significand.contains("0") && significand.allSatisfy { $0 == "0" || $0 == "." || $0 == "+" || $0 == "-" }
}

private extension QSO {
    init?(wavelog value: WavelogQSO) {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        guard let date = formatter.date(from: value.qsoDate) else { return nil }
        self.init(
            wavelogID: value.id,
            call: value.call,
            start: date,
            band: value.band,
            mode: value.mode,
            submode: value.submode ?? "",
            frequencyHz: value.frequency.flatMap { roundedHertz($0) },
            receiveFrequencyHz: value.receiveFrequency.flatMap { roundedHertz($0) },
            receiveBand: value.receiveBand ?? "",
            rstSent: value.rstSent ?? "",
            rstReceived: value.rstReceived ?? "",
            name: value.name ?? "",
            gridSquare: value.gridSquare ?? "",
            cqZone: value.cqZone ?? "",
            ituZone: value.ituZone ?? "",
            state: value.state ?? "",
            county: value.county ?? "",
            qth: value.qth ?? "",
            iota: value.iota ?? "",
            sotaReference: value.sotaReference ?? "",
            potaReference: value.potaReference ?? "",
            wwffReference: value.wwffReference ?? "",
            comment: value.comment ?? "",
            notes: value.notes ?? "",
            stationProfileID: value.stationID,
            txPower: value.power ?? "",
            propagationMode: value.propagationMode ?? "",
            qslVia: value.qslVia ?? "",
            isDirty: false
        )
    }
}

private extension WavelogQSOUpdate {
    init(_ qso: QSO) {
        self.init()
        let date = DateFormatter()
        date.locale = Locale(identifier: "en_US_POSIX"); date.timeZone = TimeZone(secondsFromGMT: 0); date.dateFormat = "yyyy-MM-dd"
        let time = DateFormatter()
        time.locale = Locale(identifier: "en_US_POSIX"); time.timeZone = TimeZone(secondsFromGMT: 0); time.dateFormat = "HHmmss"
        call = qso.call; band = qso.band; mode = qso.mode; qsoDate = date.string(from: qso.start); timeOn = time.string(from: qso.start)
        frequency = qso.frequencyHz; receiveBand = qso.receiveBand.nilIfEmpty
        rstSent = qso.rstSent.nilIfEmpty; rstReceived = qso.rstReceived.nilIfEmpty
        gridSquare = qso.gridSquare.nilIfEmpty; name = qso.name.nilIfEmpty; comment = qso.comment.nilIfEmpty
        notes = qso.notes.nilIfEmpty; qth = qso.qth.nilIfEmpty; state = qso.state.nilIfEmpty
        county = qso.county.nilIfEmpty; iota = qso.iota.nilIfEmpty; qslVia = qso.qslVia.nilIfEmpty
        power = qso.txPower.nilIfEmpty; cqZone = qso.cqZone.nilIfEmpty; ituZone = qso.ituZone.nilIfEmpty
        propagationMode = qso.propagationMode.nilIfEmpty; sotaReference = qso.sotaReference.nilIfEmpty
        potaReference = qso.potaReference.nilIfEmpty; wwffReference = qso.wwffReference.nilIfEmpty
    }
}

private extension String {
    var nilIfEmpty: String? { isEmpty ? nil : self }
}
