import Foundation

public struct SyncReport: Equatable, Sendable {
    public var pushed = 0
    public var pulled = 0
    public var deleted = 0
    public var conflicts = 0
}

public actor SyncEngine {
    private let database: LogbookDatabase
    private let client: WavelogClient

    public init(database: LogbookDatabase, configuration: WavelogConfiguration, session: URLSession = .shared) {
        self.database = database
        self.client = WavelogClient(configuration: configuration, session: session)
    }

    public func synchronize() async throws -> SyncReport {
        var report = SyncReport()
        var remoteIDs: Set<Int> = []
        var idsByIdentity: [String: [Int]] = [:]

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

        func identity(_ qso: QSO) -> String {
            let mode = qso.submode.isEmpty ? qso.mode : qso.submode
            return "\(qso.call)|\(Int(qso.start.timeIntervalSince1970.rounded()))|\(qso.band)|\(mode)|\(qso.frequencyHz ?? 0)"
        }

        func index(_ page: WavelogQSOPage) {
            remoteIDs.formUnion(page.data.map(\.id))
            for remote in page.data {
                guard let qso = QSO(wavelog: remote) else { continue }
                idsByIdentity[identity(qso), default: []].append(remote.id)
            }
        }

        func merge(_ page: WavelogADIFPage) throws -> (matched: Int, unmatched: Int) {
            let records = ADIFParser().records(in: page.data.adif)
            guard records.count == page.meta.count else {
                throw WavelogClientError.invalidData(
                    "ADIF page \(page.meta.page) declared \(page.meta.count) records but contained \(records.count)."
                )
            }
            var remoteQSOs: [QSO] = []
            var unmatched = 0
            for record in records {
                guard var qso = QSO(adif: record) else {
                    throw WavelogClientError.invalidData("ADIF page \(page.meta.page) contained an unreadable QSO.")
                }
                let key = identity(qso)
                guard var ids = idsByIdentity[key], let remoteID = ids.popLast() else {
                    unmatched += 1
                    continue
                }
                idsByIdentity[key] = ids
                qso.wavelogID = remoteID
                remoteQSOs.append(qso)
            }
            report.conflicts += try database.mergeRemoteBatch(remoteQSOs)
            report.pulled += remoteQSOs.count
            return (remoteQSOs.count, unmatched)
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
                let lastPage = min(firstPage.meta.totalPages, nextPage + 3)
                let client = self.client
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

        let convertibleJSONCount = idsByIdentity.values.reduce(0) { $0 + $1.count }
        let firstADIFPage = try await client.exportADIF(page: 1, perPage: 1_000)
        guard firstADIFPage.meta.page == 1,
              firstADIFPage.meta.total == baselineMeta.total,
              firstADIFPage.meta.count == firstADIFPage.data.exported else {
            throw WavelogClientError.invalidResponse
        }
        let adifBaselineMeta = firstADIFPage.meta
        var adifRecordCount = firstADIFPage.meta.count
        var unmatchedADIFCount = try merge(firstADIFPage).unmatched
        if firstADIFPage.meta.hasMore {
            let pageSize = max(1, firstADIFPage.meta.perPage)
            var nextPage = 2
            while nextPage <= firstADIFPage.meta.totalPages {
                let lastPage = min(firstADIFPage.meta.totalPages, nextPage + 3)
                let client = self.client
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
                    unmatchedADIFCount += try merge(page).unmatched
                }
                nextPage = lastPage + 1
            }
        }

        let unmatchedJSONCount = idsByIdentity.values.reduce(0) { $0 + $1.count }
        guard adifRecordCount == baselineMeta.total,
              report.pulled == convertibleJSONCount,
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
        report.conflicts += try database.recordRemoteDeletionConflicts(notIn: remoteIDs)
        report.deleted += try database.removeCleanRemoteRecords(notIn: remoteIDs)

        for qso in try database.pending(limit: 500) {
            if try database.hasConflict(localID: qso.id) { continue }
            if qso.deletedAt != nil {
                if let remoteID = qso.wavelogID { try await client.deleteQSO(id: remoteID); report.deleted += 1 }
                try database.markSynced(localID: qso.id)
                continue
            }
            if let remoteID = qso.wavelogID {
                _ = try await client.updateQSO(id: remoteID, fields: WavelogQSOUpdate(qso))
                try database.markSynced(localID: qso.id)
            } else {
                guard let create = WavelogQSOCreate(adif: qso.adifRecord) else { continue }
                let remote = try await client.createQSO(create)
                try database.markSynced(localID: qso.id, wavelogID: remote.id)
            }
            report.pushed += 1
        }

        return report
    }
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
            frequencyHz: value.frequency.flatMap(Double.init).map { Int64($0.rounded()) },
            receiveFrequencyHz: value.receiveFrequency.flatMap(Double.init).map { Int64($0.rounded()) },
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
