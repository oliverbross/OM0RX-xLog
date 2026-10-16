import Foundation

/// Read-only LoTW report values. These are not local contacts or paper-QSL state.
public struct LoTWConfirmationReport: Equatable, Sendable {
    public let declaredRecordCount: Int
    /// Report-scoped watermark; never a global sync checkpoint on its own.
    public let lastQSL: String?
    public let hasDeprecatedEOFMarker: Bool
    public let records: [LoTWConfirmationRecord]
}

public struct LoTWConfirmationRecord: Equatable, Sendable {
    public let stationCallsign: String
    public let workedCallsign: String
    public let band: String
    public let qsoDate: String
    public let timeOn: String
    public let mode: String?
    public let loTWMode: String?
    public let confirmation: LoTWConfirmationEvidence
}

public struct LoTWConfirmationEvidence: Equatable, Sendable {
    public enum Status: String, Equatable, Sendable { case confirmed = "Y", unconfirmed = "N" }
    public let status: Status
    public let qslReceivedDate: String?
    public let receivedQSLTimestamp: String?
}

/// Deliberately carries no response text, URLs, or credential-bearing diagnostics.
public enum LoTWReportError: Error, Equatable, Sendable {
    case limitExceeded, malformedEnvelope, invalidHeader, invalidRecord, conflictingField, truncated
}

/// Strict, bounded parser for the LoTW query report contract:
/// https://lotw.arrl.org/lotw-help/developer-query-qsos-qsls/
/// Unlike the general ADIF importer this preserves and validates the envelope.
public struct LoTWConfirmationReportParser: Sendable {
    public static let maximumInputBytes = 8 * 1_024 * 1_024
    public static let maximumRecords = 10_000
    public static let maximumFieldsPerSection = 256
    public static let maximumFieldBytes = 16_384

    public init() {}

    public func parse(_ text: String) throws -> LoTWConfirmationReport {
        guard text.utf8.count <= Self.maximumInputBytes else { throw LoTWReportError.limitExceeded }
        let lower = text.lowercased()
        guard !["<html", "<!doctype", "<body", "<form", "<script"].contains(where: lower.contains) else {
            throw LoTWReportError.malformedEnvelope
        }
        var scanner = Scanner(bytes: Array(text.utf8))
        var header: [String: String] = [:], fields: [String: String] = [:]
        var records: [LoTWConfirmationRecord] = []
        var sawHeader = false, sawEOF = false, fieldCount = 0
        while let token = try scanner.next(allowPreamble: !sawHeader && header.isEmpty && fieldCount == 0) {
            guard !sawEOF else { throw LoTWReportError.malformedEnvelope }
            switch token.name {
            case "EOH":
                guard token.value == nil, !sawHeader else { throw LoTWReportError.malformedEnvelope }
                sawHeader = true; fieldCount = 0
            case "EOR":
                guard sawHeader, token.value == nil, !fields.isEmpty else { throw LoTWReportError.malformedEnvelope }
                guard records.count < Self.maximumRecords else { throw LoTWReportError.limitExceeded }
                records.append(try Self.record(fields)); fields.removeAll(keepingCapacity: true); fieldCount = 0
            case "APP_LOTW_EOF":
                guard sawHeader, fields.isEmpty, token.value == nil || token.value == "" else {
                    throw LoTWReportError.malformedEnvelope
                }
                sawEOF = true
            default:
                guard let value = token.value else { throw LoTWReportError.malformedEnvelope }
                fieldCount += 1
                guard fieldCount <= Self.maximumFieldsPerSection else { throw LoTWReportError.limitExceeded }
                if sawHeader { try Self.insert(token.name, value, into: &fields) }
                else { try Self.insert(token.name, value, into: &header) }
            }
        }
        guard sawHeader else { throw LoTWReportError.malformedEnvelope }
        guard fields.isEmpty else { throw LoTWReportError.truncated }
        guard header["PROGRAMID"]?.uppercased() == "LOTW",
              let countText = header["APP_LOTW_NUMREC"], Self.digits(countText),
              let count = Int(countText), count <= Self.maximumRecords, count == records.count,
              header["APP_LOTW_LASTQSORX"] == nil else { throw LoTWReportError.invalidHeader }
        let watermark = header["APP_LOTW_LASTQSL"]
        guard watermark.map(Self.validTimestamp) ?? records.isEmpty else { throw LoTWReportError.invalidHeader }
        if let watermark {
            // The service documents this as the newest QSL in this report.
            let timestamps = records.compactMap(\.confirmation.receivedQSLTimestamp)
            guard timestamps.allSatisfy({ $0 <= watermark }),
                  records.first?.confirmation.receivedQSLTimestamp.map({ $0 == watermark }) ?? true else {
                throw LoTWReportError.invalidHeader
            }
        }
        return LoTWConfirmationReport(declaredRecordCount: count, lastQSL: watermark,
            hasDeprecatedEOFMarker: sawEOF, records: records)
    }

    private static func insert(_ name: String, _ value: String, into fields: inout [String: String]) throws {
        if let prior = fields[name], prior != value { throw LoTWReportError.conflictingField }
        fields[name] = value
    }

