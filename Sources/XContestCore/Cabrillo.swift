import Foundation

public struct CabrilloHeader: Codable, Hashable, Sendable {
    public let callsign: String
    public let categoryOperator: String
    public let categoryAssisted: String
    public let categoryBand: String
    public let categoryMode: String
    public let categoryTransmitter: String
    public let categoryPower: String
    public let categoryOverlay: String?
    public let operators: [String]
    public let location: String
    public let club: String?
    public let name: String
    public let addressLines: [String]
    public let email: String

    public init(callsign: String, categoryOperator: String, categoryAssisted: String,
                categoryBand: String, categoryMode: String, categoryTransmitter: String,
                categoryPower: String, categoryOverlay: String? = nil, operators: [String] = [],
                location: String = "", club: String? = nil, name: String = "",
                addressLines: [String] = [], email: String = "") {
        self.callsign = callsign.uppercased()
        self.categoryOperator = categoryOperator
        self.categoryAssisted = categoryAssisted
        self.categoryBand = categoryBand
        self.categoryMode = categoryMode
        self.categoryTransmitter = categoryTransmitter
        self.categoryPower = categoryPower
        self.categoryOverlay = categoryOverlay
        self.operators = operators.map { $0.uppercased() }
        self.location = location
        self.club = club
        self.name = name
        self.addressLines = addressLines
        self.email = email
    }
}

public enum CabrilloExportError: Error, Equatable {
    case invalidHeader(String)
    case invalidQSO(qsoID: UUID, field: String)
}

public enum CabrilloExporter {
    public static func document(input: ContestExportInput, rule: any ContestRule,
                                createdBy: String = "OM0RX-xLog") throws -> String {
        let score: ContestScore
        do { score = try input.validatedScore(rule: rule) }
        catch { throw CabrilloExportError.invalidHeader("exportInput") }
        return try document(header: input.metadata.cabrilloHeader, score: score,
                            qsos: input.qsos, session: input.session, rule: rule,
                            formatterVersion: input.formatterVersion, createdBy: createdBy)
    }

