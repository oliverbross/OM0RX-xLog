import Foundation
import XCWCore

/// Synchronous transport callbacks must reach the actor in wire order. Separate
/// unstructured Tasks can otherwise reorder a disconnect or consecutive spots.
private final class ClusterEventSequence: @unchecked Sendable {
    private let lock = NSLock()
    private var tail: Task<Void, Never>?
    func submit(_ operation: @escaping @Sendable () async -> Void) {
        lock.withLock {
            let previous = tail
            tail = Task { await previous?.value; await operation() }
        }
    }
}

/// The live session uses xCluster's parser, opportunity rules and table semantics.
/// No endpoint, credential, contact or country is invented by this module.
public struct ClusterServerConfiguration: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var host: String
    public var port: Int
    public var callsign: String
    public var enabled: Bool

    public init(id: UUID = UUID(), name: String, host: String, port: Int, callsign: String, enabled: Bool = true) {
        self.id = id
        self.name = name
        self.host = host
        self.port = port
        self.callsign = callsign
        self.enabled = enabled
    }
}

public enum ClusterSpotSort: String, Codable, CaseIterable, Sendable {
    case newest, score, frequency, callsign
}

public struct ClusterCommandPreset: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var name: String
    public var command: String

    public init(id: UUID = UUID(), name: String, command: String) {
        self.id = id
        self.name = name
        self.command = command
    }
}

/// Empty categorical sets mean all values, except sources, where an empty set hides all sources.
public struct ClusterSpotFilter: Codable, Equatable, Sendable {
    public var query = ""
    public var bands: Set<String> = []
    public var modes: Set<String> = []
    public var continents: Set<String> = []
    public var spotterContinents: Set<String> = []
    public var callStatuses: Set<String> = []
    public var dxccStatuses: Set<String> = []
    public var specials: Set<String> = []
    public var excludedSpecials: Set<String> = []
    public var sources: Set<String> = ["cluster", "rbl", "local_cw"]
    public var worked: Set<String> = []
    public var sort: ClusterSpotSort = .newest

    public init() {}

    private enum CodingKeys: String, CodingKey {
        case query, bands, modes, continents, spotterContinents, callStatuses, dxccStatuses, specials, excludedSpecials, sources, worked, sort
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        query = try values.decodeIfPresent(String.self, forKey: .query) ?? ""
        bands = try values.decodeIfPresent(Set<String>.self, forKey: .bands) ?? []
        modes = try values.decodeIfPresent(Set<String>.self, forKey: .modes) ?? []
        continents = try values.decodeIfPresent(Set<String>.self, forKey: .continents) ?? []
        spotterContinents = try values.decodeIfPresent(Set<String>.self, forKey: .spotterContinents) ?? []
        callStatuses = try values.decodeIfPresent(Set<String>.self, forKey: .callStatuses) ?? []
        dxccStatuses = try values.decodeIfPresent(Set<String>.self, forKey: .dxccStatuses) ?? []
        specials = try values.decodeIfPresent(Set<String>.self, forKey: .specials) ?? []
        excludedSpecials = try values.decodeIfPresent(Set<String>.self, forKey: .excludedSpecials) ?? []
        sources = try values.decodeIfPresent(Set<String>.self, forKey: .sources) ?? ["cluster", "rbl", "local_cw"]
        worked = try values.decodeIfPresent(Set<String>.self, forKey: .worked) ?? []
        sort = try values.decodeIfPresent(ClusterSpotSort.self, forKey: .sort) ?? .newest
    }
}

public struct ClusterPalette: Codable, Equatable, Sendable {
    public var status: [String: String]
    public var band: [String: String]
    public var mode: [String: String]

    public static let originalDefaults = ClusterPalette(
        status: ["New Call": "#FF6B35", "New Band": "#00BFFF", "New Mode": "#FFC000",
                 "New Band+Mode": "#E91E63", "ATNO": "#FF8C00", "C/New Band": "#4A9EFF",
                 "C/New Mode": "#FFD93D", "C/New Band+Mode": "#9C27B0", "W/New Band": "#00BCD4",
                 "W/New Mode": "#FFA726", "W/New Band+Mode": "#FF5722", "Worked": "#B0B0B0",
                 "Confirmed": "#10B981", "Unknown": "#777F8C"],
        band: ["160m": "#B794F4", "80m": "#A78BFA", "60m": "#818CF8", "40m": "#4A9EFF",
               "30m": "#22D3EE", "20m": "#12D6A0", "17m": "#4ADE80", "15m": "#F3B23C",
               "12m": "#FB923C", "10m": "#FF6B5E", "6m": "#F472B6", "2m": "#E879F9",
               "70cm": "#C084FC", "Unknown": "#B0B0B0"],
        mode: ["CW": "#F3B23C", "SSB": "#35C8F5", "AM": "#FFD166", "FM": "#4A9EFF",
               "RTTY": "#FB923C", "JTTY": "#F97316", "FT8": "#A78BFA", "FT4": "#F472B6", "FT2": "#E879F9",
               "PSK": "#4ADE80", "OLIVIA": "#2DD4BF", "JT65": "#818CF8", "JT9": "#60A5FA",
               "HELL": "#F59E0B", "MFSK": "#34D399", "SSTV": "#F87171", "DIGI": "#8B9CFF",
               "Unknown": "#B0B0B0"]
    )

    public init(status: [String: String] = [:], band: [String: String] = [:], mode: [String: String] = [:]) {
        self.status = status
        self.band = band
        self.mode = mode
    }

