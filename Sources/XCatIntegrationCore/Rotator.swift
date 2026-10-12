// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation
import Network

public struct GeoCoordinate: Codable, Equatable, Sendable {
    public var latitude: Double
    public var longitude: Double

    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

public enum RotatorAutomaticSource: String, Codable, CaseIterable, Sendable {
    case country = "DXCC"
    case station = "Station"
}

public struct RotatorGotoRequest: Equatable, Sendable {
    public let bearing: Double
    public let band: String?

    public init?(command: String) {
        let fields = command.split(whereSeparator: \Character.isWhitespace).map(String.init)
        guard (2...3).contains(fields.count),
              fields[0].caseInsensitiveCompare("rotor_goto") == .orderedSame,
              let bearing = Double(fields[1]), bearing.isFinite, (0...360).contains(bearing) else { return nil }
        self.bearing = bearing
        band = fields.count == 3 ? fields[2] : nil
    }
}

public struct RotatorConfiguration: Codable, Equatable, Sendable {
    public static let supportedBands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m", "4m", "2m", "70cm", "Other"]

    public var enabled: Bool
    public var name: String
    public var host: String
    public var port: UInt16
    public var pollIntervalMilliseconds: Int
    public var connectAtLaunch: Bool
    public var homeGrid: String
    public var rumlogPort: UInt16
    public var automaticSource: RotatorAutomaticSource
    public var automaticTurningEnabled: Bool
    public var minimumAutomaticTurnDegrees: Int
    public var enabledBands: Set<String>
    public var bandOffsets: [String: Int]
    public var bidirectionalBands: Set<String>
    public var beamWidthDegrees: Int
    public var callsignDatabasePath: String

    public init(
        enabled: Bool = true,
        name: String = "Rotor",
        host: String = "",
        port: UInt16 = 4_001,
        pollIntervalMilliseconds: Int = 100,
        connectAtLaunch: Bool = true,
        homeGrid: String = "",
        rumlogPort: UInt16 = 12_064,
        automaticSource: RotatorAutomaticSource = .country,
        automaticTurningEnabled: Bool = false,
        minimumAutomaticTurnDegrees: Int = 0,
        enabledBands: Set<String> = [],
        bandOffsets: [String: Int] = [:],
        bidirectionalBands: Set<String> = [],
        beamWidthDegrees: Int = 5,
        callsignDatabasePath: String = ""
    ) {
        self.enabled = enabled
        self.name = name
        self.host = host
        self.port = port
        self.pollIntervalMilliseconds = min(max(pollIntervalMilliseconds, 100), 5_000)
        self.connectAtLaunch = connectAtLaunch
        self.homeGrid = homeGrid.uppercased()
        self.rumlogPort = rumlogPort
        self.automaticSource = automaticSource
        self.automaticTurningEnabled = automaticTurningEnabled
        self.minimumAutomaticTurnDegrees = min(max(minimumAutomaticTurnDegrees, 0), 180)
        self.enabledBands = enabledBands
        self.bandOffsets = bandOffsets
        self.bidirectionalBands = bidirectionalBands
        self.beamWidthDegrees = min(max(beamWidthDegrees, 1), 90)
        self.callsignDatabasePath = callsignDatabasePath
    }

    public func allowsTurning(on rawBand: String) -> Bool {
        let normalized = rawBand.trimmingCharacters(in: .whitespacesAndNewlines)
        return enabledBands.contains { $0.caseInsensitiveCompare(normalized) == .orderedSame }
    }