    public static func document(header: CabrilloHeader, score: ContestScore, qsos: [ContestQSO],
                                session: ContestSessionSnapshot, rule: any ContestRule,
                                formatterVersion: String = ContestExportInput.legacyFormatterVersion,
                                createdBy: String = "OM0RX-xLog") throws -> String {
        guard session.rule == rule.metadata.identity else { throw CabrilloExportError.invalidHeader("rule") }
        guard header.callsign == session.station.callsign else { throw CabrilloExportError.invalidHeader("callsign") }
        guard rule.metadata.entry.isCoherent(supportedModes: rule.metadata.supportedModes),
              header.categoryMode == rule.metadata.entry.mode else {
            throw CabrilloExportError.invalidHeader("categoryMode")
        }
        let recomputed: ContestScore
        let renderedQSOs: [ContestQSO]
        do {
            switch formatterVersion {
            case rule.metadata.entry.cabrilloFormatterVersion:
                let categoryBand = header.categoryBand.uppercased()
                let usedBands = Set(qsos.map(\.band))
                if categoryBand != "ALL" {
                    let expectedBand = categoryBand.lowercased()
                    guard rule.metadata.supportedBands.contains(expectedBand),
                          usedBands.allSatisfy({ $0 == expectedBand }) else {
                        throw CabrilloExportError.invalidHeader("categoryBand")
                    }
                }
                recomputed = try ContestEngine.score(qsos, session: session, rule: rule)
                renderedQSOs = qsos
            case rule.metadata.entry.cabrilloProjectionFormatterVersion:
                let projection = try ContestSubmissionProjection.make(qsos: qsos, session: session,
                                                                       header: header, rule: rule)
                recomputed = projection.score
                renderedQSOs = projection.renderedQSOs
            default:
                throw CabrilloExportError.invalidHeader("formatterVersion")
            }
        } catch let error as CabrilloExportError { throw error }
        catch { throw CabrilloExportError.invalidHeader("score") }
        guard recomputed == score else { throw CabrilloExportError.invalidHeader("score") }
        let call = try token(header.callsign, field: "callsign")
        var lines = ["START-OF-LOG: 3.0", "CREATED-BY: \(try safe(createdBy, field: "createdBy", required: true))",
                     "CONTEST: \(rule.metadata.cabrilloName)"]
        if let club = header.club, !club.isEmpty { lines.append("CLUB: \(try safe(club, field: "club"))") }
        lines += [
            "CALLSIGN: \(call)",
            "LOCATION: \(try safe(header.location, field: "location"))",
            "CATEGORY-OPERATOR: \(try token(header.categoryOperator, field: "categoryOperator"))",
            "CATEGORY-ASSISTED: \(try token(header.categoryAssisted, field: "categoryAssisted"))",
            "CATEGORY-BAND: \(try token(header.categoryBand, field: "categoryBand"))",
            "CATEGORY-MODE: \(try token(header.categoryMode, field: "categoryMode"))",
            "CATEGORY-TRANSMITTER: \(try token(header.categoryTransmitter, field: "categoryTransmitter"))",
        ]
        if let overlay = header.categoryOverlay, !overlay.isEmpty { lines.append("CATEGORY-OVERLAY: \(try safe(overlay, field: "categoryOverlay"))") }
        lines += ["CATEGORY-POWER: \(try token(header.categoryPower, field: "categoryPower"))",
                  "CLAIMED-SCORE: \(score.claimedScore)"]
        let operators = header.operators.isEmpty ? ["@\(call)"] : header.operators
        guard operators.allSatisfy({ $0.range(of: #"^@?[A-Z0-9]+(?:/[A-Z0-9]+)*$"#, options: .regularExpression) != nil }) else {
            throw CabrilloExportError.invalidHeader("operators")
        }
        lines.append("OPERATORS: \(try safe(operators.joined(separator: ", "), field: "operators", required: true))")
        lines.append("NAME: \(try safe(header.name, field: "name"))")
        for address in header.addressLines { lines.append("ADDRESS: \(try safe(address, field: "address"))") }
        lines.append("EMAIL: \(try safe(header.email, field: "email"))")
        for qso in renderedQSOs.sorted(by: deterministicOrder) {
            lines.append(try qsoLine(qso, session: session, rule: rule))
        }
        lines.append("END-OF-LOG:")
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    public static func qsoLine(_ qso: ContestQSO, session: ContestSessionSnapshot,
                               rule: any ContestRule) throws -> String {
        guard qso.sessionID == session.id else { throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: "sessionID") }
        guard session.rule == rule.metadata.identity else { throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: "rule") }
        guard qso.timestampUTC.timeIntervalSinceReferenceDate.isFinite else {
            throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: "timestampUTC")
        }
        if let issue = rule.evaluate(qso, in: session).validation.first(where: { $0.severity == .error }) {
            throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: issue.field)
        }
        guard qso.frequencyHz > 0 else { throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: "frequencyHz") }
        let wholeKHz = qso.frequencyHz / 1_000
        let remainder = qso.frequencyHz % 1_000
        let frequency = remainder < 500 ? wholeKHz : remainder > 500 ? wholeKHz + 1 :
            (wholeKHz.isMultiple(of: 2) ? wholeKHz : wholeKHz + 1)
        guard frequency > 0 && frequency <= 99_999 else { throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: "frequencyHz") }
        let mode = rule.metadata.entry.cabrilloQSOType
        let values = [session.station.callsign, qso.rstSent, qso.exchange.normalizedSent,
                      qso.callsign, qso.rstReceived, rule.cabrilloReceivedExchange(for: qso)]
        let limits = [13, 3, 6, 13, 3, 6]
        for (index, value) in values.enumerated() where value.isEmpty || value.count > limits[index] ||
            value.range(of: #"^[A-Z0-9/]+$"#, options: .regularExpression) == nil {
            throw CabrilloExportError.invalidQSO(qsoID: qso.id, field: ["stationCallsign", "rstSent", "sentExchange", "callsign", "rstReceived", "receivedExchange"][index])
        }
        return "QSO: \(leftPad(String(frequency), 5)) \(mode) \(date(qso.timestampUTC)) \(time(qso.timestampUTC)) " +
            "\(rightPad(values[0], 13)) \(rightPad(values[1], 3)) \(rightPad(values[2], 6)) " +
            "\(rightPad(values[3], 13)) \(rightPad(values[4], 3)) \(rightPad(values[5], 6))"
    }

    private static func safe(_ value: String, field: String, required: Bool = false) throws -> String {
        if (required && value.trimmingCharacters(in: .whitespaces).isEmpty) || hasUnsafeCharacters(value) {
            throw CabrilloExportError.invalidHeader(field)
        }
        return value
    }

    private static func token(_ value: String, field: String) throws -> String {
        guard !value.isEmpty, value.range(of: #"^[A-Z0-9][A-Z0-9/@-]*$"#, options: .regularExpression) != nil else {
            throw CabrilloExportError.invalidHeader(field)
        }
        return value
    }

    private static func hasUnsafeCharacters(_ value: String) -> Bool {
        value.unicodeScalars.contains { CharacterSet.newlines.contains($0) || CharacterSet.controlCharacters.contains($0) }
    }

    private static func deterministicOrder(_ lhs: ContestQSO, _ rhs: ContestQSO) -> Bool {
        lhs.timestampUTC == rhs.timestampUTC ? lhs.id.uuidString < rhs.id.uuidString : lhs.timestampUTC < rhs.timestampUTC
    }
    private static func leftPad(_ value: String, _ width: Int) -> String { String(repeating: " ", count: max(0, width - value.count)) + value }
    private static func rightPad(_ value: String, _ width: Int) -> String { value + String(repeating: " ", count: max(0, width - value.count)) }
    private static func date(_ value: Date) -> String { formatter("yyyy-MM-dd").string(from: value) }
    private static func time(_ value: Date) -> String { formatter("HHmm").string(from: value) }
    private static func formatter(_ format: String) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = format
        return formatter
    }
}
