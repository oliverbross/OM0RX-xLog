import Foundation

/// A frozen, read-only proposal. No contact insertion or persistence capability
/// is exposed; a future owner must revalidate these fences before any write.
public struct LoTWConfirmationPreview: Equatable, Sendable {
    public static let maximumItems = 10_000
    public static let maximumLocalContacts = 100_000
    public static let maximumChanges = 30_000

    public enum Failure: Error, Equatable, Sendable {
        case missingIdentity, staleGeneration, invalidRevision, duplicateContactID
        case limitExceeded, invalidReport, staleContact, missingContact
    }
    public enum Outcome: String, Equatable, Sendable { case changed, unchanged, unmatched, ambiguous }
    public enum Field: String, Equatable, Sendable {
        case received = "lotwReceived"
        case receivedDate = "LOTW_QSLRDATE"
        case sourceTimestamp = "APP_LOTW_RXQSL"
    }
    public struct Change: Equatable, Sendable {
        public let field: Field
        public let retained: String?
        public let proposed: String
    }
    public struct Fence: Equatable, Sendable {
        public let generation: UUID
        public let contactID: UUID
        public let revision: Int64
    }
    public struct Item: Equatable, Sendable {
        public let recordIndex: Int
        public let record: LoTWConfirmationRecord
        public let outcome: Outcome
        public let fence: Fence?
        public let changes: [Change]
        public let candidateCount: Int
    }

    public let generation: UUID
    public let stationCallsign: String
    public let items: [Item]
    public var changedCount: Int { items.filter { $0.outcome == .changed }.count }
    public var unchangedCount: Int { items.filter { $0.outcome == .unchanged }.count }
    public var unmatchedCount: Int { items.filter { $0.outcome == .unmatched }.count }
    public var ambiguousCount: Int { items.filter { $0.outcome == .ambiguous }.count }
    public var changeCount: Int { items.reduce(0) { $0 + $1.changes.count } }

    private struct Key: Hashable {
        let call: String
        let day: String
        let time: String
        let band: String
    }