    public static func importedRotorConfiguration(homeDirectory: String = NSHomeDirectory()) -> Self? {
        let preferences = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent("Library/Containers/de.dl2rum.Rotor/Data/Library/Preferences/de.dl2rum.Rotor_0.plist")
        let sharedPreferences = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent("Library/Containers/de.dl2rum.Rotor/Data/Library/Preferences/de.dl2rum.Rotor.plist")
        guard let data = try? Data(contentsOf: preferences),
              let object = try? PropertyListSerialization.propertyList(from: data, format: nil),
              let values = object as? [String: Any],
              (values["RotorType"] as? String)?.uppercased() == "DCU-1" else { return nil }

        let shared: [String: Any]
        if let data = try? Data(contentsOf: sharedPreferences),
           let object = try? PropertyListSerialization.propertyList(from: data, format: nil),
           let dictionary = object as? [String: Any] {
            shared = dictionary
        } else {
            shared = [:]
        }

        var enabledBands = Set<String>()
        var offsets: [String: Int] = [:]
        var bidirectional = Set<String>()
        for (index, band) in supportedBands.enumerated() {
            let preferenceIndex = index + 1
            if Self.bool(values["AutoRotate_\(preferenceIndex)"]) { enabledBands.insert(band) }
            if Self.bool(values["Bidirectional_\(preferenceIndex)"]) { bidirectional.insert(band) }
            if let value = Self.integer(values["OffsetIdx_\(preferenceIndex)"]), value != 0 { offsets[band] = value }
        }

        let source: RotatorAutomaticSource = Self.bool(values["UseLogStnForAuto"]) ? .station : .country
        let database = URL(fileURLWithPath: homeDirectory)
            .appendingPathComponent("Library/Containers/de.dl2rum.Rotor/Data/Library/Application Support/de.dl2rum.Rotor/grids.txt")
            .path
        return RotatorConfiguration(
            enabled: true,
            name: values["RotorIdentifier"] as? String ?? "Rotor",
            host: values["tcpAddressAz"] as? String ?? "",
            port: UInt16(clamping: Self.integer(values["tcpPortAz"]) ?? 4_001),
            pollIntervalMilliseconds: Self.pollMilliseconds(values["PollRateIdx"]),
            connectAtLaunch: Self.bool(values["AutoConnect"]),
            homeGrid: shared["MyLocator"] as? String ?? "",
            rumlogPort: UInt16(clamping: Self.integer(values["LogUdpPort"]) ?? 12_064),
            automaticSource: source,
            automaticTurningEnabled: false,
            minimumAutomaticTurnDegrees: 0,
            enabledBands: enabledBands,
            bandOffsets: offsets,
            bidirectionalBands: bidirectional,
            beamWidthDegrees: 5,
            callsignDatabasePath: database
        )
    }

    private static func bool(_ value: Any?) -> Bool {
        (value as? Bool) ?? ((value as? NSNumber)?.boolValue ?? false)
    }

    private static func integer(_ value: Any?) -> Int? {
        (value as? Int) ?? (value as? NSNumber)?.intValue
    }

    private static func pollMilliseconds(_ value: Any?) -> Int {
        if let number = integer(value) { return min(max(number, 100), 5_000) }
        guard let text = value as? String,
              let number = Int(text.components(separatedBy: CharacterSet.decimalDigits.inverted).joined()) else { return 100 }
        return min(max(number, 100), 5_000)
    }
}

public enum MaidenheadLocator {
    public static func coordinate(from rawLocator: String) -> GeoCoordinate? {
        let locator = rawLocator.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard [4, 6, 8, 10].contains(locator.count) else { return nil }
        let characters = Array(locator.utf8)
        guard let firstLon = letter(characters[0], maximum: 18),
              let firstLat = letter(characters[1], maximum: 18),
              let digitLon = digit(characters[2]),
              let digitLat = digit(characters[3]) else { return nil }

        var longitude = -180.0 + Double(firstLon) * 20.0 + Double(digitLon) * 2.0
        var latitude = -90.0 + Double(firstLat) * 10.0 + Double(digitLat)
        var longitudeCell = 2.0
        var latitudeCell = 1.0

        if characters.count >= 6 {
            guard let subLon = letter(characters[4], maximum: 24),
                  let subLat = letter(characters[5], maximum: 24) else { return nil }
            longitudeCell /= 24.0
            latitudeCell /= 24.0
            longitude += Double(subLon) * longitudeCell
            latitude += Double(subLat) * latitudeCell
        }
        if characters.count >= 8 {
            guard let extLon = digit(characters[6]), let extLat = digit(characters[7]) else { return nil }
            longitudeCell /= 10.0
            latitudeCell /= 10.0
            longitude += Double(extLon) * longitudeCell
            latitude += Double(extLat) * latitudeCell
        }
        if characters.count >= 10 {
            guard let subExtLon = letter(characters[8], maximum: 24),
                  let subExtLat = letter(characters[9], maximum: 24) else { return nil }
            longitudeCell /= 24.0
            latitudeCell /= 24.0
            longitude += Double(subExtLon) * longitudeCell
            latitude += Double(subExtLat) * latitudeCell
        }
        return GeoCoordinate(latitude: latitude + latitudeCell / 2, longitude: longitude + longitudeCell / 2)
    }