    private static func record(_ fields: [String: String]) throws -> LoTWConfirmationRecord {
        if let station = fields["STATION_CALLSIGN"], let legacy = fields["APP_LOTW_OWNCALL"],
           station.uppercased() != legacy.uppercased() { throw LoTWReportError.conflictingField }
        guard let station = fields["STATION_CALLSIGN"] ?? fields["APP_LOTW_OWNCALL"], validCall(station),
              let call = fields["CALL"], validCall(call),
              let band = fields["BAND"], matches(band, #"^[0-9]+(?:\.[0-9]+)?(?:m|cm|mm)$"#),
              let date = fields["QSO_DATE"], validDate(date),
              let time = fields["TIME_ON"], matches(time, #"^(?:[01][0-9]|2[0-3])(?:[0-5][0-9]){1,2}$"#),
              let rawStatus = fields["QSL_RCVD"], let status = LoTWConfirmationEvidence.Status(rawValue: rawStatus.uppercased()) else {
            throw LoTWReportError.invalidRecord
        }
        for key in ["MODE", "APP_LOTW_MODE"] {
            if let mode = fields[key], !matches(mode, #"^[A-Za-z0-9][A-Za-z0-9 /+_.-]{0,63}$"#) {
                throw LoTWReportError.invalidRecord
            }
        }
        let qslDate = fields["QSLRDATE"], received = fields["APP_LOTW_RXQSL"]
        guard qslDate.map(validDate) ?? true, received.map(validTimestamp) ?? true,
              status == .confirmed || (qslDate == nil && received == nil) else { throw LoTWReportError.invalidRecord }
        return LoTWConfirmationRecord(stationCallsign: station.uppercased(), workedCallsign: call.uppercased(),
            band: band.lowercased(), qsoDate: date, timeOn: time, mode: fields["MODE"], loTWMode: fields["APP_LOTW_MODE"],
            confirmation: LoTWConfirmationEvidence(status: status, qslReceivedDate: qslDate, receivedQSLTimestamp: received))
    }

    private static func validCall(_ text: String) -> Bool {
        matches(text, #"^[A-Za-z0-9][A-Za-z0-9/]{0,31}$"#)
    }
    private static func digits(_ text: String) -> Bool { !text.isEmpty && text.utf8.allSatisfy { (48...57).contains($0) } }
    private static func matches(_ text: String, _ pattern: String) -> Bool {
        text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) == text.startIndex..<text.endIndex
    }
    private static func validDate(_ text: String) -> Bool {
        guard text.utf8.count == 8, digits(text) else { return false }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX"); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.dateFormat = "yyyyMMdd"; formatter.isLenient = false
        return formatter.date(from: text).map { formatter.string(from: $0) == text } == true
    }
    private static func validTimestamp(_ text: String) -> Bool {
        guard matches(text, #"^[0-9]{4}-[0-9]{2}-[0-9]{2} (?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]$"#) else { return false }
        return validDate(String(text.prefix(10)).replacingOccurrences(of: "-", with: ""))
    }

    private struct Token { let name: String; let value: String? }
    private struct Scanner {
        let bytes: [UInt8]
        var cursor = 0
        mutating func next(allowPreamble: Bool) throws -> Token? {
            while cursor < bytes.count, bytes[cursor] != 60 {
                guard allowPreamble || [9, 10, 13, 32].contains(bytes[cursor]) else { throw LoTWReportError.malformedEnvelope }
                cursor += 1
            }
            guard cursor < bytes.count else { return nil }
            let start = cursor + 1
            guard let end = bytes[start...].prefix(129).firstIndex(of: 62) else { throw LoTWReportError.truncated }
            guard let descriptor = String(bytes: bytes[start..<end], encoding: .ascii) else { throw LoTWReportError.malformedEnvelope }
            let parts = descriptor.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
            guard (1...3).contains(parts.count), let first = parts.first, !first.isEmpty,
                  first.utf8.allSatisfy({ (65...90).contains($0) || (97...122).contains($0) || (48...57).contains($0) || $0 == 95 }) else {
                throw LoTWReportError.malformedEnvelope
            }
            cursor = end + 1
            let name = first.uppercased()
            if parts.count == 1 { return Token(name: name, value: nil) }
            guard LoTWConfirmationReportParser.digits(parts[1]), let length = Int(parts[1]) else { throw LoTWReportError.malformedEnvelope }
            guard length <= LoTWConfirmationReportParser.maximumFieldBytes else { throw LoTWReportError.limitExceeded }
            if parts.count == 3 {
                guard parts[2].count == 1, "BNSIDTMGEL".contains(parts[2].uppercased()) else { throw LoTWReportError.malformedEnvelope }
            }
            guard length <= bytes.count - cursor else { throw LoTWReportError.truncated }
            guard let value = String(bytes: bytes[cursor..<(cursor + length)], encoding: .utf8),
                  value.unicodeScalars.allSatisfy({ $0.value >= 32 || [9, 10, 13].contains($0.value) }) else {
                throw LoTWReportError.malformedEnvelope
            }
            cursor += length
            return Token(name: name, value: value)
        }
    }
}
