import Foundation
import XCTest
@testable import XClusterIntegrationCore

private final class TestClusterTransport: ClusterConnectionTransport, @unchecked Sendable {
    var onState: (@Sendable (ClusterConnectionPhase, String?) -> Void)?
    var onLine: (@Sendable (String) -> Void)?
    var sent: [String] = []
    var stopped = false
    var optionUpdates: [(Bool, Bool)] = []

    func start() { onState?(.connected, nil) }
    func send(_ command: String) { sent.append(command) }
    func stop() { stopped = true }
    func emit(_ line: String) { onLine?(line) }
    func updateOptions(reconnect: Bool, requestSkimmer: Bool) { optionUpdates.append((reconnect, requestSkimmer)) }
}

private final class TestTransportSupplier: @unchecked Sendable {
    private let lock = NSLock()
    private var next = 0
    let transports: [TestClusterTransport]

    init(_ transports: [TestClusterTransport]) { self.transports = transports }

    func make(onState: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
              onLine: @escaping @Sendable (String) -> Void) -> TestClusterTransport {
        lock.lock()
        let chosen = transports[next]
        next += 1
        lock.unlock()
        chosen.onState = onState
        chosen.onLine = onLine
        return chosen
    }
}

private final class TestSpotEvents: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [(UUID, UUID)] = []
    func record(_ spot: ClassifiedClusterSpot, generation: UUID) {
        lock.lock(); values.append((spot.id, generation)); lock.unlock()
    }
    var all: [(UUID, UUID)] {
        lock.lock(); defer { lock.unlock() }; return values
    }
}

final class ClusterSessionServiceTests: XCTestCase {
    private func waitFor(_ predicate: @escaping () async -> Bool) async throws {
        for _ in 0..<100 {
            if await predicate() { return }
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTFail("Cluster service update did not arrive")
    }

    func testDisplaySaveRetainsConnectionsHistoryIDsAndRefreshesColoursAndRules() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        var config = ClusterSessionConfiguration(servers: [server], requestRecentSpotsOnConnect: false)
        let connection = TestClusterTransport()
        let supplier = TestTransportSupplier([connection]) // Any unexpected reconnect fails this fixture.
        let service = ClusterSessionService(configuration: config, transportFactory: { _, _, _, _, state, line in
            supplier.make(onState: state, onLine: line)
        })
        try await service.connect()
        connection.emit("DX de W1AW: 14025.0 K1ABC CW CUSTOM")
        connection.emit("Fixture greeting")
        try await waitFor { await service.snapshot().console.count == 1 }
        let before = await service.snapshot()
        config.palette.status["Unknown"] = "#123456"
        config.palette.band["20m"] = "#234567"
        config.palette.mode["CW"] = "#345678"
        config.specialRules = [.init(name: "Custom", keywords: ["CUSTOM"])]
        config.servers[0].name = "Renamed"
        config.maximumSpots = 500
        config.reconnect = false
        config.requestSkimmer = false
        try await service.configure(config, password: { _ in XCTFail("Display save read a password"); return "" })
        let after = await service.snapshot()
        XCTAssertEqual(after.spots.map(\.id), before.spots.map(\.id))
        XCTAssertEqual(after.spots.first?.receivedAt, before.spots.first?.receivedAt)
        XCTAssertEqual(after.spots.first?.statusHex, "#123456")
        XCTAssertEqual(after.spots.first?.bandHex, "#234567")
        XCTAssertEqual(after.spots.first?.modeHex, "#345678")
        XCTAssertEqual(after.spots.first?.specialTags, ["Custom"])
        XCTAssertEqual(after.console.count, 1)
        XCTAssertEqual(after.connections.first?.serverName, "Renamed")
        XCTAssertEqual(after.connectedClusters, 1)
        XCTAssertFalse(connection.stopped)
        XCTAssertEqual(connection.optionUpdates.count, 1)
        XCTAssertFalse(connection.optionUpdates[0].0)
        XCTAssertFalse(connection.optionUpdates[0].1)
        connection.emit("DX de W1AW: 14026.0 K2ABC CW")
        try await waitFor { await service.snapshot().loadedSpots == 2 }
        await service.disconnect()
    }