    private static func letter(_ ascii: UInt8, maximum: Int) -> Int? {
        let value = Int(ascii) - 65
        return (0..<maximum).contains(value) ? value : nil
    }

    private static func digit(_ ascii: UInt8) -> Int? {
        let value = Int(ascii) - 48
        return (0...9).contains(value) ? value : nil
    }
}

public enum RotatorGeometry {
    public static func bearingForDialPoint(
        x: Double,
        y: Double,
        centerX: Double,
        centerY: Double,
        radius: Double
    ) -> Double? {
        guard x.isFinite, y.isFinite, centerX.isFinite, centerY.isFinite,
              radius.isFinite, radius > 0 else { return nil }
        let horizontal = x - centerX
        let vertical = centerY - y
        let distance = hypot(horizontal, vertical)
        guard distance > 0.5, distance <= radius else { return nil }
        return normalized(atan2(horizontal, vertical).degrees)
    }

    public static func initialBearing(from: GeoCoordinate, to: GeoCoordinate) -> Double {
        let latitude1 = from.latitude.radians
        let latitude2 = to.latitude.radians
        let longitudeDelta = (to.longitude - from.longitude).radians
        let y = sin(longitudeDelta) * cos(latitude2)
        let x = cos(latitude1) * sin(latitude2) - sin(latitude1) * cos(latitude2) * cos(longitudeDelta)
        return normalized(atan2(y, x).degrees)
    }

    public static func distanceKilometers(from: GeoCoordinate, to: GeoCoordinate) -> Double {
        let latitudeDelta = (to.latitude - from.latitude).radians
        let longitudeDelta = (to.longitude - from.longitude).radians
        let latitude1 = from.latitude.radians
        let latitude2 = to.latitude.radians
        let a = sin(latitudeDelta / 2) * sin(latitudeDelta / 2)
            + cos(latitude1) * cos(latitude2) * sin(longitudeDelta / 2) * sin(longitudeDelta / 2)
        return 6_371.0 * 2.0 * atan2(sqrt(a), sqrt(1.0 - a))
    }

    public static func destination(from: GeoCoordinate, bearing: Double, distanceKilometers: Double) -> GeoCoordinate {
        let angularDistance = distanceKilometers / 6_371.0
        let bearing = bearing.radians
        let latitude1 = from.latitude.radians
        let longitude1 = from.longitude.radians
        let latitude2 = asin(sin(latitude1) * cos(angularDistance) + cos(latitude1) * sin(angularDistance) * cos(bearing))
        let longitude2 = longitude1 + atan2(
            sin(bearing) * sin(angularDistance) * cos(latitude1),
            cos(angularDistance) - sin(latitude1) * sin(latitude2)
        )
        return GeoCoordinate(latitude: latitude2.degrees, longitude: normalizedLongitude(longitude2.degrees))
    }

    public static func shortestDifference(from: Double, to: Double) -> Double {
        var difference = normalized(to) - normalized(from)
        if difference > 180 { difference -= 360 }
        if difference < -180 { difference += 360 }
        return difference
    }

    public static func shouldAutomaticallyTurn(from current: Double, to target: Double, minimumChange: Double) -> Bool {
        let deadband = max(1.0, minimumChange)
        return abs(shortestDifference(from: current, to: target)) > deadband
    }

