// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation
import Network

public enum SpotFeed: String, Codable, CaseIterable, Sendable {
    case logbook = "Logbook"
    case contest = "Contest"
}

public enum DXSpotCategory: String, Codable, CaseIterable, Sendable {
    case stationWorkedBefore
    case dxccNotConfirmed
    case bandNotConfirmed
    case modeNotConfirmed
    case slotNotConfirmed
    case other
    case newMultiplier
    case workedBefore
    case useful
    case useless
    case unknown

    public var title: String {
        switch self {
        case .stationWorkedBefore: "Station worked before"
        case .dxccNotConfirmed: "DXCC not confirmed"
        case .bandNotConfirmed: "Band not confirmed"
        case .modeNotConfirmed: "Mode not confirmed"
        case .slotNotConfirmed: "Slot not confirmed"
        case .other: "Other"
        case .newMultiplier: "New multiplier"
        case .workedBefore: "Worked before"
        case .useful: "Useful"
        case .useless: "Useless"
        case .unknown: "Unknown"
        }
    }

    public static func categories(for feed: SpotFeed) -> [Self] {
        switch feed {
        case .logbook:
            [.stationWorkedBefore, .dxccNotConfirmed, .bandNotConfirmed, .modeNotConfirmed, .slotNotConfirmed, .other]
        case .contest:
            [.newMultiplier, .workedBefore, .useful, .useless, .unknown]
        }
    }
}

public struct SpotStyle: Codable, Equatable, Sendable {
    public var priority: Int
    public var colorHex: String
    public var lifetimeSeconds: Int

    public init(priority: Int = 1, colorHex: String = "#0A84FF", lifetimeSeconds: Int = 600) {
        self.priority = min(max(priority, 1), 5)
        self.colorHex = colorHex
        self.lifetimeSeconds = min(max(lifetimeSeconds, 30), 86_400)
    }
}

public struct SpotBridgeConfiguration: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var logbookPort: UInt16
    public var contestPort: UInt16
    public var styles: [DXSpotCategory: SpotStyle]

    public init(
        enabled: Bool = true,
        logbookPort: UInt16 = 12_062,
        contestPort: UInt16 = 12_063,
        styles: [DXSpotCategory: SpotStyle] = Self.defaultStyles
    ) {
        self.enabled = enabled
        self.logbookPort = logbookPort
        self.contestPort = contestPort
        self.styles = styles
    }

    public func style(for category: DXSpotCategory) -> SpotStyle {
        styles[category] ?? Self.defaultStyles[category] ?? SpotStyle()
    }

    public mutating func setStyle(_ style: SpotStyle, for category: DXSpotCategory) {
        styles[category] = style
    }

    public static let defaultStyles: [DXSpotCategory: SpotStyle] = [
        .stationWorkedBefore: SpotStyle(priority: 1, colorHex: "#8E8E93", lifetimeSeconds: 300),
        .dxccNotConfirmed: SpotStyle(priority: 5, colorHex: "#FF453A", lifetimeSeconds: 1_800),
        .bandNotConfirmed: SpotStyle(priority: 4, colorHex: "#FF9F0A", lifetimeSeconds: 1_200),
        .modeNotConfirmed: SpotStyle(priority: 3, colorHex: "#0A84FF", lifetimeSeconds: 900),
        .slotNotConfirmed: SpotStyle(priority: 3, colorHex: "#BF5AF2", lifetimeSeconds: 900),
        .other: SpotStyle(priority: 2, colorHex: "#64D2FF", lifetimeSeconds: 600),
        .newMultiplier: SpotStyle(priority: 5, colorHex: "#FF453A", lifetimeSeconds: 1_800),
        .workedBefore: SpotStyle(priority: 1, colorHex: "#8E8E93", lifetimeSeconds: 300),
        .useful: SpotStyle(priority: 4, colorHex: "#30D158", lifetimeSeconds: 900),
        .useless: SpotStyle(priority: 1, colorHex: "#636366", lifetimeSeconds: 180),
        .unknown: SpotStyle(priority: 2, colorHex: "#0A84FF", lifetimeSeconds: 600),
    ]
}

public struct FlexSpot: Equatable, Sendable {
    public let frequencyHz: Int64
    public let callsign: String
    public let mode: String
    public let source: String
    public let spotter: String
    public let comment: String
    public let timestamp: Int64
    public let lifetimeSeconds: Int
    public let priority: Int
    public let colorHex: String

