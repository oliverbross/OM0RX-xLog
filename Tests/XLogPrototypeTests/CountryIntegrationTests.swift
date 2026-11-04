import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import Testing
import XClusterIntegrationCore
#if canImport(XLogCore)
import XLogCore
#else
import XLogPortableCore
#endif
@testable import XLogPrototypeSupport

private struct CountryFixtureVault: ClusterCredentialStoring {
    let available = false
    func load(_ id: UUID) throws -> String? { nil }
    func save(_ password: String, serverID: UUID) throws {}
}
private final class CountryFixtureTransport: ClusterConnectionTransport, @unchecked Sendable {
    private let lock = NSLock()
    private var state: (@Sendable (ClusterConnectionPhase, String?) -> Void)?
    private var line: (@Sendable (String) -> Void)?
    func callbacks(_ state: @escaping @Sendable (ClusterConnectionPhase, String?) -> Void,
                   _ line: @escaping @Sendable (String) -> Void) { lock.withLock { self.state = state; self.line = line } }
    func start() { lock.withLock { state }?(.connected, nil) }
    func stop() {}
    func send(_ command: String) {}
    func updateOptions(reconnect: Bool, requestSkimmer: Bool) {}
    func emit(_ text: String) { lock.withLock { line }?(text) }
}
private final class CountryPackHTTPFixture: URLProtocol {
    private static let lock = NSLock()
    private static var bytes = Data()
    private static var requests: [URLRequest] = []
    static func install(_ data: Data) { lock.withLock { bytes = data; requests = [] } }
    static var observed: [URLRequest] { lock.withLock { requests } }
    override class func canInit(with request: URLRequest) -> Bool { request.url?.host == "country-fixture.invalid" }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {
        let bytes = Self.lock.withLock { Self.requests.append(request); return Self.bytes }
        let unchanged = request.value(forHTTPHeaderField: "If-None-Match") == "fixture-v1"
        let response = HTTPURLResponse(url: request.url!, statusCode: unchanged ? 304 : 200,
            httpVersion: "HTTP/1.1", headerFields: ["ETag": "fixture-v1", "Content-Type": "application/json"])!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        if !unchanged { client?.urlProtocol(self, didLoad: bytes) }
        client?.urlProtocolDidFinishLoading(self)
    }
    override func stopLoading() {}
}
private actor CountryScanGate {
    private(set) var entered = false
    func enter() { entered = true }
}

@Suite("Integrated country reference and reviewed correction")
struct CountryIntegrationTests {
    private func make(_ root: URL) throws -> LiveLogbookMethods {
        let service = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        _ = try service.handle(method: "workspace_create", params: ["mode": "empty"])
        return service
    }
    private func generation(_ service: LiveLogbookMethods) throws -> String {
        try #require(try service.handle(method: "workspace_status", params: [:])["generation"] as? String)
    }
    private func populated(_ db: LogbookDatabase, resolver: CTYResolver, count: Int = 2) throws -> [LogbookContactSnapshot] {
        let day = ISO8601DateFormatter().date(from: "2020-01-01T12:00:00Z")!
        let country = try #require(resolver.facts("OM0RX", at: day).country)
        return try (0..<count).map { index in
            var qso = QSO(call: "OM0RX", start: day.addingTimeInterval(Double(index)), band: "20m", mode: "CW")
            qso.country = country.name; qso.dxcc = country.adif; qso.continent = country.continent
            qso.cqZone = "14"; qso.ituZone = String(country.ituZone)
            qso.comment = "held original \(index)"; qso.extraFields["MY_POTA_REF"] = "SK-0001"
            try db.save(qso)
            return try #require(try db.contactSnapshot(localID: qso.id))
        }
    }
    private func preview(_ service: LiveLogbookMethods, _ contacts: [LogbookContactSnapshot]) throws -> [String: Any] {
        try service.handle(method: "logbook_country_correction_preview", params: ["generation": generation(service),
            "contacts": contacts.map { ["contactID": $0.qso.id.uuidString, "expectedRevision": $0.revision] as [String: Any] }])
    }
    private func applyParams(_ review: [String: Any], _ contacts: [LogbookContactSnapshot]) -> [String: Any] {
        ["generation": review["generation"]!, "reviewID": review["reviewID"]!,
         "selection": contacts.map { ["contactID": $0.qso.id.uuidString, "fields": ["cqZone"]] as [String: Any] }]
    }