    /// Contacts must come from the selected station's frozen local view. The
    /// report's station identity is checked independently of worked callsigns.
    public static func make(report: LoTWConfirmationReport, contacts: [LogbookContactSnapshot],
        stationCallsign: String, expectedGeneration: UUID?, observedGeneration: UUID?,
        itemLimit: Int = maximumItems, changeLimit: Int = maximumChanges) throws -> Self {
        guard let expectedGeneration, let observedGeneration, !stationCallsign.isEmpty else { throw Failure.missingIdentity }
        guard expectedGeneration == observedGeneration else { throw Failure.staleGeneration }
        guard (0...maximumItems).contains(itemLimit), (0...maximumChanges).contains(changeLimit),
              report.records.count <= itemLimit, contacts.count <= maximumLocalContacts else { throw Failure.limitExceeded }
        guard report.records.count == report.declaredRecordCount else { throw Failure.invalidReport }
        let station = stationCallsign.uppercased()
        guard report.records.allSatisfy({ $0.stationCallsign.uppercased() == station }) else { throw Failure.invalidReport }
        let indexed = try index(contacts)
        let day = formatter("yyyyMMdd"), time = formatter("HHmmss")
        var byKey: [Key: [LogbookContactSnapshot]] = [:]
        var byMinuteKey: [Key: [LogbookContactSnapshot]] = [:]
        for contact in indexed.values where contact.qso.deletedAt == nil {
            let qso = contact.qso
            // A known different station must never receive this report's state.
            guard qso.myCall.isEmpty || qso.myCall.uppercased() == station else { continue }
            let key = Key(call: qso.call.uppercased(), day: day.string(from: qso.start),
                          time: time.string(from: qso.start), band: qso.band.lowercased())
            byKey[key, default: []].append(contact)
            let minuteKey = Key(call: key.call, day: key.day, time: String(key.time.prefix(4)), band: key.band)
            byMinuteKey[minuteKey, default: []].append(contact)
        }
        var items: [Item] = [], totalChanges = 0
        for (offset, record) in report.records.enumerated() {
            let key = Key(call: record.workedCallsign.uppercased(), day: record.qsoDate,
                          time: record.timeOn, band: record.band.lowercased())
            var candidates = record.timeOn.count == 4 ? byMinuteKey[key] ?? [] : byKey[key] ?? []
            // APP_LOTW_MODE is a mode group, not an exact local mode identity.
            // LoTW mode mappings can differ from the local logging mode: MODE
            // only disambiguates multiple matches for the base contact key.
            if candidates.count > 1, let mode = record.mode {
                candidates = candidates.filter { $0.qso.mode.uppercased() == mode.uppercased() }
            }
            guard candidates.count == 1, let contact = candidates.first else {
                items.append(Item(recordIndex: offset, record: record, outcome: candidates.isEmpty ? .unmatched : .ambiguous,
                                  fence: nil, changes: [], candidateCount: candidates.count))
                continue
            }
            var changes: [Change] = []
            func append(_ field: Field, _ retained: String?, _ proposed: String?) {
                if let proposed, retained != proposed { changes.append(Change(field: field, retained: retained, proposed: proposed)) }
            }
            // An unconfirmed query row is not evidence that an earlier QSL was
            // revoked. Only positive confirmation evidence creates a proposal.
            if record.confirmation.status == .confirmed {
                if !["Y", "V"].contains(contact.qso.lotwReceived.uppercased()) {
                    append(.received, contact.qso.lotwReceived, "Y")
                }
                append(.receivedDate, contact.qso.extraFields["LOTW_QSLRDATE"], record.confirmation.qslReceivedDate)
                append(.sourceTimestamp, contact.qso.extraFields["APP_LOTW_RXQSL"], record.confirmation.receivedQSLTimestamp)
            }
            totalChanges += changes.count
            guard totalChanges <= changeLimit else { throw Failure.limitExceeded }
            items.append(Item(recordIndex: offset, record: record, outcome: changes.isEmpty ? .unchanged : .changed,
                              fence: Fence(generation: expectedGeneration, contactID: contact.qso.id, revision: contact.revision),
                              changes: changes, candidateCount: 1))
        }
        // Multiple downloaded rows targeting one local contact must not create
        // independent conflicting proposals, even when their evidence agrees.
        let targetCounts = Dictionary(grouping: items.compactMap(\.fence), by: \.contactID).mapValues(\.count)
        items = items.map { item in
            guard let fence = item.fence, targetCounts[fence.contactID, default: 0] > 1 else { return item }
            return Item(recordIndex: item.recordIndex, record: item.record, outcome: .ambiguous,
                        fence: nil, changes: [], candidateCount: targetCounts[fence.contactID, default: 0])
        }
        return Self(generation: expectedGeneration, stationCallsign: station, items: items)
    }

    /// Pure freshness check; this is not an apply token or permission to write.
    public func validateFences(observedGeneration: UUID?, contacts: [LogbookContactSnapshot]) throws {
        guard let observedGeneration else { throw Failure.missingIdentity }
        guard observedGeneration == generation else { throw Failure.staleGeneration }
        guard contacts.count <= Self.maximumLocalContacts else { throw Failure.limitExceeded }
        let current = try Self.index(contacts)
        for fence in items.compactMap(\.fence) {
            guard let contact = current[fence.contactID] else { throw Failure.missingContact }
            guard contact.revision == fence.revision, contact.qso.deletedAt == nil else { throw Failure.staleContact }
        }
        // New contacts can make a formerly unique match ambiguous without
        // touching the original contact's revision. Recheck the complete view.
        let report = LoTWConfirmationReport(declaredRecordCount: items.count, lastQSL: nil,
            hasDeprecatedEOFMarker: false, records: items.map(\.record))
        let refreshed = try Self.make(report: report, contacts: contacts, stationCallsign: stationCallsign,
            expectedGeneration: generation, observedGeneration: observedGeneration)
        guard refreshed.items == items else { throw Failure.staleContact }
    }

    private static func index(_ contacts: [LogbookContactSnapshot]) throws -> [UUID: LogbookContactSnapshot] {
        var result: [UUID: LogbookContactSnapshot] = [:]
        for contact in contacts {
            guard (0..<9_007_199_254_740_991).contains(contact.revision) else { throw Failure.invalidRevision }
            guard result.updateValue(contact, forKey: contact.qso.id) == nil else { throw Failure.duplicateContactID }
        }
        return result
    }
    private static func formatter(_ format: String) -> DateFormatter {
        let result = DateFormatter()
        result.locale = Locale(identifier: "en_US_POSIX"); result.timeZone = TimeZone(secondsFromGMT: 0)
        result.calendar = Calendar(identifier: .gregorian); result.dateFormat = format
        return result
    }
}