    public init(
        frequencyHz: Int64,
        callsign: String,
        mode: String,
        source: String,
        spotter: String,
        comment: String,
        timestamp: Int64,
        lifetimeSeconds: Int,
        priority: Int,
        colorHex: String
    ) throws {
        guard (100_000...60_000_000).contains(frequencyHz) else { throw XCatError.invalidFrequency }
        let call = callsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !call.isEmpty, call.count <= 32 else { throw XCatError.server("The spot callsign is invalid.") }
        self.frequencyHz = frequencyHz
        self.callsign = call
        self.mode = Self.safe(mode, maximum: 16, fallback: "")
        self.source = Self.safe(source, maximum: 32, fallback: "RUMlogNG")
        self.spotter = Self.safe(spotter.uppercased(), maximum: 32, fallback: "")
        self.comment = Self.safe(comment, maximum: 96, fallback: "")
        self.timestamp = max(timestamp, 0)
        self.lifetimeSeconds = min(max(lifetimeSeconds, 30), 86_400)
        self.priority = min(max(priority, 1), 5)
        let normalizedColor = colorHex.uppercased()
        self.colorHex = normalizedColor.range(of: #"^#[0-9A-F]{6}$"#, options: .regularExpression) == nil
            ? "#0A84FF" : normalizedColor
    }

    private static func safe(_ value: String, maximum: Int, fallback: String) -> String {
        let scalarValues = value.unicodeScalars.map { scalar -> Character in
            (scalar.value >= 0x20 && scalar.value <= 0x7E && scalar != "|") ? Character(scalar) : " "
        }
        let result = String(scalarValues).trimmingCharacters(in: .whitespacesAndNewlines)
        return result.isEmpty ? fallback : String(result.prefix(maximum))
    }
}

public struct ParsedRUMlogSpot: Equatable, Sendable {
    public let frequencyHz: Int64
    public let callsign: String
    public let mode: String
    public let spotter: String
    public let stationName: String
    public let comment: String
    public let timestamp: Int64
    public let category: DXSpotCategory

    public func flexSpot(feed: SpotFeed, style: SpotStyle) throws -> FlexSpot {
        try FlexSpot(
            frequencyHz: frequencyHz,
            callsign: callsign,
            mode: mode,
            source: "RUMlogNG \(feed.rawValue)",
            spotter: spotter.isEmpty ? stationName : spotter,
            comment: comment,
            timestamp: timestamp,
            lifetimeSeconds: style.lifetimeSeconds,
            priority: style.priority,
            colorHex: style.colorHex
        )
    }
}

public enum RUMlogSpotParser {
    public static func parse(_ data: Data, feed: SpotFeed) throws -> ParsedRUMlogSpot {
        let delegate = SpotXMLDelegate()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        guard parser.parse() else {
            throw XCatError.server(parser.parserError?.localizedDescription ?? "RUMlog sent invalid spot XML.")
        }
        let fields = delegate.fields
        let rawFrequency = (fields["frequency"] ?? "").replacingOccurrences(of: ",", with: "")
        guard let number = Double(rawFrequency), number.isFinite, number > 0 else {
            throw XCatError.server("RUMlog spot has no valid frequency.")
        }
        let frequencyHz = Int64((number < 100_000 ? number * 1_000 : number).rounded())
        let callsign = fields["dxcall"] ?? ""
        let timestamp = parseTimestamp(fields["timestamp"]) ?? Int64(Date().timeIntervalSince1970)
        return ParsedRUMlogSpot(
            frequencyHz: frequencyHz,
            callsign: callsign,
            mode: fields["mode"] ?? "",
            spotter: fields["spottercall"] ?? "",
            stationName: fields["stationname"] ?? "",
            comment: fields["comment"] ?? "",
            timestamp: timestamp,
            category: category(fields: fields, feed: feed)
        )
    }