    public static func normalized(_ bearing: Double) -> Double {
        let value = bearing.truncatingRemainder(dividingBy: 360)
        return value < 0 ? value + 360 : value
    }

    private static func normalizedLongitude(_ longitude: Double) -> Double {
        var value = longitude.truncatingRemainder(dividingBy: 360)
        if value > 180 { value -= 360 }
        if value < -180 { value += 360 }
        return value
    }
}

public struct RUMlogRotatorUpdate: Equatable, Sendable {
    public var callsign: String
    public var countryCode: String
    public var grid: String
    public var band: String
    public var countryBearing: Double?
    public var stationBearing: Double?
    public var commandedBearing: Double?

    public init(callsign: String = "", countryCode: String = "", grid: String = "", band: String = "", countryBearing: Double? = nil, stationBearing: Double? = nil, commandedBearing: Double? = nil) {
        self.callsign = callsign
        self.countryCode = countryCode
        self.grid = grid
        self.band = band
        self.countryBearing = countryBearing
        self.stationBearing = stationBearing
        self.commandedBearing = commandedBearing
    }

    public func stableLabel(previous: String, previousBearing: Double?, targetBearing: Double, fallback: String) -> String {
        if !callsign.isEmpty { return callsign }
        if !previous.isEmpty,
           let previousBearing,
           abs(RotatorGeometry.shortestDifference(from: previousBearing, to: targetBearing)) <= 1.0 {
            return previous
        }
        return countryCode.isEmpty ? fallback : countryCode
    }
}

public enum RUMlogRotatorParser {
    public static func parse(_ data: Data) throws -> RUMlogRotatorUpdate {
        if let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            return try makeUpdate(fields: object.reduce(into: [:]) { $0[$1.key.lowercased()] = String(describing: $1.value) })
        }
        let delegate = RotatorXMLDelegate()
        let parser = XMLParser(data: data)
        parser.shouldResolveExternalEntities = false
        parser.delegate = delegate
        if parser.parse(), !delegate.fields.isEmpty { return try makeUpdate(fields: delegate.fields) }
        guard let text = String(data: data, encoding: .utf8) else {
            throw XCatError.server("RUMlog sent an unreadable rotator datagram.")
        }
        var fields: [String: String] = [:]
        for part in text.components(separatedBy: CharacterSet(charactersIn: ";,\n")) {
            let pair = part.split(separator: "=", maxSplits: 1).map(String.init)
            if pair.count == 2 { fields[pair[0].trimmingCharacters(in: .whitespaces).lowercased()] = pair[1].trimmingCharacters(in: .whitespaces) }
        }
        return try makeUpdate(fields: fields)
    }

    private static func makeUpdate(fields: [String: String]) throws -> RUMlogRotatorUpdate {
        func first(_ keys: [String]) -> String {
            for key in keys {
                if let value = fields[key], !value.isEmpty { return value }
            }
            return ""
        }
        func bearing(_ keys: [String]) -> Double? {
            let cleaned = first(keys).replacingOccurrences(of: "°", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard let value = Double(cleaned), value.isFinite, (0...360).contains(value) else { return nil }
            return RotatorGeometry.normalized(value)
        }
        let update = RUMlogRotatorUpdate(
            callsign: first(["shownstation", "dxcall", "callsign", "call", "stationcall"]).uppercased(),
            countryCode: first(["showndxcc", "dxcc"]).uppercased(),
            grid: first(["shownstationlocation", "showndxcclocation", "dxgrid", "grid", "gridsquare", "locator"]).uppercased(),
            band: first(["currentband", "band", "bandname"]).lowercased(),
            countryBearing: bearing(["hdgtodxcc", "headingtocountry", "countrybearing", "dxccbearing", "bearing"]),
            stationBearing: bearing(["hdgtostation", "headingtostation", "stationbearing"]),
            commandedBearing: bearing(["rotorcommand", "rotorazimuth", "azimuth", "heading"])
        )
        guard update.countryBearing != nil || update.stationBearing != nil || update.commandedBearing != nil || MaidenheadLocator.coordinate(from: update.grid) != nil else {
            throw XCatError.server("RUMlog rotator datagram has no bearing or valid grid.")
        }
        return update
    }
}

public enum DCU1Protocol {
    public static let pollCommand = "AI1;"
    public static let stopCommand = ";"
    public static let clockwiseCommand = "U"
    public static let counterclockwiseCommand = "D"