    static func opportunityHierarchyRestored(_ stored: ClusterPalette) -> ClusterPalette {
        var status = Self.originalDefaults.status
        for key in status.keys where stored.status[key] != nil {
            status[key] = stored.status[key]
        }
        // Preserve operator customisations made while beta.3 exposed only two
        // coarse "new" colours, without replacing the richer default palette.
        if let call = stored.status["New Callsign"], call.caseInsensitiveCompare("#CC372D") != .orderedSame {
            for key in ["New Call", "New Band", "New Mode", "New Band+Mode"] where stored.status[key] == nil {
                status[key] = call
            }
        }
        if let dxcc = stored.status["New DXCC"], dxcc.caseInsensitiveCompare("#CC372D") != .orderedSame {
            for key in ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode",
                        "W/New Band", "W/New Mode", "W/New Band+Mode"] where stored.status[key] == nil {
                status[key] = dxcc
            }
        }
        return ClusterPalette(status: status, band: stored.band, mode: stored.mode)
    }
}

public struct ClusterSessionConfiguration: Codable, Sendable {
    public enum RadioSpotColorPolicy: String, Codable, Sendable { case callsign, dxcc }
    public static let originalSpecialRules: [SpecialRule] = [
        .init(name: "POTA", keywords: ["POTA"], referenceFormat: .pota),
        .init(name: "SOTA", keywords: ["SOTA"], referenceFormat: .sota),
        .init(name: "IOTA", keywords: ["IOTA"], referenceFormat: .iota),
        .init(name: "WWFF", keywords: ["WWFF"], referenceFormat: .wwff),
        .init(name: "BUNKER", keywords: ["WWBOTA", "UKBOTA", "BUNKER ON THE AIR", "BUNKERS ON THE AIR"], referenceFormat: .bunker),
        .init(name: "CASTLE", keywords: ["WCA", "CASTLE"], referenceFormat: .castle),
        .init(name: "LIGHTHOUSE", keywords: ["LIGHTHOUSE", "ARLHS", "ILLW"]),
        .init(name: "CONTEST", keywords: ["CONTEST"]),
        .init(name: "IARU", keywords: ["IARU"]),
    ]

    public var servers: [ClusterServerConfiguration]
    public var connectOnStartup: Bool
    public var requestRecentSpotsOnConnect: Bool
    public var reconnect: Bool
    public var requestSkimmer: Bool
    public var showWorkedBandModeSpots: Bool
    public var hideWSPRSpots: Bool
    public var maximumSpots: Int
    public var specialRules: [SpecialRule]
    public var palette: ClusterPalette
    public var filter: ClusterSpotFilter
    public var commandPresets: [ClusterCommandPreset]
    /// Explicit opt-ins for radio-display spot output transports.
    public var forwardSpotsToFlex: Bool
    public var forwardSpotsToTCI: Bool
    public var radioSpotColorPolicy: RadioSpotColorPolicy

    public init(servers: [ClusterServerConfiguration], connectOnStartup: Bool = true,
                requestRecentSpotsOnConnect: Bool = true, reconnect: Bool = true, requestSkimmer: Bool = true,
                showWorkedBandModeSpots: Bool = false, hideWSPRSpots: Bool = false, maximumSpots: Int = 200,
                specialRules: [SpecialRule] = originalSpecialRules, palette: ClusterPalette = .originalDefaults,
                filter: ClusterSpotFilter = .init(),
                commandPresets: [ClusterCommandPreset] = [
                    .init(name: "Recent DX", command: "sh/dx/50"),
                    .init(name: "My DX", command: "sh/mydx 50"),
                    .init(name: "WWV", command: "sh/wwv/5"),
                    .init(name: "WCY", command: "sh/wcy/5"),
                    .init(name: "Announcements", command: "sh/ann/10"),
                    .init(name: "Users", command: "sh/u")
                ], forwardSpotsToFlex: Bool = false, forwardSpotsToTCI: Bool = false,
                radioSpotColorPolicy: RadioSpotColorPolicy = .callsign) {
        self.servers = servers
        self.connectOnStartup = connectOnStartup
        self.requestRecentSpotsOnConnect = requestRecentSpotsOnConnect
        self.reconnect = reconnect
        self.requestSkimmer = requestSkimmer
        self.showWorkedBandModeSpots = showWorkedBandModeSpots
        self.hideWSPRSpots = hideWSPRSpots
        self.maximumSpots = maximumSpots
        self.specialRules = specialRules
        self.palette = palette
        self.filter = filter
        self.commandPresets = commandPresets
        self.forwardSpotsToFlex = forwardSpotsToFlex
        self.forwardSpotsToTCI = forwardSpotsToTCI
        self.radioSpotColorPolicy = radioSpotColorPolicy
    }