    func testConnectionEditReplacesOnlyAffectedSocketAndKeepsSpotsAndRejectsStaleEvents() async throws {
        let a = ClusterServerConfiguration(name: "A", host: "a.invalid", port: 7300, callsign: "OM0RX")
        let b = ClusterServerConfiguration(name: "B", host: "b.invalid", port: 7300, callsign: "OM0RX")
        var config = ClusterSessionConfiguration(servers: [a, b])
        let old = TestClusterTransport(), unaffected = TestClusterTransport(), replacement = TestClusterTransport()
        let supplier = TestTransportSupplier([old, unaffected, replacement])
        let service = ClusterSessionService(configuration: config, transportFactory: { server, password, _, _, state, line in
            if server.host == "changed.invalid" { XCTAssertEqual(password, "replacement-secret") }
            return supplier.make(onState: state, onLine: line)
        })
        try await service.connect()
        old.emit("DX de W1AW: 14025.0 K1BEFORE CW")
        try await waitFor { await service.snapshot().loadedSpots == 1 }
        let before = await service.snapshot().spots.first?.id
        config.servers[0].host = "changed.invalid"
        try await service.configure(config, password: { id in
            XCTAssertEqual(id, a.id); return "replacement-secret"
        })
        try await waitFor { await service.snapshot().connectedClusters == 2 }
        XCTAssertTrue(old.stopped)
        XCTAssertFalse(unaffected.stopped)
        old.emit("DX de W1AW: 14026.0 K1STALE CW")
        old.onState?(.failed, "stale failure")
        unaffected.emit("DX de W1AW: 14027.0 K1UNTOUCHED CW")
        replacement.emit("DX de W1AW: 14028.0 K1AFTER CW")
        try await waitFor { await service.snapshot().loadedSpots >= 3 }
        try await Task.sleep(for: .milliseconds(30))
        let result = await service.snapshot()
        XCTAssertEqual(result.connectedClusters, 2)
        XCTAssertEqual(result.loadedSpots, 3)
        XCTAssertTrue(result.spots.contains { $0.id == before })
        XCTAssertFalse(result.spots.contains { $0.callsign == "K1STALE" })
        // Disabling/removing a server closes only that socket, never its historical spots.
        config.servers.removeFirst()
        try await service.configure(config)
        XCTAssertTrue(replacement.stopped)
        XCTAssertFalse(unaffected.stopped)
        let retained = await service.snapshot()
        XCTAssertEqual(retained.loadedSpots, 3)
        XCTAssertEqual(retained.connections.count, 1)
        await service.disconnect()
        config.servers[0].port = 7301
        try await service.configure(config, password: { _ in XCTFail("Disconnected save read a password"); return "" })
        let disconnected = await service.snapshot()
        XCTAssertEqual(disconnected.connectedClusters, 0)
        XCTAssertEqual(disconnected.loadedSpots, 3)
    }