    public static func turnCommand(to bearing: Double) -> String {
        let normalized = Int(RotatorGeometry.normalized(bearing).rounded()) % 360
        return String(format: "AP1%03d;AM1;", normalized)
    }

    public static func azimuths(in text: String) -> [Double] {
        let pattern = #"(?:^|;)\s*(\d{1,3}(?:\.\d)?)\s*;"#
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return [] }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        return expression.matches(in: text, range: range).compactMap { match in
            guard match.numberOfRanges > 1,
                  let valueRange = Range(match.range(at: 1), in: text),
                  let value = Double(text[valueRange]), (0...450).contains(value) else { return nil }
            return RotatorGeometry.normalized(value)
        }
    }
}

private final class RotatorXMLDelegate: NSObject, XMLParserDelegate {
    var fields: [String: String] = [:]
    private var currentElement = ""
    private var currentText = ""

    func parser(_ parser: XMLParser, didStartElement elementName: String, namespaceURI: String?, qualifiedName qName: String?, attributes attributeDict: [String: String] = [:]) {
        currentElement = elementName.lowercased()
        currentText = ""
        for (key, value) in attributeDict { fields[key.lowercased()] = value }
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) { currentText += string }

    func parser(_ parser: XMLParser, didEndElement elementName: String, namespaceURI: String?, qualifiedName qName: String?) {
        let key = elementName.lowercased()
        if key == currentElement { fields[key] = currentText.trimmingCharacters(in: .whitespacesAndNewlines) }
        currentElement = ""
        currentText = ""
    }
}

public final class DCU1RotatorClient: @unchecked Sendable {
    public enum State: String, Sendable {
        case stopped, connecting, connected, reconnecting, failed
    }

    public typealias StateHandler = @Sendable (State, String) -> Void
    public typealias AzimuthHandler = @Sendable (Double) -> Void

    private let host: String
    private let port: UInt16
    private let pollMilliseconds: Int
    private let onState: StateHandler
    private let onAzimuth: AzimuthHandler
    private let queue = DispatchQueue(label: "com.oliverbross.OM0RXXCat.rotator")
    private var connection: NWConnection?
    private var pollTimer: DispatchSourceTimer?
    private var desiredRunning = false
    private var reconnectAttempt = 0
    private var receiveBuffer = ""

    public init(host: String, port: UInt16, pollMilliseconds: Int, onState: @escaping StateHandler, onAzimuth: @escaping AzimuthHandler) {
        self.host = host
        self.port = port
        self.pollMilliseconds = min(max(pollMilliseconds, 100), 5_000)
        self.onState = onState
        self.onAzimuth = onAzimuth
    }

    public func start() {
        queue.async { [weak self] in
            guard let self, !self.desiredRunning else { return }
            self.desiredRunning = true
            self.connect(reconnecting: false)
        }
    }

    public func stop() {
        queue.async { [weak self] in
            self?.stopOnQueue()
        }
    }