    @Test("Actual cluster/logbook hosts share snapshot and retain observation identity on refresh")
    func sharedHostSnapshot() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let logbook = try make(root), reference = try logbook.referenceDirectoryURL().appendingPathComponent("cty.xml")
        let xml = "<cty><prefix><call>OM</call><adif>504</adif><cqz>15</cqz><entity>Slovakia</entity><cont>EU</cont></prefix><prefix><call>EA8</call><adif>29</adif><cqz>33</cqz><entity>Canary Islands</entity><cont>AF</cont></prefix><prefix><call>K</call><adif>291</adif><cqz>5</cqz><entity>USA</entity><cont>NA</cont></prefix></cty>"
        try Data(xml.utf8).write(to: reference, options: .atomic)
        let configURL = root.appendingPathComponent("cluster.json")
        try JSONEncoder().encode(ClusterSessionConfiguration(servers: [.init(name: "Fixture", host: "invalid.example", port: 7300, callsign: "OM0RX")], requestRecentSpotsOnConnect: false)).write(to: configURL)
        let transport = CountryFixtureTransport()
        let cluster = LiveClusterMethods(logbook: logbook, configurationURL: configURL, vault: CountryFixtureVault(),
            transportFactory: { _, _, _, _, state, line in transport.callbacks(state, line); return transport }, radioSideEffectsAllowed: false)
        _ = try await cluster.handle(method: "cluster_connect", params: [:])
        transport.emit("DX de K1ABC: 14025.0 OM0RX/EA8 CW")
        transport.emit("DX de OM0RX: 14026.0 EA8/OM0RX/P CW")
        var spots: [[String: Any]] = []
        for _ in 0..<100 {
            let response = try await cluster.handle(method: "cluster_snapshot", params: [:])
            spots = (response["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]] ?? []
            if spots.count == 2 { break }; try await Task.sleep(for: .milliseconds(10))
        }
        #expect(spots.count == 2)
        for spot in spots {
            let call = try #require(spot["callsign"] as? String), timestamp = try #require(spot["receivedAt"] as? Double)
            let at = ISO8601DateFormatter().string(from: Date(timeIntervalSinceReferenceDate: timestamp))
            let facts = try #require(try logbook.handle(method: "logbook_country_facts", params: ["call": call, "at": at])["facts"] as? [String: Any])
            #expect((facts["country"] as? [String: Any])?["adif"] as? Int == 29)
            #expect(spot["adif"] as? Int == 29)
            #expect(spot["countryReferenceRevision"] as? String == facts["referenceRevision"] as? String)
            #expect(spot["locationPrecision"] as? String == "entityApproximation")
        }
        let original = Dictionary(uniqueKeysWithValues: spots.map { ($0["id"] as! String, $0["receivedAt"] as! Double) })
        try Data(xml.replacingOccurrences(of: "<adif>29</adif>", with: "<adif>999</adif>").utf8).write(to: reference, options: .atomic)
        let refreshed = try await cluster.handle(method: "cluster_snapshot", params: [:])
        let after = try #require((refreshed["snapshot"] as? [String: Any])?["spots"] as? [[String: Any]])
        #expect(after.count == 2)
        #expect(after.allSatisfy { $0["adif"] as? Int == 999 && original[$0["id"] as? String ?? ""] == $0["receivedAt"] as? Double })
        _ = await cluster.terminate()
    }

    @Test("Zone-only full-log review, explicit selected transaction, replay and revision-checked recovery")
    func zoneOnlyCorrection() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), db = try service.openedDatabase()
        let contacts = try populated(db, resolver: service.currentCTYResolver(), count: 30)
        let revision = try db.currentRevision(), pending = try db.pendingSyncCount()
        let pageResponse = try await service.countryReview(params: ["generation": generation(service), "limit": 1, "offset": 29])
        let page = try #require(pageResponse["page"] as? [String: Any])
        #expect(page["affectedCount"] as? Int == 30)
        #expect((page["rows"] as? [[String: Any]])?.count == 1)
        #expect(try db.currentRevision() == revision)
        #expect(try db.pendingSyncCount() == pending)
        let selected = Array(contacts.prefix(2)), review = try preview(service, selected), params = applyParams(review, selected)
        let result = try service.handle(method: "logbook_country_correction_apply", params: params)
        #expect(result["status"] as? String == "applied")
        for contact in selected {
            let current = try #require(try db.contactSnapshot(localID: contact.qso.id))
            #expect(current.qso.cqZone == "15")
            #expect(current.qso.call == contact.qso.call && current.qso.start == contact.qso.start)
            #expect(current.qso.comment == contact.qso.comment && current.qso.extraFields["MY_POTA_REF"] == "SK-0001")
        }
        let after = try db.currentRevision()
        #expect(try service.handle(method: "logbook_country_correction_apply", params: params)["replayed"] as? Bool == true)
        #expect(try db.currentRevision() == after)
        let receipt = try #require((result["receipts"] as? [[String: Any]])?.first)
        let operation = try #require((receipt["mutation"] as? [String: Any])?["operationID"] as? String)
        let undo: [String: Any] = ["generation": try generation(service), "operationID": operation, "undoOperationID": UUID().uuidString]
        let recovered = try service.handle(method: "logbook_country_correction_undo", params: undo)
        #expect(recovered["status"] as? String == "applied")
        #expect(try service.handle(method: "logbook_country_correction_undo", params: undo)["replayed"] as? Bool == true)
        let restoredID = try #require((receipt["mutation"] as? [String: Any])?["contactID"] as? String)
        #expect(try db.contactSnapshot(localID: UUID(uuidString: restoredID)!)?.qso.cqZone == "14")
        let laterReceipt = try #require((result["receipts"] as? [[String: Any]])?.last)
        let laterOperation = try #require((laterReceipt["mutation"] as? [String: Any])?["operationID"] as? String)
        let laterID = UUID(uuidString: try #require((laterReceipt["mutation"] as? [String: Any])?["contactID"] as? String))!
        var later = try #require(try db.contactSnapshot(localID: laterID)).qso
        later.comment = "later legitimate operator edit"; try db.save(later)
        let retainedLater = try db.contactSnapshot(localID: laterID)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_country_correction_undo", params: ["generation": generation(service), "operationID": laterOperation, "undoOperationID": UUID().uuidString])
        }
        #expect(try db.contactSnapshot(localID: laterID) == retainedLater)
    }

    @Test("Stale selection and injected commit failure produce zero partial writes or receipts")
    func atomicConflicts() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), db = try service.openedDatabase(), contacts = try populated(db, resolver: service.currentCTYResolver())
        let review = try preview(service, contacts)
        var changed = contacts[1].qso; changed.comment = "later operator edit"; try db.save(changed)
        #expect(throws: WorkerFailure.self) { try service.handle(method: "logbook_country_correction_apply", params: applyParams(review, contacts)) }
        #expect(try db.contactSnapshot(localID: contacts[0].qso.id)?.revision == contacts[0].revision)
        let current = try contacts.map { try #require(try db.contactSnapshot(localID: $0.qso.id)) }
        let mutations = current.map { snapshot -> LogbookContactMutation in
            var qso = snapshot.qso; qso.cqZone = "15"
            return LogbookContactMutation(operationID: UUID(), contactID: qso.id, expectedRevision: snapshot.revision, action: .update, qso: qso)
        }
        #expect(throws: WorkerFailure.self) {
            try db.applyContactMutations(mutations, beforeCommit: { throw WorkerFailure("fixture_failure", "before commit") })
        }
        for (snapshot, mutation) in zip(current, mutations) {
            #expect(try db.contactSnapshot(localID: snapshot.qso.id) == snapshot)
            #expect(try db.contactReceipt(operationID: mutation.operationID) == nil)
        }
        let freshReview = try preview(service, current)
        let reference = try service.referenceDirectoryURL().appendingPathComponent("cty.xml")
        try Data("<cty><prefix><call>OM</call><adif>999</adif><cqz>16</cqz><entity>Synthetic replacement</entity></prefix></cty>".utf8).write(to: reference, options: .atomic)
        #expect(throws: WorkerFailure.self) {
            try service.handle(method: "logbook_country_correction_apply", params: applyParams(freshReview, current))
        }
        for snapshot in current { #expect(try db.contactSnapshot(localID: snapshot.qso.id) == snapshot) }
    }

    @Test("Whole-pack validation/rollback and combined backup retain contacts, reference bytes and recovery receipts")
    func packLifecycleAndBackup() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), db = try service.openedDatabase()
        let contacts = try populated(db, resolver: service.currentCTYResolver(), count: 1)
        let review = try preview(service, contacts)
        let applied = try service.handle(method: "logbook_country_correction_apply", params: applyParams(review, contacts))
        let receipt = try #require((applied["receipts"] as? [[String: Any]])?.first)
        let operation = try #require((receipt["mutation"] as? [String: Any])?["operationID"] as? String)
        let retainedContact = try #require(try db.contactSnapshot(localID: contacts[0].qso.id))
        var savedSettings = try service.currentSettings()
        let antenna = AntennaProfile(id: "country-backup-beam", name: "Saved software beam", bands: ["20m"],
            rotorConfigurationID: AntennaProfile.workspaceRotorID, azimuthOffsetDegrees: 15, revision: 4)
        savedSettings.stationEquipment.profiles = [antenna]; savedSettings.stationEquipment.selectedProfileID = antenna.id
        let preset = PortablePreset(id: "country-backup-portable", name: "Saved portable context", stationCall: "VK8RX/P",
            operatorCall: "VK8RX", locator: "PH57", ownReferences: ["POTA": ["AU-0001"]], power: "10", antennaProfileID: antenna.id, ownDXCC: 150)
        savedSettings.portableOperating.presets = [preset]
        savedSettings.portableOperating.activeContext = PortableActiveContext(preset: preset, sessionID: "country-backup-session", revision: 2,
            startedAt: Date(timeIntervalSince1970: 1_577_880_000))
        savedSettings.nearbySpottedCallsigns = true
        let cw: [String: Any] = ["version": 1, "output": "winkeyer", "showOnDesk": true,
            "composition": ["mode": "word"], "winkeyer": ["port": "/dev/fixture-only-keyer", "wpm": 22,
                "preferences": ["speedSource": "pot", "potMinimum": 10, "potRange": 30, "weighting": 55, "ratio": 50]],
            "macros": (1...20).map { ["id": $0, "label": "Saved \($0)", "text": "{MYCALL} {WPM:24}{CALL}{WPM:BASE} {PROSIGN:AR}",
                "color": "cyan", "shortcut": $0 <= 12 ? "F\($0)" : "", "enabled": true, "onDesk": $0 <= 12] as [String: Any] }]
        savedSettings.cwProfile = try JSONDecoder().decode(CWProfile.self, from: JSONSerialization.data(withJSONObject: cw))
        let voice: [String: Any] = ["version": 1, "profilePath": root.appendingPathComponent("external-voice-library").path,
            "labels": (1...10).map { "Saved voice \($0)" },
            "routes": ["input": ["deviceId": "fixture-input", "channels": [0], "sampleRate": 48000],
                "monitor": ["deviceId": "fixture-monitor", "channels": [0, 1], "sampleRate": 48000],
                "transmit": ["deviceId": "fixture-transmit", "channels": [1], "sampleRate": 48000]],
            "edits": (1...10).map { _ in ["trimStartMs": 100, "trimEndMs": 1000, "gainDb": -3] }]
        savedSettings.voiceProfile = try JSONDecoder().decode(VoiceProfile.self, from: JSONSerialization.data(withJSONObject: voice))
        func settingsObject(_ settings: XLogSettings) throws -> [String: Any] {
            let encoder = JSONEncoder(); encoder.dateEncodingStrategy = .iso8601
            return try #require(try JSONSerialization.jsonObject(with: encoder.encode(settings)) as? [String: Any])
        }
        _ = try service.saveSettingsForTest(settingsObject(savedSettings))
        let preferencesBase = try service.handle(method: "workspace_preferences_load", params: [:])
        let filters = try #require((preferencesBase["preferences"] as? [String: Any])?["savedLogbookFilters"])
        _ = try service.handle(method: "workspace_logbook_filters_apply", params: ["action": "save", "generation": preferencesBase["generation"]!,
            "expected": filters, "name": "Saved country selection", "query": "OM0RX", "definition": ["version": 1, "join": "all",
                "clauses": [["field": "band", "op": "eq", "values": ["20m"]]]]])
        let commandsBase = try service.handle(method: "workspace_preferences_load", params: [:])
        _ = try service.handle(method: "workspace_commands_apply", params: ["generation": commandsBase["generation"]!, "expectedRevision": commandsBase["revision"]!,
            "bindings": ["version": 1, "overrides": ["save-current-qso": "Primary+Shift+J"]]])
        var preferences = try #require(try service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        preferences["deskBandMapBands"] = ["20m", "17m"]
        _ = try saveWorkspacePreferences(service, preferences)
        let capturedPreferences = try #require(try service.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        let seed = savedSettings.applyingOperatingDefaults(to: QSO(call: "", band: "20m", mode: "CW"))
        let initialDraft = try db.operatorDraft(initial: seed)
        var held = initialDraft.qso; held.call = "OM9HELD/P"; held.comment = "Held draft survives combined restore"
        let capturedDraft = try db.applyOperatorDraft(OperatorDraftMutation(operationID: UUID(), draftID: held.id,
            expectedRevision: initialDraft.revision, action: .replace, qso: held), nextDraft: seed).draft
        let directory = try service.referenceDirectoryURL(), updater = try ReferenceDataUpdater(directory: directory)
        let bundled = try CTYResolver.bundledCountryPackBytes()
        var pack = try #require(JSONSerialization.jsonObject(with: bundled) as? [String: Any])
        var records = try #require(pack["records"] as? [[String: Any]])
        records.append(["pattern": "OM0RX", "exact": true, "deleted": false, "country": ["name": "SYNTHETIC REVIEW FIXTURE", "adif": 999, "continent": "EU", "cqZone": 16, "ituZone": 28],
            "component": "CallResolution.tbl", "line": 999999])
        pack["provider"] = "Synthetic derivative fixture from pinned OK1RR records"; pack["records"] = records
        let changed = try JSONSerialization.data(withJSONObject: pack, options: [.sortedKeys])
        _ = try await updater.importCountryPack(changed)
        #expect(try service.currentCTYResolver().facts("OM0RX", at: contacts[0].qso.start).country?.adif == 999)
        #expect(try db.contactSnapshot(localID: contacts[0].qso.id) == retainedContact)
        let active = directory.appendingPathComponent("country-reference-pack.json"), beforeBytes = try Data(contentsOf: active)
        pack["records"] = []
        do { _ = try await updater.importCountryPack(JSONSerialization.data(withJSONObject: pack)); Issue.record("Empty pack activated") }
        catch {}
        #expect(try Data(contentsOf: active) == beforeBytes)
        let backup = try service.handle(method: "backup_create", params: ["name": "country-and-receipts"])
        let name = try #require(backup["name"] as? String)
        var changedSettings = savedSettings
        changedSettings.stationEquipment.selectedProfileID = nil; changedSettings.portableOperating.activeContext = nil
        changedSettings.nearbySpottedCallsigns = false; changedSettings.cwProfile = nil; changedSettings.voiceProfile = nil
        _ = try service.saveSettingsForTest(settingsObject(changedSettings))
        let changedCommands = try service.handle(method: "workspace_preferences_load", params: [:])
        _ = try service.handle(method: "workspace_commands_apply", params: ["generation": changedCommands["generation"]!, "expectedRevision": changedCommands["revision"]!,
            "bindings": ["version": 1, "overrides": [:]]])
        _ = try await updater.rollbackCountryPack()
        #expect(try service.currentCTYResolver().facts("OM0RX", at: contacts[0].qso.start).country?.adif == 504)
        #expect(try db.contactSnapshot(localID: contacts[0].qso.id) == retainedContact)
        _ = try service.handle(method: "backup_restore", params: ["name": name, "confirm_restore": true, "restore_settings": true, "restore_preferences": true])
        let reopened = LiveLogbookMethods(supportDirectory: root, inheritNativePreferences: false)
        let restoredSettings = try reopened.currentSettings()
        #expect(restoredSettings.stationEquipment == savedSettings.stationEquipment)
        #expect(restoredSettings.portableOperating == savedSettings.portableOperating)
        #expect(restoredSettings.nearbySpottedCallsigns == true)
        #expect(restoredSettings.cwProfile == savedSettings.cwProfile)
        #expect(restoredSettings.voiceProfile == savedSettings.voiceProfile)
        let restoredPreferences = try #require(try reopened.handle(method: "workspace_preferences_load", params: [:])["preferences"] as? [String: Any])
        for key in ["deskBandMapBands", "savedLogbookFilters", "normalCommandBindings"] {
            #expect(try JSONSerialization.data(withJSONObject: [key: restoredPreferences[key]!], options: [.sortedKeys])
                == JSONSerialization.data(withJSONObject: [key: capturedPreferences[key]!], options: [.sortedKeys]))
        }
        #expect(try reopened.openedDatabase().operatorDraft() == capturedDraft)
        #expect(try reopened.currentCTYResolver().facts("OM0RX", at: contacts[0].qso.start).country?.adif == 999)
        let restoredReceipt = try reopened.openedDatabase().contactReceipt(operationID: UUID(uuidString: operation)!)
        #expect(restoredReceipt?.previousContact?.qso.cqZone == "14")
        let recovered = try reopened.handle(method: "logbook_country_correction_undo", params: ["generation": generation(reopened), "operationID": operation, "undoOperationID": UUID().uuidString])
        #expect(recovered["status"] as? String == "applied")
        #expect(try reopened.openedDatabase().contactSnapshot(localID: contacts[0].qso.id)?.qso.cqZone == "14")
    }

    @Test("Bundle/import/download share exact normalized identity and 304 preserves data revision and downloaded date")
    func downloadPipeline() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), directory = try service.referenceDirectoryURL()
        let bytes = try CTYResolver.bundledCountryPackBytes(), bundled = try CTYResolver(countryPack: bytes)
        CountryPackHTTPFixture.install(bytes)
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [CountryPackHTTPFixture.self]
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }
        let updater = try ReferenceDataUpdater(directory: directory, session: session)
        let imported = try await updater.importCountryPack(bytes)
        #expect(imported == bundled.snapshotIdentity)
        let url = URL(string: "https://country-fixture.invalid/pack.json")!
        let first = try await updater.refreshCountryPack(url)
        let active = directory.appendingPathComponent("country-reference-pack.json")
        let firstBytes = try Data(contentsOf: active)
        let second = try await updater.refreshCountryPack(url)
        #expect(try Data(contentsOf: active) == firstBytes)
        #expect(try service.currentCTYResolver().snapshotIdentity == imported)
        #expect(first.sourceMetadata["country-reference-pack.json"]?.downloadedAt == second.sourceMetadata["country-reference-pack.json"]?.downloadedAt)
        #expect(CountryPackHTTPFixture.observed.count == 2)
        #expect(CountryPackHTTPFixture.observed.last?.value(forHTTPHeaderField: "If-None-Match") == "fixture-v1")
        do { _ = try await updater.refreshCountryPack(URL(string: "https://user:secret@country-fixture.invalid/pack.json")!); Issue.record("Credential URL admitted") }
        catch {}
        #expect(CountryPackHTTPFixture.observed.count == 2)
        #expect(try service.openedDatabase().count() == 0)
    }

    @Test("Cancel scan and workspace drain retire native reader authority without contact writes")
    func cancellationAndDrain() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), db = try service.openedDatabase(), gen = try generation(service)
        _ = try populated(db, resolver: service.currentCTYResolver(), count: 1)
        let retained = try db.fetchAll(), revision = try db.currentRevision()
        for drain in [false, true] {
            let gate = CountryScanGate(), identity = UUID().uuidString
            service.beforeCountryScanReadForTesting = {
                await gate.enter()
                try await Task.sleep(for: .seconds(60))
            }
            let task = Task { try await service.countryReview(params: ["generation": gen, "scanID": identity]) }
            for _ in 0..<200 {
                if await gate.entered { break }
                try await Task.sleep(for: .milliseconds(10))
            }
            #expect(await gate.entered)
            if drain { await service.cancelCountryScans() }
            else {
                let cancelled = try service.handle(method: "logbook_country_review_cancel", params: ["generation": gen, "scanID": identity])
                #expect(cancelled["status"] as? String == "cancelled")
            }
            switch await task.result {
            case .success: Issue.record("A cancelled reader returned publishable country results")
            case .failure: break
            }
        }
        #expect(try db.fetchAll() == retained)
        #expect(try db.currentRevision() == revision)
    }

    @Test("First richer-pack import preserves configured XML source and rollback restores that exact predecessor")
    func configuredXMLRollback() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), directory = try service.referenceDirectoryURL(), xmlURL = directory.appendingPathComponent("cty.xml")
        let original = Data("<cty><prefix><call>OM</call><adif>990</adif><cqz>15</cqz><entity>Configured previous fixture</entity></prefix></cty>".utf8)
        try original.write(to: xmlURL, options: .atomic)
        let date = Date(timeIntervalSince1970: 1_577_880_000)
        #expect(try service.currentCTYResolver().facts("OM0RX", at: date).country?.adif == 990)
        let references = LiveReferenceMethods(logbook: service)
        let file = root.appendingPathComponent("reviewed-country-pack.json")
        let bundled = try CTYResolver.bundledCountryPackBytes(); try bundled.write(to: file)
        let activated = try await references.handle(method: "reference_country_import", params: ["path": file.path])
        #expect(activated["country_reference_changed"] as? Bool == true)
        #expect(activated["rollback_available"] as? Bool == true)
        #expect(try service.currentCTYResolver().facts("OM0RX", at: date).country?.adif == 504)
        // A later (currently inactive) XML download is also retained, not lost.
        let later = Data("<cty><prefix><call>OM</call><adif>991</adif><cqz>16</cqz><entity>Later inactive fixture</entity></prefix></cty>".utf8)
        try later.write(to: xmlURL, options: .atomic)
        let laterDigest = try CTYResolver(xmlURL: xmlURL).contentDigest
        let restored = try await references.handle(method: "reference_country_rollback", params: [:])
        #expect(restored["provider"] as? String == "Club Log XML")
        #expect(try service.currentCTYResolver().facts("OM0RX", at: date).country?.adif == 990)
        #expect(try Data(contentsOf: xmlURL) == original)
        #expect(try Data(contentsOf: directory.appendingPathComponent("Country Snapshots/\(laterDigest).xml")) == later)
        #expect(try Data(contentsOf: directory.appendingPathComponent("country-reference-pack.json")) == bundled)
        #expect(try service.openedDatabase().count() == 0)
    }

    #if os(macOS)
    @Test("Same-country portable home profile cannot become the operating position")
    func portableHomePosition() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = try make(root), base = try LocalCallsignProfile.base("OM0RX/P", logbook: service)
        let result = await CallsignEnrichment.resolve(base: base) {
            ["call": "OM0RX/P", "dxcc": 504, "country": "Slovakia", "name": "Operator", "gridSquare": "JN98", "latitude": 48.1, "longitude": 17.1]
        }
        #expect(result["gridSquare"] == nil)
        #expect(result["latitude"] as? Double == base["latitude"] as? Double)
        #expect((result["home_profile_location"] as? [String: Any])?["gridSquare"] as? String == "JN98")
        #expect(result["location_source"] as? String == "CTY approximate")
    }
    #endif
}