    private static func category(fields: [String: String], feed: SpotFeed) -> DXSpotCategory {
        switch feed {
        case .logbook:
            if truthy(fields["wkdb4"]) { return .stationWorkedBefore }
            if truthy(fields["dxccnotcfd"]) { return .dxccNotConfirmed }
            if truthy(fields["bandnotcfd"]) { return .bandNotConfirmed }
            if truthy(fields["modenotcfd"]) { return .modeNotConfirmed }
            if truthy(fields["slotnotcfd"]) { return .slotNotConfirmed }
            return .other
        case .contest:
            if truthy(fields["newmulti"]) { return .newMultiplier }
            if truthy(fields["wkdb4"]) { return .workedBefore }
            if truthy(fields["useful"]) { return .useful }
            if truthy(fields["useless"]) { return .useless }
            return .unknown
        }
    }

    private static func truthy(_ value: String?) -> Bool {
        ["1", "true", "yes", "y"].contains(value?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? "")
    }

    private static func parseTimestamp(_ value: String?) -> Int64? {
        guard let value, !value.isEmpty else { return nil }
        if let seconds = Int64(value) { return seconds }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: value) { return Int64(date.timeIntervalSince1970) }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value).map { Int64($0.timeIntervalSince1970) }
    }
}

private final class SpotXMLDelegate: NSObject, XMLParserDelegate {
    var fields: [String: String] = [:]
    private var currentElement = ""
    private var currentText = ""

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        currentElement = elementName.lowercased()
        currentText = ""
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        currentText += string
    }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let key = elementName.lowercased()
        if key == currentElement {
            fields[key] = currentText.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        currentElement = ""
        currentText = ""
    }
}

public final class UDPSpotReceiver: @unchecked Sendable {
    private final class StartupGate: @unchecked Sendable {
        private let lock = NSLock()
        private let semaphore = DispatchSemaphore(value: 0)
        private var resolved = false
        private var failure: String?

        func resolve(failure: String? = nil) {
            let shouldSignal = lock.withLock {
                guard !resolved else { return false }
                resolved = true
                self.failure = failure
                return true
            }
            if shouldSignal { semaphore.signal() }
        }

        func wait(timeout: DispatchTime) -> String? {
            guard semaphore.wait(timeout: timeout) == .success else {
                return "Timed out waiting for the listener to become ready."
            }
            return lock.withLock { failure }
        }
    }

    public typealias DatagramHandler = @Sendable (Data) -> Void
    public typealias EventHandler = @Sendable (String) -> Void

    private let queue: DispatchQueue
    private let onDatagram: DatagramHandler
    private let onEvent: EventHandler
    private var listener: NWListener?
    private var connections: [NWConnection] = []

    public init(label: String, onDatagram: @escaping DatagramHandler, onEvent: @escaping EventHandler = { _ in }) {
        queue = DispatchQueue(label: label)
        self.onDatagram = onDatagram
        self.onEvent = onEvent
    }

    public func start(port: UInt16) throws {
        guard listener == nil, let nwPort = NWEndpoint.Port(rawValue: port) else {
            throw XCatError.server("The RUMlog UDP port is invalid or already running.")
        }
        let parameters = NWParameters.udp
        parameters.allowLocalEndpointReuse = true
        parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: nwPort)
        let newListener = try NWListener(using: parameters)
        let startup = StartupGate()
        newListener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                startup.resolve()
                self?.onEvent("Listening on 127.0.0.1:\(port)")
            case let .failed(error):
                startup.resolve(failure: error.localizedDescription)
                self?.onEvent("UDP listener failed: \(error.localizedDescription)")
            default: break
            }
        }
        newListener.newConnectionHandler = { [weak self] connection in
            guard let self else { return }
            self.connections.append(connection)
            connection.start(queue: self.queue)
            self.receive(on: connection)
        }
        listener = newListener
        newListener.start(queue: queue)
        if let failure = startup.wait(timeout: .now() + 3) {
            newListener.cancel()
            listener = nil
            throw XCatError.server("Could not listen on 127.0.0.1:\(port): \(failure)")
        }
    }

    public func stop() {
        listener?.cancel()
        listener = nil
        queue.async { [weak self] in
            guard let self else { return }
            self.connections.forEach { $0.cancel() }
            self.connections.removeAll()
        }
    }

    private func receive(on connection: NWConnection) {
        connection.receiveMessage { [weak self] data, _, _, error in
            guard let self else { return }
            if let data, !data.isEmpty { self.onDatagram(data) }
            if error == nil {
                self.receive(on: connection)
            } else {
                self.connections.removeAll { $0 === connection }
                connection.cancel()
            }
        }
    }
}