    private enum CodingKeys: String, CodingKey {
        case servers, connectOnStartup, requestRecentSpotsOnConnect, reconnect, requestSkimmer
        case showWorkedBandModeSpots, hideWSPRSpots, maximumSpots
        case specialRules, palette, filter, commandPresets, forwardSpotsToFlex, forwardSpotsToTCI, radioSpotColorPolicy
    }

    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        servers = try values.decode([ClusterServerConfiguration].self, forKey: .servers)
        connectOnStartup = try values.decodeIfPresent(Bool.self, forKey: .connectOnStartup) ?? true
        requestRecentSpotsOnConnect = try values.decodeIfPresent(Bool.self, forKey: .requestRecentSpotsOnConnect) ?? true
        reconnect = try values.decode(Bool.self, forKey: .reconnect)
        requestSkimmer = try values.decode(Bool.self, forKey: .requestSkimmer)
        showWorkedBandModeSpots = try values.decode(Bool.self, forKey: .showWorkedBandModeSpots)
        hideWSPRSpots = try values.decodeIfPresent(Bool.self, forKey: .hideWSPRSpots) ?? false
        maximumSpots = try values.decode(Int.self, forKey: .maximumSpots)
        specialRules = try values.decode([SpecialRule].self, forKey: .specialRules)
        palette = ClusterPalette.opportunityHierarchyRestored(try values.decode(ClusterPalette.self, forKey: .palette))
        filter = try values.decode(ClusterSpotFilter.self, forKey: .filter)
        if filter.callStatuses.remove("New Callsign") != nil {
            filter.callStatuses.formUnion(["New Call", "New Band", "New Mode", "New Band+Mode"])
        }
        if filter.dxccStatuses.remove("New DXCC") != nil {
            filter.dxccStatuses.formUnion(["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode",
                                           "W/New Band", "W/New Mode", "W/New Band+Mode"])
        }
        commandPresets = try values.decodeIfPresent([ClusterCommandPreset].self, forKey: .commandPresets)
            ?? Self(servers: []).commandPresets
        forwardSpotsToFlex = try values.decodeIfPresent(Bool.self, forKey: .forwardSpotsToFlex) ?? false
        forwardSpotsToTCI = try values.decodeIfPresent(Bool.self, forKey: .forwardSpotsToTCI) ?? false
        radioSpotColorPolicy = try values.decodeIfPresent(RadioSpotColorPolicy.self, forKey: .radioSpotColorPolicy) ?? .callsign
    }
}

public enum ClusterConnectionPhase: String, Codable, Sendable {
    case disconnected, connecting, connected, failed
}

public struct ClusterConnectionStatus: Codable, Sendable {
    public var serverID: UUID
    public var serverName: String
    public var phase: ClusterConnectionPhase
    public var error: String?
}

public struct ClusterConsoleEntry: Codable, Sendable {
    public var receivedAt: Date
    public var source: String
    public var text: String
    public var isCommand: Bool
}

public struct ClassifiedClusterSpot: Codable, Hashable, Identifiable, Sendable {
    public var id: UUID
    public var receivedAt: Date
    public var clusterName: String
    public var spotter: String
    public var spotterContinent: String? = nil
    public var frequencyKHz: Double
    public var frequencyText: String
    public var callsign: String
    public var comment: String
    public var band: String
    public var mode: String
    public var country: String
    public var adif: Int?
    public var continent: String
    public var cqZone: Int?
    public var ituZone: Int?
    public var latitude: Double?
    public var longitude: Double?
    public var callStatus: String
    public var dxccStatus: String
    public var workedBefore: Date?
    public var specialTags: [String]
    public var score: Int
    public var scoreReasons: [String]
    public var aggregateCount: Int
    public var aggregateSpotters: [String]
    public var source: String
    public var statusHex: String
    public var bandHex: String
    public var modeHex: String
    public var localCW: CWConfirmedSpot? = nil

    /// Refresh only the live derived mode. Historical observations retain the
    /// classification captured when they were received.
    @discardableResult
    mutating func refreshInferredMode(palette: ClusterPalette) -> Bool {
        guard localCW==nil else {return false}
        let inferred = SpotLogic.mode(comment: comment, band: band, khz: frequencyKHz)
        guard inferred != mode else { return false }
        mode = inferred
        modeHex = palette.mode[inferred] ?? "#B0B0B0"
        return true
    }
}

public struct ClusterSessionSnapshot: Codable, Sendable {
    public var generatedAt: Date
    public var connectedClusters: Int
    public var loadedSpots: Int
    public var contactCount: Int
    public var contactRevision: Int
    public var logbookDataLoaded: Bool
    public var countryDataLoaded: Bool
    public var connections: [ClusterConnectionStatus]
    public var spots: [ClassifiedClusterSpot]
    public var console: [ClusterConsoleEntry]
}

public enum ClusterSessionError: Error, LocalizedError, Sendable {
    case invalidConfiguration(String)
    case notConnected
    case unsupportedTransport
    case terminated

    public var errorDescription: String? {
        switch self {
        case .invalidConfiguration(let reason): return reason
        case .notConnected: return "No selected cluster is connected."
        case .unsupportedTransport: return "Live cluster TCP transport is not available on this platform."
        case .terminated: return "The cluster session has shut down."
        }
    }
}

/// Transport injection keeps the session, classification and UI contract portable.
/// The production macOS transport is in ClusterTCPTransport.swift.
public protocol ClusterConnectionTransport: AnyObject, Sendable {
    func start()
    func send(_ command: String)
    func stop()
    func updateOptions(reconnect: Bool, requestSkimmer: Bool)
}

public extension ClusterConnectionTransport {
    func updateOptions(reconnect: Bool, requestSkimmer: Bool) {}
}

public typealias ClusterTransportFactory = @Sendable (
    _ server: ClusterServerConfiguration, _ password: String, _ reconnect: Bool, _ requestSkimmer: Bool,
    _ onState: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
    _ onLine: @escaping @Sendable (String) -> Void
) -> any ClusterConnectionTransport

