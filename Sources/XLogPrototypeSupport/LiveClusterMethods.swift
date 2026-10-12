#if os(macOS)
import Foundation
import Security
import XCatIntegrationCore
import XClusterIntegrationCore
import XLogCore

/// Persistent worker bridge for the isolated integrated xLog profile.
/// Configuration is separate from both standalone apps; passwords live in Keychain.
public actor LiveClusterMethods {
    public static let shared = LiveClusterMethods()

    // Foundation's standalone worker may not provide a CFPreferences suite.
    // An explicit private file also keeps service identity independent of bundle lookup.
    private let configurationURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        .appendingPathComponent("OM0RX-xLog Integration Services/cluster.json")
    private let vault = ClusterCredentialVault()
    private var service: ClusterSessionService?
    private var configuration: ClusterSessionConfiguration?
    private var forwardAcceptedCount = 0
    private var forwardStatus = "Off"
    private var forwardRetryAfter = Date.distantPast

    public func handle(method: String, params: [String: Any]) async throws -> [String: Any] {
        if method == "cluster_history" {
            return try LiveLogbookMethods.shared.handle(method: method, params: params)
        }
        let service = try await readyService()
        switch method {
        case "cluster_snapshot":
            try require(params, allowed: [])
        case "cluster_configure":
            try require(params, allowed: ["configuration"], required: ["configuration"])
            guard let object = params["configuration"] as? [String: Any] else { throw invalid() }
            let next: ClusterSessionConfiguration = try decode(object)
            try validate(next)
            await service.configure(next)
            configuration = next
            forwardStatus = next.forwardSpotsToFlex ? "Enabled; connect a cluster and direct-agent station." : "Off"
            try saveConfiguration(next)
        case "cluster_connect":
            try require(params, allowed: [])
            let workspaceStatus = try LiveLogbookMethods.shared.handle(method: "workspace_status", params: [:])
            if workspaceStatus["workspace_exists"] as? Bool == true {
                try await refreshContacts()
            } else { await service.invalidateContacts() }
            let active = try currentConfiguration().servers.filter(\.enabled)
            var passwords: [UUID: String] = [:]
            for server in active { passwords[server.id] = try vault.load(server.id) ?? "" }
            try await service.connect(passwords: passwords)
        case "cluster_disconnect":
            try require(params, allowed: [])
            await service.disconnect()
        case "cluster_command":
            try require(params, allowed: ["command", "server_id"], required: ["command"])
            guard let command = params["command"] as? String,
                  command.utf8.count <= 160 else { throw invalid() }
            let serverID: UUID?
            if let rawID = params["server_id"] as? String {
                guard let parsed = UUID(uuidString: rawID) else { throw invalid() }
                serverID = parsed
            } else { serverID = nil }
            try await service.sendCommand(command, to: serverID)
        case "cluster_filter":
            try require(params, allowed: ["filter"], required: ["filter"])
            guard let object = params["filter"] as? [String: Any] else { throw invalid() }
            let filter: ClusterSpotFilter = try decode(object)
            try validateFilter(filter)
            await service.updateFilter(filter)
            var next = try currentConfiguration()
            next.filter = filter
            configuration = next
            try saveConfiguration(next)
        case "cluster_password_set":
            try require(params, allowed: ["server_id", "password"], required: ["server_id", "password"])
            guard let rawID = params["server_id"] as? String, let serverID = UUID(uuidString: rawID),
                  try currentConfiguration().servers.contains(where: { $0.id == serverID }),
                  let password = params["password"] as? String,
                  password.utf8.count <= 256, !password.contains("\r"), !password.contains("\n") else { throw invalid() }
            try vault.save(password, serverID: serverID)
        case "cluster_console_clear":
            try require(params, allowed: [])
            await service.clearConsole()
        default:
            throw WorkerFailure("method_not_allowed", "Unknown live cluster method.")
        }
        let (snapshot, truncated) = try await boundedSnapshot(service)
        return ["configuration": try json(currentConfiguration()),
                "snapshot": try json(snapshot), "snapshot_truncated": truncated,
                "password_servers": try currentConfiguration().servers.filter { try vault.hasPassword($0.id) }.map { $0.id.uuidString },
                "forwarding": ["accepted_count": forwardAcceptedCount, "status": forwardStatus]]
    }

    /// Read an already running cluster without starting services or scanning contacts.
    func currentSpotRowsIfStarted() async -> [[String: Any]] {
        guard let service, let (snapshot, _) = try? await boundedSnapshot(service),
              let object = try? json(snapshot) as? [String: Any] else { return [] }
        return object["spots"] as? [[String: Any]] ?? []
    }

    /// Called after local QSO mutations, import, restore or remote reconciliation.
    public func refreshContacts() async throws {
        let service = try await readyService()
        let database = try LiveLogbookMethods.shared.openedDatabase()
        let contacts = try database.clusterContactRows()
        var records: [ClusterContact] = []
        records.reserveCapacity(contacts.count)
        let resolver = try? CTYResolver.bundled()
        for qso in contacts {
            records.append(ClusterContact(callsign: qso.call, band: qso.band,
                                          mode: qso.mode,
                                          adif: qso.dxcc ?? resolver?.resolve(qso.call, at: qso.start)?.adif,
                                          date: qso.start, paperQSL: qso.qslReceived,
                                          lotwQSL: qso.lotwReceived))
        }
        await service.replaceContacts(records)
    }


    /// Keep the full in-memory history while fitting a bounded worker response.
    /// Trim oldest console lines first, then least-recent visible spots if needed.
    private func boundedSnapshot(_ service: ClusterSessionService) async throws -> (ClusterSessionSnapshot, Bool) {
        var snapshot = await service.snapshot()
        var truncated = false
        while try JSONEncoder().encode(snapshot).count > 800_000 {
            truncated = true
            if snapshot.console.count > 40 {
                snapshot.console.removeFirst(max(1, snapshot.console.count / 4))
            } else if snapshot.spots.count > 1 {
                snapshot.spots.removeLast(max(1, snapshot.spots.count / 4))
            } else { break }
        }
        return (snapshot, truncated)
    }

    private func readyService() async throws -> ClusterSessionService {
        if let service { return service }
        let config: ClusterSessionConfiguration
        try validateConfigurationPath()
        if FileManager.default.fileExists(atPath: configurationURL.path) {
            let data = try Data(contentsOf: configurationURL)
            guard data.count <= 262_144 else { throw invalid() }
            config = try JSONDecoder().decode(ClusterSessionConfiguration.self, from: data)
            try validate(config)
        } else {
            config = ClusterSessionConfiguration(servers: [])
        }
        let created = ClusterSessionService(configuration: config, onSpot: { [weak self] spot, generation in
            Task { await self?.forwardSpotIfEnabled(spot, generation: generation) }
        })
        if let csv = try? CTYResolver.bundledCSV() { await created.replaceCountryCSV(csv) }
        configuration = config
        forwardStatus = config.forwardSpotsToFlex ? "Enabled; connect a cluster and direct-agent station." : "Off"
        service = created
        if (try LiveLogbookMethods.shared.handle(method: "workspace_status", params: [:]))["workspace_exists"] as? Bool == true {
            try await refreshContacts()
        }
        return created
    }

    private func validateConfigurationPath() throws {
        for url in [configurationURL.deletingLastPathComponent(), configurationURL] {
            if FileManager.default.fileExists(atPath: url.path),
               try url.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink == true {
                throw WorkerFailure("unsafe_configuration", "Cluster configuration cannot use a symbolic link.")
            }
        }
    }

    private func saveConfiguration(_ value: ClusterSessionConfiguration) throws {
        try validateConfigurationPath()
        let directory = configurationURL.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        try JSONEncoder().encode(value).write(to: configurationURL, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: configurationURL.path)
    }

    private func forwardSpotIfEnabled(_ spot: ClassifiedClusterSpot, generation: UUID) async {
        guard configuration?.forwardSpotsToFlex == true, let service,
              await service.isVisibleSpot(spot.id, in: generation) else { return }
        let now = Date()
        guard now >= forwardRetryAfter else { return }
        let frequencyHz = Int64((spot.frequencyKHz * 1_000).rounded())
        guard (100_000...60_000_000).contains(frequencyHz),
              abs(now.timeIntervalSince(spot.receivedAt)) < 86_400 else { return }
        do {
            let flexSpot = try FlexSpot(frequencyHz: frequencyHz, callsign: spot.callsign,
                                        mode: spot.mode, source: "xLog xCluster", spotter: spot.spotter,
                                        comment: spot.comment,
                                        timestamp: Int64(spot.receivedAt.timeIntervalSince1970),
                                        lifetimeSeconds: 600, priority: 3,
                                        colorHex: spot.statusHex.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) == nil
                                            ? "#35C8F5" : spot.statusHex)
            guard !flexSpot.mode.isEmpty else { return }
            if try await SpotForwardBroker.shared.forward(flexSpot) {
                forwardAcceptedCount += 1
                forwardStatus = "Accepted by Remote Station Agent; FLEX display is not verified."
            }
        } catch {
            forwardStatus = "FLEX forwarding unavailable. Connect a direct-agent station with add_spot support."
            forwardRetryAfter = now.addingTimeInterval(60)
        }
    }

    private func currentConfiguration() throws -> ClusterSessionConfiguration {
        guard let configuration else { throw WorkerFailure("cluster_unavailable", "Cluster settings are unavailable.") }
        return configuration
    }

    private func validate(_ value: ClusterSessionConfiguration) throws {
        guard value.servers.count <= 16, Set(value.servers.map(\.id)).count == value.servers.count,
              (1...500).contains(value.maximumSpots), value.specialRules.count <= 64,
              value.commandPresets.count <= 32,
              Set(value.commandPresets.map(\.id)).count == value.commandPresets.count else { throw invalid() }
        try validateFilter(value.filter)
        for server in value.servers {
            guard server.name.utf8.count <= 80, server.host.utf8.count <= 253,
                  server.callsign.utf8.count <= 24, (1...65_535).contains(server.port) else { throw invalid() }
        }
        for rule in value.specialRules {
            guard rule.name.utf8.count <= 80, rule.keywords.count <= 16,
                  rule.advancedPattern.utf8.count <= 256,
                  rule.keywords.allSatisfy({ $0.utf8.count <= 80 }) else { throw invalid() }
            if !rule.advancedPattern.isEmpty {
                guard (try? NSRegularExpression(pattern: rule.advancedPattern)) != nil else { throw invalid() }
            }
        }
        for preset in value.commandPresets {
            guard !preset.name.isEmpty, preset.name.utf8.count <= 80,
                  !preset.command.isEmpty, preset.command.utf8.count <= 160,
                  preset.command.unicodeScalars.allSatisfy({ (32...126).contains($0.value) }) else { throw invalid() }
        }
        let colors = [value.palette.status, value.palette.band, value.palette.mode]
        guard colors.allSatisfy({ $0.count <= 100 && $0.allSatisfy { key, color in
            key.utf8.count <= 80 && color.range(of: #"^#[0-9A-Fa-f]{6}$"#, options: .regularExpression) != nil
        } }) else { throw invalid() }
    }

    private func validateFilter(_ value: ClusterSpotFilter) throws {
        let selections = [value.bands, value.modes, value.continents, value.callStatuses,
                          value.dxccStatuses, value.specials, value.sources, value.worked]
        guard value.query.utf8.count <= 128,
              !value.query.unicodeScalars.contains(where: { $0.value < 0x20 }),
              selections.allSatisfy({ $0.count <= 64 && $0.allSatisfy { !$0.isEmpty && $0.utf8.count <= 80 } }),
              value.bands.isSubset(of: Set(SpotLogic.bands)),
              value.modes.isSubset(of: Set(SpotLogic.modes)),
              value.continents.isSubset(of: ["AF", "AN", "AS", "EU", "NA", "OC", "SA"]),
              value.callStatuses.isSubset(of: ["New Call", "New Band", "New Mode", "New Band+Mode", "Worked", "Confirmed", "Unknown"]),
              value.dxccStatuses.isSubset(of: ["ATNO", "C/New Band", "C/New Mode", "C/New Band+Mode", "W/New Band", "W/New Mode", "W/New Band+Mode", "Worked", "Confirmed", "Unknown"]),
              value.sources.isSubset(of: ["cluster", "rbl"]),
              value.worked.isSubset(of: ["Worked before", "Not worked"]) else { throw invalid() }
    }

    private func require(_ params: [String: Any], allowed: Set<String>, required: Set<String> = []) throws {
        guard Set(params.keys).isSubset(of: allowed), required.isSubset(of: Set(params.keys)) else { throw invalid() }
    }

    private func decode<T: Decodable>(_ object: [String: Any]) throws -> T {
        guard JSONSerialization.isValidJSONObject(object) else { throw invalid() }
        return try JSONDecoder().decode(T.self, from: JSONSerialization.data(withJSONObject: object))
    }

    private func json<T: Encodable>(_ value: T) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
    }

    private func invalid() -> WorkerFailure {
        WorkerFailure("invalid_params", "Invalid cluster settings or request.")
    }
}

private struct ClusterCredentialVault {
    private let service = "com.oliverbross.xlog.integration.cluster"

    func load(_ id: UUID) throws -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: id.uuidString,
                                    kSecReturnData as String: true]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = item as? Data,
              let password = String(data: data, encoding: .utf8) else {
            throw WorkerFailure("credential_failed", "Could not read the cluster password from Keychain.")
        }
        return password
    }

    func hasPassword(_ id: UUID) throws -> Bool { try load(id) != nil }

    func save(_ password: String, serverID: UUID) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: serverID.uuidString]
        if password.isEmpty {
            let status = SecItemDelete(query as CFDictionary)
            guard status == errSecSuccess || status == errSecItemNotFound else {
                throw WorkerFailure("credential_failed", "Could not remove the cluster password from Keychain.")
            }
            return
        }
        let value = Data(password.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: value] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else {
            throw WorkerFailure("credential_failed", "Could not update the cluster password in Keychain.")
        }
        var item = query
        item[kSecValueData as String] = value
        let status = SecItemAdd(item as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw WorkerFailure("credential_failed", "Could not save the cluster password in Keychain.")
        }
    }
}
#endif