    func testFailedCredentialReadLeavesOldConnectionAndHistoryUntouched() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        var config = ClusterSessionConfiguration(servers: [server])
        let connection = TestClusterTransport()
        let supplier = TestTransportSupplier([connection])
        let service = ClusterSessionService(configuration: config, transportFactory: { _, _, _, _, state, line in
            supplier.make(onState: state, onLine: line)
        })
        try await service.connect()
        connection.emit("DX de W1AW: 14025.0 K1ABC CW")
        try await waitFor { await service.snapshot().loadedSpots == 1 }
        config.servers[0].port = 7301
        do {
            try await service.configure(config, password: { _ in throw ClusterSessionError.notConnected })
            XCTFail("Expected credential failure")
        } catch ClusterSessionError.notConnected { }
        XCTAssertFalse(connection.stopped)
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.connectedClusters, 1)
        XCTAssertEqual(snapshot.loadedSpots, 1)
        await service.terminate()
        do { try await service.configure(config); XCTFail("Terminated session reconfigured") }
        catch ClusterSessionError.terminated { }
    }

    func testRealLineClassificationFilteringConsoleAndCredentialSeparation() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX-12")
        let connection = TestClusterTransport()
        let service = ClusterSessionService(configuration: .init(servers: [server], requestRecentSpotsOnConnect: false), transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        await service.replaceCountryCSV("K,United States,291,NA,5,8,40,100,-5,K N W;")
        await service.replaceContacts([ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291)])
        try await service.connect(passwords: [server.id: "private-test-password"])
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14025.0 K1NEW CW POTA K-1234")
        connection.emit("DX de K2SPT-#: 14027.0 K1OLD CW RBN")
        connection.emit("No spots found")
        try await waitFor {
            let state = await service.snapshot()
            return state.loadedSpots == 2 && state.console.count == 1
        }

        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.spots.count, 1) // Exact worked band/mode is hidden by original default.
        XCTAssertEqual(snapshot.spots[0].callsign, "K1NEW")
        XCTAssertEqual(snapshot.spots[0].dxccStatus, "Worked")
        XCTAssertEqual(snapshot.spots[0].country, "UNITED STATES")
        XCTAssertEqual(snapshot.spots[0].source, "cluster")
        XCTAssertEqual(snapshot.spots[0].specialTags, ["POTA"])
        XCTAssertEqual(snapshot.console.last?.text, "No spots found")
        let encoded = String(decoding: try JSONEncoder().encode(snapshot), as: UTF8.self)
        XCTAssertFalse(encoded.contains("private-test-password"))

        var filter = ClusterSpotFilter()
        filter.sources = ["rbl"]
        await service.updateFilter(filter)
        let filtered = await service.snapshot()
        XCTAssertEqual(filtered.spots.count, 0)
        await service.disconnect()
        XCTAssertTrue(connection.stopped)
    }

    func testDXSpiderFTSkimmerWithoutHashSuffixSurvivesRBNSourceFilter() async throws {
        let server = ClusterServerConfiguration(name: "ShackCQ", host: "example.invalid", port: 7300, callsign: "OM0RX-13")
        let connection = TestClusterTransport()
        let service = ClusterSessionService(
            configuration: .init(servers: [server], requestRecentSpotsOnConnect: false),
            transportFactory: { _, _, _, _, onState, onLine in
                connection.onState = onState
                connection.onLine = onLine
                return connection
            }
        )
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de CT7AUT: 14074.3 OM0RX FT8 -17 dB 1096 Hz")
        try await waitFor { await service.snapshot().loadedSpots == 1 }

        var filter = ClusterSpotFilter()
        filter.sources = ["rbl"]
        await service.updateFilter(filter)
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.spots.count, 1)
        XCTAssertEqual(snapshot.spots[0].callsign, "OM0RX")
        XCTAssertEqual(snapshot.spots[0].source, "rbl")
        XCTAssertEqual(snapshot.spots[0].mode, "FT8")
        XCTAssertEqual(snapshot.spots[0].specialTags, ["RBN"])
    }

    func testJTTYCommentSurvivesDisplayAndUsesDigitalClassification() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX-12")
        let connection = TestClusterTransport()
        let configuration = ClusterSessionConfiguration(servers: [server], requestRecentSpotsOnConnect: false,
                                                        showWorkedBandModeSpots: true)
        let service = ClusterSessionService(configuration: configuration, transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        await service.replaceCountryCSV("K,United States,291,NA,5,8,40,100,-5,K N W;")
        await service.replaceContacts([ClusterContact(callsign: "K1JTY", band: "15m", mode: "FT8", adif: 291, lotwQSL: "Y")])
        try await service.connect(passwords: [:])
        try await waitFor { await service.snapshot().connectedClusters == 1 }

        connection.emit("DX de K1SPT: 21091.5 K1JTY JTTY")
        try await waitFor { await service.snapshot().loadedSpots == 1 }

        let snapshot = await service.snapshot()
        let spot = try XCTUnwrap(snapshot.spots.first)
        XCTAssertEqual(spot.mode, "JTTY")
        XCTAssertEqual(spot.modeHex, ClusterPalette.originalDefaults.mode["JTTY"])
        XCTAssertEqual(spot.callStatus, "Confirmed")
        XCTAssertEqual(spot.dxccStatus, "Confirmed")
        await service.disconnect()
    }

    func testCommandIsBoundedAndNotEchoedIntoSnapshot() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX-12")
        let connection = TestClusterTransport()
        let service = ClusterSessionService(configuration: .init(servers: [server], requestRecentSpotsOnConnect: false), transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        try await service.sendCommand("SH/DX\r\n", to: server.id)
        XCTAssertEqual(connection.sent, ["SH/DX"])
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.console.last?.text, "Command sent")
        do {
            try await service.sendCommand(String(repeating: "A", count: 161))
            XCTFail("Oversized command must be rejected")
        } catch {}
        await service.disconnect()
    }

    func testRequestsRecentSpotsOnceForEachSuccessfulConnectionTransition() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX-12")
        let connection = TestClusterTransport()
        let service = ClusterSessionService(configuration: .init(servers: [server]), transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        try await service.connect()
        try await waitFor { connection.sent == ["sh/dx/100"] }
        connection.onState?(.connected, nil)
        try await Task.sleep(for: .milliseconds(20))
        XCTAssertEqual(connection.sent, ["sh/dx/100"])
        connection.onState?(.failed, "test interruption")
        connection.onState?(.connected, nil)
        try await waitFor { connection.sent == ["sh/dx/100", "sh/dx/100"] }
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.console.filter { $0.text == "Requested 100 recent DX spots" }.count, 2)
        await service.disconnect()

        let optedOut = TestClusterTransport()
        let disabled = ClusterSessionService(configuration: .init(servers: [server], requestRecentSpotsOnConnect: false), transportFactory: { _, _, _, _, onState, onLine in
            optedOut.onState = onState
            optedOut.onLine = onLine
            return optedOut
        })
        try await disabled.connect()
        try await waitFor { await disabled.snapshot().connectedClusters == 1 }
        XCTAssertTrue(optedOut.sent.isEmpty)
        await disabled.terminate()
    }

    func testBoundedTelnetFramingAcrossChunks() {
        var framer = ClusterTelnetLineFramer()
        XCTAssertEqual(framer.consume(Data([255, 251])), [])
        XCTAssertEqual(framer.consume(Data([1] + Array("DX de K1: 14025.0 ".utf8))), [])
        XCTAssertEqual(framer.consume(Data("K1ABC CW\r\n".utf8)), ["DX de K1: 14025.0 K1ABC CW"])
        XCTAssertEqual(framer.consume(Data((String(repeating: "X", count: ClusterLineParser.maximumLineBytes + 1) + "\nOK\n").utf8)), ["OK"])
        XCTAssertEqual(framer.consume(Data([255, 250, 1, 2, 255])), [])
        XCTAssertEqual(framer.consume(Data([240] + Array("READY\n".utf8))), ["READY"])
    }

    func testCallbacksFromPreviousSocketCannotChangeReconnectedSession() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        let old = TestClusterTransport()
        let current = TestClusterTransport()
        let supplier = TestTransportSupplier([old, current])
        let service = ClusterSessionService(configuration: .init(servers: [server]), transportFactory: { _, _, _, _, onState, onLine in
            supplier.make(onState: onState, onLine: onLine)
        })
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        await service.disconnect()
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        old.onState?(.failed, "stale failure")
        old.emit("DX de K1OLD: 14025.0 K1STALE CW")
        current.emit("DX de K1NEW: 14026.0 K1FRESH CW")
        try await waitFor { await service.snapshot().loadedSpots == 1 }
        try await Task.sleep(for: .milliseconds(30))
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.connections.first?.phase, .connected)
        XCTAssertEqual(snapshot.spots.map(\.callsign), ["K1FRESH"])
    }

    func testEveryFilterDimensionAndVisibleLimitUseRealParsedSpots() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        let connection = TestClusterTransport()
        var config = ClusterSessionConfiguration(servers: [server], showWorkedBandModeSpots: true, maximumSpots: 1)
        let service = ClusterSessionService(configuration: config, transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        await service.replaceCountryCSV("K,United States,291,NA,5,8,40,100,-5,K N W;")
        await service.replaceContacts([ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291)])
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14025.0 K1AAA CW POTA K-1234")
        connection.emit("DX de K1SPT: 14026.0 K1OLD CW")
        connection.emit("DX de K2SPT-#: 7025.0 K1RBN CW RBN")
        connection.emit("DX de K1SPT: 14074.0 K1DIG FT8")
        try await waitFor { await service.snapshot().loadedSpots == 4 }
        let limited = await service.snapshot()
        XCTAssertEqual(limited.spots.count, 1)
        config.maximumSpots = 500
        try await service.configure(config)
        let expanded = await service.snapshot()
        XCTAssertEqual(expanded.spots.count, 4)
        XCTAssertFalse(connection.stopped)
        // A separate fixture keeps the filter assertions independent of the save regression.
        let filters = ClusterSessionService(configuration: .init(servers: [server],
            showWorkedBandModeSpots: true, maximumSpots: 500), transportFactory: { _, _, _, _, onState, onLine in
            connection.onState = onState
            connection.onLine = onLine
            return connection
        })
        await filters.replaceCountryCSV("K,United States,291,NA,5,8,40,100,-5,K N W;")
        await filters.replaceContacts([ClusterContact(callsign: "K1OLD", band: "20m", mode: "CW", adif: 291)])
        try await filters.connect()
        try await waitFor { await filters.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14025.0 K1AAA CW POTA K-1234")
        connection.emit("DX de K1SPT: 14026.0 K1OLD CW")
        connection.emit("DX de K2SPT-#: 7025.0 K1RBN CW RBN")
        connection.emit("DX de K1SPT: 14074.0 K1DIG FT8")
        try await waitFor { await filters.snapshot().loadedSpots == 4 }
        func matching(_ update: (inout ClusterSpotFilter) -> Void) async -> [ClassifiedClusterSpot] {
            var filter = ClusterSpotFilter()
            update(&filter)
            await filters.updateFilter(filter)
            return await filters.snapshot().spots
        }
        let byQuery = await matching { $0.query = "K1AAA" }
        XCTAssertEqual(byQuery.map(\.callsign), ["K1AAA"])
        let byBand = await matching { $0.bands = ["40m"] }
        XCTAssertEqual(byBand.map(\.callsign), ["K1RBN"])
        let byMode = await matching { $0.modes = ["FT8"] }
        XCTAssertEqual(byMode.map(\.callsign), ["K1DIG"])
        let byContinent = await matching { $0.continents = ["NA"] }
        XCTAssertEqual(byContinent.count, 4)
        let byCallStatus = await matching { $0.callStatuses = ["Worked"] }
        XCTAssertEqual(byCallStatus.map(\.callsign), ["K1OLD"])
        let byDXCC = await matching { $0.dxccStatuses = ["W/New Band", "W/New Mode"] }
        XCTAssertEqual(Set(byDXCC.map(\.callsign)), ["K1DIG", "K1RBN"])
        let bySpecial = await matching { $0.specials = ["POTA"] }
        XCTAssertEqual(bySpecial.map(\.callsign), ["K1AAA"])
        let byRBNSpecial = await matching { $0.specials = ["RBN"] }
        XCTAssertEqual(byRBNSpecial.map(\.callsign), ["K1RBN"])
        let withoutSpecial = await matching { $0.excludedSpecials = ["POTA"] }
        XCTAssertEqual(Set(withoutSpecial.map(\.callsign)), ["K1OLD", "K1RBN", "K1DIG"])
        let withoutRBN = await matching { $0.excludedSpecials = ["RBN"] }
        XCTAssertEqual(Set(withoutRBN.map(\.callsign)), ["K1AAA", "K1OLD", "K1DIG"])
        let bySource = await matching { $0.sources = ["rbl"] }
        XCTAssertEqual(bySource.map(\.callsign), ["K1RBN"])
        let byWorked = await matching { $0.worked = ["Worked before"] }
        XCTAssertEqual(byWorked.map(\.callsign), ["K1OLD"])
        let byFrequency = await matching { $0.sort = .frequency }
        XCTAssertEqual(byFrequency.first?.callsign, "K1RBN")
        let byCallsign = await matching { $0.sort = .callsign }
        XCTAssertEqual(byCallsign.first?.callsign, "K1AAA")
    }

    func testLegacyConfigurationDecodesOptInForwardingAsDisabled() throws {
        let original = ClusterSessionConfiguration(servers: [])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        object.removeValue(forKey: "commandPresets")
        object.removeValue(forKey: "forwardSpotsToFlex")
        object.removeValue(forKey: "radioSpotColorPolicy")
        object.removeValue(forKey: "hideWSPRSpots")
        object.removeValue(forKey: "connectOnStartup")
        object.removeValue(forKey: "requestRecentSpotsOnConnect")
        var legacyFilter = try XCTUnwrap(object["filter"] as? [String: Any])
        legacyFilter.removeValue(forKey: "excludedSpecials")
        object["filter"] = legacyFilter
        let decoded = try JSONDecoder().decode(ClusterSessionConfiguration.self,
            from: JSONSerialization.data(withJSONObject: object))
        XCTAssertFalse(decoded.forwardSpotsToFlex)
        XCTAssertEqual(decoded.radioSpotColorPolicy, .callsign)
        XCTAssertFalse(decoded.hideWSPRSpots)
        XCTAssertTrue(decoded.connectOnStartup)
        XCTAssertTrue(decoded.requestRecentSpotsOnConnect)
        XCTAssertTrue(decoded.filter.excludedSpecials.isEmpty)
        XCTAssertEqual(decoded.commandPresets.map(\.command),
                       ["sh/dx/50", "sh/mydx 50", "sh/wwv/5", "sh/wcy/5", "sh/ann/10", "sh/u"])
    }

    func testRadioSpotColorPolicyRoundTrips() throws {
        var config = ClusterSessionConfiguration(servers: [])
        config.radioSpotColorPolicy = .dxcc
        let decoded = try JSONDecoder().decode(ClusterSessionConfiguration.self, from: JSONEncoder().encode(config))
        XCTAssertEqual(decoded.radioSpotColorPolicy, .dxcc)
    }

    func testCoarseBetaThreeTaxonomyMigratesBackToOpportunityHierarchy() throws {
        let original = ClusterSessionConfiguration(servers: [])
        var object = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(original)) as? [String: Any])
        var palette = try XCTUnwrap(object["palette"] as? [String: Any])
        palette["status"] = ["New Callsign": "#010203", "New DXCC": "#CC372D",
                             "Worked": "#B0B0B0", "Confirmed": "#10B981", "Unknown": "#777F8C"]
        object["palette"] = palette
        var filter = try XCTUnwrap(object["filter"] as? [String: Any])
        filter["callStatuses"] = ["New Callsign", "Confirmed"]
        filter["dxccStatuses"] = ["New DXCC", "Worked"]
        object["filter"] = filter

        let decoded = try JSONDecoder().decode(ClusterSessionConfiguration.self,
            from: JSONSerialization.data(withJSONObject: object))
        for key in ["New Call", "New Band", "New Mode", "New Band+Mode"] {
            XCTAssertEqual(decoded.palette.status[key], "#010203")
            XCTAssertTrue(decoded.filter.callStatuses.contains(key))
        }
        XCTAssertEqual(decoded.palette.status["ATNO"], "#FF8C00")
        XCTAssertEqual(decoded.palette.status["Worked"], "#B0B0B0")
        XCTAssertEqual(decoded.palette.status["Confirmed"], "#10B981")
        XCTAssertTrue(decoded.filter.callStatuses.contains("Confirmed"))
        XCTAssertTrue(decoded.filter.dxccStatuses.isSuperset(of: ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode",
                                                               "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked"]))
    }

    func testForwardingEligibilityFollowsVisibleSnapshotAndConnectionGeneration() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        let connection = TestClusterTransport()
        let events = TestSpotEvents()
        var config = ClusterSessionConfiguration(servers: [server])
        config.filter.query = "K1VISIBLE"
        let service = ClusterSessionService(configuration: config,
            onSpot: { spot, generation in events.record(spot, generation: generation) },
            transportFactory: { _, _, _, _, onState, onLine in
                connection.onState = onState
                connection.onLine = onLine
                return connection
            })
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14025.0 K1HIDDEN CW")
        connection.emit("DX de K1SPT: 14026.0 K1VISIBLE CW")
        try await waitFor { events.all.count == 2 }
        let received = events.all
        let hidden = await service.isVisibleSpot(received[0].0, in: received[0].1)
        let visible = await service.isVisibleSpot(received[1].0, in: received[1].1)
        XCTAssertFalse(hidden)
        XCTAssertTrue(visible)
        await service.disconnect()
        let afterDisconnect = await service.isVisibleSpot(received[1].0, in: received[1].1)
        XCTAssertFalse(afterDisconnect)
    }

    func testHideWSPRSpotsExcludesExplicitReportsBeforeRetentionAndForwarding() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        let connection = TestClusterTransport()
        let events = TestSpotEvents()
        var config = ClusterSessionConfiguration(servers: [server], showWorkedBandModeSpots: true)
        config.hideWSPRSpots = true
        let service = ClusterSessionService(configuration: config,
            onSpot: { spot, generation in events.record(spot, generation: generation) },
            transportFactory: { _, _, _, _, onState, onLine in
                connection.onState = onState
                connection.onLine = onLine
                return connection
            })
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14095.6 K1WSPR -24 dB")
        connection.emit("DX de WSPRNET: 14095.6 K1HIDDEN WSPR -24 dB")
        connection.emit("DX de K1SPT: 14096.0 4U1UN -24 dB 5000 km")
        try await waitFor { await service.snapshot().loadedSpots == 2 }
        let snapshot = await service.snapshot()
        XCTAssertEqual(Set(snapshot.spots.map(\.callsign)), Set(["K1WSPR", "4U1UN"]))
        XCTAssertEqual(events.all.count, 2)
    }

    func testEnablingHideWSPRSpotsPurgesRetainedReports() async throws {
        let server = ClusterServerConfiguration(name: "Fixture", host: "example.invalid", port: 7300, callsign: "OM0RX")
        let connection = TestClusterTransport()
        var config = ClusterSessionConfiguration(servers: [server], showWorkedBandModeSpots: true)
        let service = ClusterSessionService(configuration: config,
            transportFactory: { _, _, _, _, onState, onLine in
                connection.onState = onState
                connection.onLine = onLine
                return connection
            })
        try await service.connect()
        try await waitFor { await service.snapshot().connectedClusters == 1 }
        connection.emit("DX de K1SPT: 14095.6 K1WSPR WSPR -24 dB")
        connection.emit("DX de K1SPT: 14096.0 4U1UN -24 dB")
        try await waitFor { await service.snapshot().loadedSpots == 2 }
        config.hideWSPRSpots = true
        try await service.configure(config)
        let snapshot = await service.snapshot()
        XCTAssertEqual(snapshot.loadedSpots, 1)
        XCTAssertEqual(snapshot.spots.map(\.callsign), ["4U1UN"])
    }
}