public actor ClusterSessionService {
    private struct ObservationOrigin {
        let id: UUID
        let name: String
        let host: String
        let port: Int
        let local: Bool
        init(server: ClusterServerConfiguration) {
            id=server.id;name=server.name;host=server.host;port=server.port;local=false
        }
        init(local spot: CWConfirmedSpot) {
            id=spot.originInstanceID;name="Local CW";host="";port=0;local=true
        }
    }
    private struct HistorySegment {
        let id = UUID()
        let origin: ObservationOrigin
        let generation: UUID
        var sequence: Int64 = 0
    }
    private var configuration: ClusterSessionConfiguration
    private var contacts = ClusterClassificationIndex.empty
    private var countries = ClusterCountryDirectory.empty
    private var spots: [ClassifiedClusterSpot] = []
    private var statuses: [UUID: ClusterConnectionStatus] = [:]
    private var console: [ClusterConsoleEntry] = []
    private var transports: [UUID: any ClusterConnectionTransport] = [:]
    /// Invalidates callbacks queued by an earlier socket, including a reconnect to the same server ID.
    private var connectionGeneration = UUID()
    private var transportGenerations: [UUID: UUID] = [:]
    private var historySegments: [UUID: HistorySegment] = [:]
    private var localSpotIDs: [(UUID,Date)] = []
    private var contactCounts: [String: Int] = [:]
    private var contactRevision = 0
    private var contactPublicationRevision: UInt64 = 0
    private var hasContactSnapshot = false
    private var terminated = false
    private let endpointOwner=UUID()
    private let transportFactory: ClusterTransportFactory
    private let onUpdate: (@Sendable (ClusterSessionSnapshot) -> Void)?
    private let onSpot: (@Sendable (ClassifiedClusterSpot, UUID) -> Void)?
    /// Synchronous admission sinks must return promptly; the host owns bounded storage.
    private let onObservation: (@Sendable (ClusterSpotObservation) -> Void)?
    private let onHistoryConnection: (@Sendable (ClusterHistoryConnectionEvent) -> Void)?

    public init(configuration: ClusterSessionConfiguration, onUpdate: (@Sendable (ClusterSessionSnapshot) -> Void)? = nil,
                onSpot: (@Sendable (ClassifiedClusterSpot, UUID) -> Void)? = nil,
                onObservation: (@Sendable (ClusterSpotObservation) -> Void)? = nil,
                onHistoryConnection: (@Sendable (ClusterHistoryConnectionEvent) -> Void)? = nil,
                transportFactory: @escaping ClusterTransportFactory = { server, password, reconnect, requestSkimmer, onState, onLine in
                    makeClusterTCPTransport(server: server, password: password, reconnect: reconnect,
                                            requestSkimmer: requestSkimmer, onState: onState, onLine: onLine)
                }) {
        self.configuration = configuration
        self.onUpdate = onUpdate
        self.onSpot = onSpot
        self.onObservation = onObservation
        self.onHistoryConnection = onHistoryConnection
        self.transportFactory = transportFactory
    }
    deinit {CWLocalEndpointGuard.shared.removeInbound(owner:endpointOwner)}

    /// Display edits never disturb sockets or received history. Resolve credentials
    /// only for replacement connections, before touching any running transport.
    public func configure(_ value: ClusterSessionConfiguration,
                          password: @Sendable (UUID) throws -> String = { _ in "" }) throws {
        guard !terminated else { throw ClusterSessionError.terminated }
        try validate(value)
        try guardGeneratedEndpoint(value)
        let wasRunning = !transports.isEmpty
        let enabled = value.servers.filter(\.enabled)
        let retained = Set(enabled.compactMap { next -> UUID? in
            guard transports[next.id] != nil,
                  let previous = configuration.servers.first(where: { $0.id == next.id }),
                  previous.host.lowercased() == next.host.lowercased(), previous.port == next.port,
                  previous.callsign.uppercased() == next.callsign.uppercased() else { return nil }
            return next.id
        })
        let replacements = wasRunning ? enabled.filter { !retained.contains($0.id) } : []
        var passwords: [UUID: String] = [:]
        for server in replacements {
            let secret = try password(server.id)
            try validatePassword(secret)
            passwords[server.id] = secret
        }
        let removed = Set(transports.keys).subtracting(retained)
        if !removed.isEmpty || !replacements.isEmpty { connectionGeneration = UUID() }
        for id in removed {
            closeHistorySegment(serverID: id, at: Date(), phase: .disconnected)
            transportGenerations.removeValue(forKey: id)
            transports.removeValue(forKey: id)?.stop()
        }
        let optionsChanged = configuration.reconnect != value.reconnect
            || configuration.requestSkimmer != value.requestSkimmer
        configuration = value
        if value.hideWSPRSpots {
            spots.removeAll { SpotLogic.isWSPR(clusterName: $0.clusterName, spotter: $0.spotter, comment: $0.comment) }
        }
        statuses = statuses.filter { retained.contains($0.key) }
        for server in enabled where retained.contains(server.id) {
            statuses[server.id]?.serverName = server.name
            if optionsChanged {
                transports[server.id]?.updateOptions(reconnect: value.reconnect, requestSkimmer: value.requestSkimmer)
            }
        }
        for server in replacements { start(server, password: passwords[server.id] ?? "") }
        reclassify()
    }

    /// Credentials are supplied by the host's secure store for this connection only.
    /// They are absent from configuration, snapshots, transcript and diagnostics.
    public func connect(passwords: [UUID: String] = [:]) throws {
        guard !terminated else { throw ClusterSessionError.terminated }
        let enabled = configuration.servers.filter(\.enabled)
        guard !enabled.isEmpty else { throw ClusterSessionError.invalidConfiguration("Configure and enable a cluster server first.") }
        guard transports.isEmpty else { return }
        try validate(configuration)
        try guardGeneratedEndpoint(configuration)
        for server in enabled { try validatePassword(passwords[server.id] ?? "") }
        connectionGeneration = UUID()
        for server in enabled { start(server, password: passwords[server.id] ?? "") }
        publish()
    }

    private func validate(_ value: ClusterSessionConfiguration) throws {
        let enabled = value.servers.filter(\.enabled)
        for server in enabled {
            guard !server.name.isEmpty, !server.host.isEmpty, server.port > 0, server.port <= 65_535,
                  !server.host.contains(where: { $0.isWhitespace || $0.isNewline }),
                  !server.host.unicodeScalars.contains(where: { $0.value < 0x20 || $0.value == 0x7f }),
                  server.callsign.range(of: #"^[A-Za-z0-9/\-]{2,24}$"#, options: .regularExpression) != nil else {
                throw ClusterSessionError.invalidConfiguration("Invalid name, host, port or login callsign for a cluster server.")
            }
        }
        guard Set(enabled.map(\.id)).count == enabled.count else {
            throw ClusterSessionError.invalidConfiguration("Cluster server IDs must be unique.")
        }
    }

    private func guardGeneratedEndpoint(_ value:ClusterSessionConfiguration) throws {
        do {
            try CWLocalEndpointGuard.shared.setInbound(owner:endpointOwner,
                endpoints:value.servers.filter(\.enabled).map{CWInboundEndpoint(host:$0.host,port:$0.port)})
        } catch {
            throw ClusterSessionError.invalidConfiguration("The generated Local CW endpoint cannot be an inbound cluster source.")
        }
    }
    public func prepareLocalCWListener() throws {
        guard !terminated else {throw ClusterSessionError.terminated}
        try guardGeneratedEndpoint(configuration)
    }

    private func validatePassword(_ password: String) throws {
        if password.utf8.count > 256 || password.contains("\r") || password.contains("\n") {
            throw ClusterSessionError.invalidConfiguration("Cluster password contains an invalid line break or is too long.")
        }
    }

    private func start(_ server: ClusterServerConfiguration, password: String) {
        let generation = UUID()
        transportGenerations[server.id] = generation
        let events = ClusterEventSequence()
        let transport = transportFactory(server, password, configuration.reconnect,
                                         configuration.requestSkimmer, { [weak self] phase, error in
            let arrivedAt = Date()
            events.submit { [weak self] in await self?.receiveState(serverID: server.id, generation: generation, phase: phase, error: error, arrivedAt: arrivedAt) }
        }, { [weak self] line in
            let arrivedAt = Date()
            events.submit { [weak self] in await self?.receiveLine(line, serverID: server.id, generation: generation, arrivedAt: arrivedAt) }
        })
        transports[server.id] = transport
        statuses[server.id] = .init(serverID: server.id, serverName: server.name, phase: .connecting, error: nil)
        transport.start()
    }

    public func disconnect() {
        connectionGeneration = UUID()
        let stoppedAt = Date()
        for (id,segment) in historySegments where !segment.origin.local || terminated {
            closeHistorySegment(serverID: id, at: stoppedAt, phase: .disconnected)
        }
        transportGenerations.removeAll()
        for transport in transports.values { transport.stop() }
        transports.removeAll()
        for id in statuses.keys { statuses[id]?.phase = .disconnected; statuses[id]?.error = nil }
        publish()
    }

    /// Unlike an operator disconnect, terminal shutdown cannot be undone by an
    /// already queued connect request on a different actor.
    public func terminate() {
        terminated = true
        disconnect()
        CWLocalEndpointGuard.shared.removeInbound(owner:endpointOwner)
    }

    @discardableResult
    public func replaceContacts(_ records: [ClusterContact], publicationRevision: UInt64? = nil) -> Bool {
        // A retired worker projection may already be queued on this actor.
        guard !terminated, !Task.isCancelled else { return false }
        if let publicationRevision {
            guard publicationRevision >= contactPublicationRevision else { return false }
            contactPublicationRevision = publicationRevision
        }
        var nextCounts: [String: Int] = [:]
        for record in records {
            nextCounts[record.callsign.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(), default: 0] += 1
        }
        if hasContactSnapshot {
            let newlyLogged = Set(nextCounts.compactMap { call, count in
                count > (contactCounts[call] ?? 0) ? call : nil
            })
            if !newlyLogged.isEmpty { spots.removeAll { newlyLogged.contains($0.callsign) } }
        }
        contactCounts = nextCounts
        contactRevision &+= 1
        hasContactSnapshot = true
        contacts = ClusterClassificationIndex(records: records)
        reclassify()
        return true
    }

    public func invalidateContacts(publicationRevision: UInt64? = nil) {
        guard !terminated else { return }
        if let publicationRevision {
            guard publicationRevision >= contactPublicationRevision else { return }
            contactPublicationRevision = publicationRevision
        }
        contacts = .empty
        contactCounts.removeAll()
        contactRevision &+= 1
        hasContactSnapshot = false
        reclassify()
    }

    /// The host loads an authoritative CTY CSV; unresolved entities remain Unknown.
    public func replaceCountryCSV(_ text: String) {
        countries = ClusterCountryDirectory(csv: text)
        reclassify()
    }

    public func updateFilter(_ value: ClusterSpotFilter) {
        configuration.filter = value
        publish()
    }

    public func clearConsole() {
        console.removeAll()
        publish()
    }

    public func sendCommand(_ input: String, to serverID: UUID? = nil) throws {
        let command = input.replacingOccurrences(of: "\r", with: " ").replacingOccurrences(of: "\n", with: " ")
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !command.isEmpty, command.utf8.count <= 160,
              command.unicodeScalars.allSatisfy({ $0.value >= 0x20 && $0.value <= 0x7e }) else {
            throw ClusterSessionError.invalidConfiguration("Cluster command must contain 1–160 bytes.")
        }
        let targets = statuses.values.filter { $0.phase == .connected && (serverID == nil || $0.serverID == serverID) }
        guard !targets.isEmpty else { throw ClusterSessionError.notConnected }
        // Console commands can contain secrets. Never echo their content into the transcript.
        for target in targets { transports[target.serverID]?.send(command) }
        appendConsole(source: targets.count == 1 ? targets[0].serverName : "All connected", text: "Command sent", isCommand: true)
        publish()
    }

    public func snapshot() -> ClusterSessionSnapshot {
        // A worker can outlive a renderer/package replacement. Repair stale
        // in-memory derived modes before either normal xLog or Contest Cluster
        // filters and displays the shared projection.
        for index in spots.indices where spots[index].refreshInferredMode(palette: configuration.palette) {
            reclassifySpot(at: index)
        }
        let filter = configuration.filter
        var visible = spots.filter { spot in
            (filter.query.isEmpty || spot.callsign.localizedCaseInsensitiveContains(filter.query)
                || spot.country.localizedCaseInsensitiveContains(filter.query)
                || spot.comment.localizedCaseInsensitiveContains(filter.query))
                && (filter.bands.isEmpty || filter.bands.contains(spot.band))
                && (filter.modes.isEmpty || filter.modes.contains(spot.mode))
                && (filter.continents.isEmpty || filter.continents.contains(spot.continent))
                && (filter.spotterContinents.isEmpty || filter.spotterContinents.contains(spot.spotterContinent ?? ""))
                && (filter.callStatuses.isEmpty || filter.callStatuses.contains(spot.callStatus))
                && (filter.dxccStatuses.isEmpty || filter.dxccStatuses.contains(spot.dxccStatus))
                && (filter.specials.isEmpty || !filter.specials.isDisjoint(with: spot.specialTags))
                && filter.excludedSpecials.isDisjoint(with: spot.specialTags)
                && filter.sources.contains(spot.source)
                && SpotLogic.shouldShow(callStatus: spot.callStatus, showWorkedBandModeSpots: configuration.showWorkedBandModeSpots)
                && (filter.worked.isEmpty || filter.worked.contains(spot.workedBefore == nil ? "Not worked" : "Worked before"))
        }
        switch filter.sort {
        case .newest: visible.sort { $0.receivedAt > $1.receivedAt }
        case .score: visible.sort { $0.score == $1.score ? $0.receivedAt > $1.receivedAt : $0.score > $1.score }
        case .frequency: visible.sort { $0.frequencyKHz < $1.frequencyKHz }
        case .callsign: visible.sort { $0.callsign < $1.callsign }
        }
        return ClusterSessionSnapshot(generatedAt: Date(), connectedClusters: statuses.values.filter { $0.phase == .connected }.count,
                                      loadedSpots: spots.count, contactCount: contacts.recordCount,
                                      contactRevision: contactRevision,
                                      logbookDataLoaded: hasContactSnapshot,
                                      countryDataLoaded: !countries.isEmpty,
                                      connections: statuses.values.sorted { $0.serverName < $1.serverName },
                                      spots: Array(visible.prefix(max(1, min(configuration.maximumSpots, 500)))), console: console)
    }

    /// Contest windows share the live cluster transport and classified spot store,
    /// but must not inherit the normal logbook's display filters. The contest
    /// workspace applies its own configured band, mode, age, worked and multiplier
    /// rules to this bounded newest-first projection.
    public func contestSpots(limit: Int = 500) -> [ClassifiedClusterSpot] {
        for index in spots.indices where spots[index].refreshInferredMode(palette: configuration.palette) {
            reclassifySpot(at: index)
        }
        return Array(spots.sorted { $0.receivedAt > $1.receivedAt }
            .prefix(max(1, min(limit, 500))))
    }

    /// FLEX forwarding follows the exact currently visible filtered/sorted/max-count snapshot.
    public func isVisibleSpot(_ spotID: UUID, in generation: UUID) -> Bool {
        generation == connectionGeneration && statuses.values.contains(where: { $0.phase == .connected })
            && snapshot().spots.contains(where: { $0.id == spotID })
    }

    private func receiveState(serverID: UUID, generation: UUID, phase: ClusterConnectionPhase, error: String?, arrivedAt: Date) {
        guard generation == transportGenerations[serverID], transports[serverID] != nil else { return }
        let becameConnected = phase == .connected && statuses[serverID]?.phase != .connected
        if becameConnected,
           let server = configuration.servers.first(where: { $0.id == serverID }) {
            closeHistorySegment(serverID: serverID, at: arrivedAt, phase: .disconnected)
            openHistorySegment(server: server, generation: generation, at: arrivedAt, phase: .connected)
        } else if phase != .connected {
            closeHistorySegment(serverID: serverID, at: arrivedAt, phase: phase)
        }
        statuses[serverID]?.phase = phase
        statuses[serverID]?.error = error
        if becameConnected, configuration.requestRecentSpotsOnConnect {
            transports[serverID]?.send("sh/dx/100")
            appendConsole(source: statuses[serverID]?.serverName ?? "Cluster",
                          text: "Requested 100 recent DX spots", isCommand: true)
        }
        publish()
    }

    private func receiveLine(_ line: String, serverID: UUID, generation: UUID, arrivedAt: Date) {
        guard generation == transportGenerations[serverID], transports[serverID] != nil,
              let server = configuration.servers.first(where: { $0.id == serverID }) else { return }
        if CWLocalEndpointGuard.shared.isOwnGreeting(line) {
            transportGenerations.removeValue(forKey:serverID)
            transports.removeValue(forKey:serverID)?.stop()
            closeHistorySegment(serverID:serverID,at:arrivedAt,phase:.failed)
            statuses[serverID]?.phase = .failed
            statuses[serverID]?.error = "Local CW self-loop rejected. Choose an external cluster source."
            publish();return
        }
        guard line.utf8.count <= ClusterLineParser.maximumLineBytes else { return }
        if let raw = ClusterLineParser.parse(line, clusterID: serverID, clusterName: server.name, at: arrivedAt) {
            addSpot(raw, line: line, origin: ObservationOrigin(server:server), generation: generation, arrivedAt: arrivedAt)
        } else {
            appendConsole(source: server.name, text: line, isCommand: false)
        }
        publish()
    }

    /// Trusted native admission only; no renderer or network command accepts a
    /// CWConfirmedSpot. The source owner rechecks its capture before calling.
    @discardableResult
    public func ingestLocalCW(_ value: CWConfirmedSpot,stationCallsign:String,arrivedAt:Date=Date()) throws -> Bool {
        guard !terminated else {throw ClusterSessionError.terminated}
        try value.validateProvenance()
        guard arrivedAt.timeIntervalSince(value.observedAt)>=0,arrivedAt.timeIntervalSince(value.observedAt)<=120 else {return false}
        let line=try CWSpotWire.line(value,stationCallsign:stationCallsign)
        localSpotIDs.removeAll{arrivedAt.timeIntervalSince($0.1)>900}
        guard !localSpotIDs.contains(where:{$0.0==value.id}) else {return false}
        if localSpotIDs.count>=4096 {localSpotIDs.removeFirst()}
        localSpotIDs.append((value.id,arrivedAt))
        let origin=ObservationOrigin(local:value)
        let raw=RawSpot(clusterID:origin.id,clusterName:origin.name,spotter:try CWSpotWire.reporter(stationCallsign),
            frequencyKHz:Double(value.frequencyHz)/1000,frequencyText:String(format:"%.3f",locale:Locale(identifier:"en_US_POSIX"),Double(value.frequencyHz)/1000),
            callsign:value.callsign,comment:"CW Local",receivedAt:value.observedAt)
        if let previous=historySegments[origin.id],previous.generation != value.sessionID {
            closeHistorySegment(serverID:origin.id,at:arrivedAt,phase:.disconnected)
        }
        addSpot(raw,line:line,origin:origin,generation:value.sessionID,arrivedAt:arrivedAt,localCW:value)
        publish();return true
    }

    private func addSpot(_ raw: RawSpot, line: String, origin: ObservationOrigin, generation: UUID, arrivedAt: Date,localCW:CWConfirmedSpot?=nil) {
        guard raw.callsign.utf8.count <= 32, raw.spotter.utf8.count <= 64 else { return }
        guard !configuration.hideWSPRSpots
                || !SpotLogic.isWSPR(clusterName: raw.clusterName, spotter: raw.spotter, comment: raw.comment) else { return }
        let country = countries.resolve(raw.callsign)
        let spotterCountry = countries.resolve(raw.spotter)
        let band = SpotLogic.band(for: raw.frequencyKHz)
        let mode = localCW==nil ? SpotLogic.mode(comment: raw.comment, band: band, khz: raw.frequencyKHz):"CW"
        let classification = classify(call: raw.callsign, band: band, mode: mode, adif: country?.adif)
        let source = localCW==nil ? SpotLogic.source(spotter: raw.spotter, comment: raw.comment):"local_cw"
        let specials = specialTags(comment: raw.comment, source: source)
        let displayComment = source == "rbl" && !raw.comment.uppercased().hasPrefix("RBN")
            ? (raw.comment.isEmpty ? "RBN" : "RBN · \(raw.comment)")
            : raw.comment
        let (score, reasons) = SpotLogic.score(callStatus: classification.callStatus, dxccStatus: classification.dxccStatus,
                                               specials: specials, source: source)
        var spot = ClassifiedClusterSpot(
            id: UUID(), receivedAt: raw.receivedAt, clusterName: raw.clusterName, spotter: raw.spotter,
            spotterContinent: spotterCountry?.continent,
            frequencyKHz: raw.frequencyKHz, frequencyText: raw.frequencyText, callsign: raw.callsign,
            comment: displayComment,
            band: band, mode: mode, country: country?.name ?? "Unknown", adif: country?.adif,
            continent: country?.continent ?? "", cqZone: country?.cqZone, ituZone: country?.ituZone,
            latitude: country?.latitude, longitude: country?.longitude,
            callStatus: classification.callStatus, dxccStatus: classification.dxccStatus,
            workedBefore: classification.workedBefore, specialTags: specials, score: score, scoreReasons: reasons,
            aggregateCount: 1, aggregateSpotters: [raw.spotter], source: source,
            statusHex: configuration.palette.status[classification.callStatus]
                ?? ClusterPalette.originalDefaults.status[classification.callStatus] ?? "#777F8C",
            bandHex: configuration.palette.band[band] ?? "#B0B0B0",
            modeHex: configuration.palette.mode[mode] ?? "#B0B0B0"
        )
        spot.localCW=localCW
        if onObservation != nil {
            if historySegments[origin.id] == nil {
                openHistorySegment(origin:origin, generation: generation, at: arrivedAt,
                                   phase: origin.local ? .connected:(statuses[origin.id]?.phase ?? .connecting))
            }
            if var segment = historySegments[origin.id] {
                segment.sequence += 1
                historySegments[origin.id] = segment
                let (reportedAt, timeBasis, recordKind) = localCW.map{(Optional($0.observedAt),"capture_host_receipt","local_cw")}
                    ?? ClusterSpotObservation.reportTime(line: line, raw: raw, arrivedAt: arrivedAt)
                onObservation?(.init(id:localCW?.id ?? UUID(),sessionID: segment.id, sequence: segment.sequence,
                    clusterID: origin.id, clusterName: raw.clusterName, clusterHost: segment.origin.host,
                    clusterPort: segment.origin.port, transportGeneration: generation,
                    arrivedAt: arrivedAt, reportedAt: reportedAt, timeBasis: timeBasis,
                    recordKind: recordKind, rawLine: line, raw: raw, classified: spot,
                    contactRevision: contactRevision))
            }
        }
        spot.comment = String(decoding: Data(displayComment.utf8.prefix(512)), as: UTF8.self)
        if let index = spots.firstIndex(where: { $0.callsign == spot.callsign && $0.source==spot.source
            && $0.localCW?.sourceID==spot.localCW?.sourceID && $0.localCW?.originInstanceID==spot.localCW?.originInstanceID
            && abs($0.frequencyKHz - spot.frequencyKHz) <= 0.1
            && raw.receivedAt.timeIntervalSince($0.receivedAt) < 180 }) {
            spot.aggregateCount = spots[index].aggregateCount + 1
            spot.aggregateSpotters = Array(Set(spots[index].aggregateSpotters + [raw.spotter])).sorted().prefix(32).map { $0 }
            spots.remove(at: index)
        }
        spots.insert(spot, at: 0)
        let limit = max(min(configuration.maximumSpots, 500) * 2, 400)
        if spots.count > limit { spots.removeLast(spots.count - limit) }
        onSpot?(spot, connectionGeneration)
    }

    private func openHistorySegment(server: ClusterServerConfiguration, generation: UUID, at date: Date, phase: ClusterConnectionPhase) {
        openHistorySegment(origin:ObservationOrigin(server:server),generation:generation,at:date,phase:phase)
    }
    private func openHistorySegment(origin: ObservationOrigin, generation: UUID, at date: Date, phase: ClusterConnectionPhase) {
        guard onObservation != nil || onHistoryConnection != nil else { return }
        let segment = HistorySegment(origin:origin, generation: generation)
        historySegments[origin.id] = segment
        publishHistoryConnection(segment, at: date, phase: phase)
    }

    private func closeHistorySegment(serverID: UUID, at date: Date, phase: ClusterConnectionPhase) {
        guard let segment = historySegments.removeValue(forKey: serverID) else { return }
        publishHistoryConnection(segment, at: date, phase: phase)
    }

    private func publishHistoryConnection(_ segment: HistorySegment, at date: Date, phase: ClusterConnectionPhase) {
        onHistoryConnection?(.init(sessionID: segment.id, clusterID: segment.origin.id,
            clusterName: segment.origin.name, clusterHost: segment.origin.host, clusterPort: segment.origin.port,
            transportGeneration: segment.generation, occurredAt: date, phase: phase))
    }

    private func reclassify() {
        for index in spots.indices {
            spots[index].refreshInferredMode(palette: configuration.palette)
            reclassifySpot(at: index)
        }
        publish()
    }

    private func reclassifySpot(at index: Int) {
        let country = countries.resolve(spots[index].callsign)
        let result = classify(call: spots[index].callsign, band: spots[index].band,
                              mode: spots[index].mode, adif: country?.adif)
        spots[index].country = country?.name ?? "Unknown"
        spots[index].adif = country?.adif
        spots[index].continent = country?.continent ?? ""
        spots[index].cqZone = country?.cqZone
        spots[index].ituZone = country?.ituZone
        spots[index].latitude = country?.latitude
        spots[index].longitude = country?.longitude
        spots[index].callStatus = result.callStatus
        spots[index].dxccStatus = result.dxccStatus
        spots[index].workedBefore = result.workedBefore
        spots[index].specialTags = specialTags(comment: spots[index].comment, source: spots[index].source)
        let (score, reasons) = SpotLogic.score(callStatus: result.callStatus, dxccStatus: result.dxccStatus,
                                               specials: spots[index].specialTags, source: spots[index].source)
        spots[index].score = score
        spots[index].scoreReasons = reasons
        spots[index].statusHex = configuration.palette.status[result.callStatus]
            ?? ClusterPalette.originalDefaults.status[result.callStatus] ?? "#777F8C"
        spots[index].bandHex = configuration.palette.band[spots[index].band] ?? "#B0B0B0"
        spots[index].modeHex = configuration.palette.mode[spots[index].mode] ?? "#B0B0B0"
    }

    private func specialTags(comment: String, source: String) -> [String] {
        var tags = SpotLogic.specials(in: comment, rules: configuration.specialRules)
        if source == "rbl", !tags.contains("RBN") { tags.insert("RBN", at: 0) }
        return tags
    }

    private func appendConsole(source: String, text: String, isCommand: Bool) {
        let safe = String(text.prefix(ClusterLineParser.maximumLineBytes)).unicodeScalars.filter {
            $0.value >= 0x20 && $0.value != 0x7f
        }.map(String.init).joined()
        console.append(.init(receivedAt: Date(), source: source,
                             text: String(decoding: Data(safe.utf8.prefix(1024)), as: UTF8.self), isCommand: isCommand))
        if console.count > 400 { console.removeFirst(console.count - 400) }
    }

    private func classify(call: String, band: String, mode: String, adif: Int?) -> ClusterClassification {
        guard hasContactSnapshot else {
            return ClusterClassification(callStatus: "Unknown", dxccStatus: "Unknown", workedBefore: nil)
        }
        return contacts.classify(call: call, band: band, mode: mode, adif: adif)
    }

    private func publish() { onUpdate?(snapshot()) }
}