    /// Retire this transport before another rotor owner is admitted. This
    /// queue barrier does not claim that the physical rotor has stopped.
    public func stopAndDrain() async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            queue.async { [self] in
                stopOnQueue()
                continuation.resume()
            }
        }
    }

    private func stopOnQueue() {
        desiredRunning = false
        stopPolling()
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        receiveBuffer = ""
        onState(.stopped, "Disconnected")
    }

    public func turn(to bearing: Double) async throws {
        try await sendCommand(DCU1Protocol.turnCommand(to: bearing))
    }

    public func stopRotation() async throws {
        try await sendCommand(DCU1Protocol.stopCommand)
    }

    public func rotate(clockwise: Bool) async throws {
        try await sendCommand(clockwise ? DCU1Protocol.clockwiseCommand : DCU1Protocol.counterclockwiseCommand)
    }

    private func sendCommand(_ command: String) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            queue.async { [weak self] in
                guard let self, let connection = self.connection else {
                    continuation.resume(throwing: XCatError.server("Rotator is not connected."))
                    return
                }
                connection.send(content: Data(command.utf8), completion: .contentProcessed { error in
                    if let error { continuation.resume(throwing: XCatError.server(error.localizedDescription)) }
                    else { continuation.resume(returning: ()) }
                })
            }
        }
    }

    private func connect(reconnecting: Bool) {
        guard desiredRunning, connection == nil,
              !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              let nwPort = NWEndpoint.Port(rawValue: port) else {
            if desiredRunning { onState(.failed, "Enter the rotator TCP host and port") }
            return
        }
        onState(reconnecting ? .reconnecting : .connecting, reconnecting ? "Reconnecting to \(host):\(port)" : "Connecting to \(host):\(port)")
        let newConnection = NWConnection(host: NWEndpoint.Host(host), port: nwPort, using: .tcp)
        connection = newConnection
        newConnection.stateUpdateHandler = { [weak self, weak newConnection] state in
            guard let self, let newConnection, self.connection === newConnection else { return }
            switch state {
            case .ready:
                self.reconnectAttempt = 0
                self.onState(.connected, "Connected to \(self.host):\(self.port)")
                self.startPolling()
                self.receive(on: newConnection)
            case let .failed(error):
                self.handleDisconnect("Connection failed: \(error.localizedDescription)")
            case .cancelled:
                if self.desiredRunning { self.handleDisconnect("Connection closed") }
            default: break
            }
        }
        newConnection.start(queue: queue)
    }

    private func handleDisconnect(_ message: String) {
        stopPolling()
        connection?.stateUpdateHandler = nil
        connection?.cancel()
        connection = nil
        guard desiredRunning else { return }
        reconnectAttempt += 1
        let delay = min(pow(2.0, Double(min(reconnectAttempt, 4))), 15.0)
        onState(.reconnecting, "\(message) — retrying")
        queue.asyncAfter(deadline: .now() + delay) { [weak self] in self?.connect(reconnecting: true) }
    }

    private func startPolling() {
        stopPolling()
        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: .milliseconds(pollMilliseconds), leeway: .milliseconds(20))
        timer.setEventHandler { [weak self] in
            self?.connection?.send(content: Data(DCU1Protocol.pollCommand.utf8), completion: .idempotent)
        }
        pollTimer = timer
        timer.resume()
    }

    private func stopPolling() {
        pollTimer?.setEventHandler {}
        pollTimer?.cancel()
        pollTimer = nil
    }

    private func receive(on activeConnection: NWConnection) {
        activeConnection.receive(minimumIncompleteLength: 1, maximumLength: 2_048) { [weak self, weak activeConnection] data, _, complete, error in
            guard let self, let activeConnection, self.connection === activeConnection else { return }
            if let data, !data.isEmpty { self.consume(data) }
            if complete || error != nil {
                self.handleDisconnect(error.map { "Connection lost: \($0.localizedDescription)" } ?? "Connection closed")
            } else {
                self.receive(on: activeConnection)
            }
        }
    }

    private func consume(_ data: Data) {
        guard let text = String(data: data, encoding: .ascii) else { return }
        receiveBuffer += text
        if receiveBuffer.count > 4_096 { receiveBuffer = String(receiveBuffer.suffix(1_024)) }
        let values = DCU1Protocol.azimuths(in: receiveBuffer)
        for value in values { onAzimuth(value) }
        if !values.isEmpty, let lastTerminator = receiveBuffer.lastIndex(of: ";") {
            receiveBuffer.removeSubrange(receiveBuffer.startIndex...lastTerminator)
        }
    }
}

private extension Double {
    var radians: Double { self * .pi / 180 }
    var degrees: Double { self * 180 / .pi }
}
