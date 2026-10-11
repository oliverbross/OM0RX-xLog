import AppKit
import Foundation
import SwiftUI
import UniformTypeIdentifiers
import XLogCore

enum BandMapLayout: String, CaseIterable, Identifiable {
    case singleRow = "Single row"
    case adaptiveGrid = "Adaptive grid"
    var id: String { rawValue }
}

enum MapDisplayPreset: String, CaseIterable, Identifiable, Codable {
    case simple = "Simple"
    case detailed = "Detailed"
    case dx = "DX"
    var id: String { rawValue }
}

enum QSOSessionPhase: String, Codable {
    case idle
    case active
    case editing
}

struct QSOSessionState: Equatable, Codable {
    var phase: QSOSessionPhase = .idle
    var startedAt: Date?
    var lastActivityAt: Date?
    var firstTransmitAt: Date?
    var peakPowerWatts: Double?
    var recoveredAt: Date?
    var routeHistory: [String] = []
}

enum OperatorEventKind: String, Codable {
    case tune, radio, station, sync, draft, validation

    var symbol: String {
        switch self {
        case .tune: return "dial.medium"
        case .radio: return "dot.radiowaves.left.and.right"
        case .station: return "bolt.horizontal.circle"
        case .sync: return "arrow.triangle.2.circlepath"
        case .draft: return "doc.badge.clock"
        case .validation: return "checklist"
        }
    }
}

struct OperatorEvent: Identifiable, Codable, Equatable {
    let id: UUID
    let date: Date
    let kind: OperatorEventKind
    let title: String
    let detail: String
    let durationMilliseconds: Int?
    let succeeded: Bool

    init(kind: OperatorEventKind, title: String, detail: String = "", duration: TimeInterval? = nil, succeeded: Bool = true) {
        id = UUID()
        date = Date()
        self.kind = kind
        self.title = title
        self.detail = detail
        durationMilliseconds = duration.map { Int(($0 * 1_000).rounded()) }
        self.succeeded = succeeded
    }
}

enum RotorPathSelection: String, CaseIterable, Identifiable {
    case shortPath = "SP"
    case longPath = "LP"

    var id: String { rawValue }
    var adifValue: String { self == .shortPath ? "S" : "L" }
    var title: String { self == .shortPath ? "Short Path" : "Long Path" }
}

enum DXLocationSource: Equatable {
    case none
    case ctyApproximate
    case qrzGrid
    case qrzCoordinates
    case activationReference(String)

    var label: String {
        switch self {
        case .none: return "No position"
        case .ctyApproximate: return "CTY approximate"
        case .qrzGrid: return "QRZ grid"
        case .qrzCoordinates: return "QRZ coordinates"
        case .activationReference(let label): return "\(label) reference"
        }
    }

    var isPrecise: Bool {
        switch self {
        case .qrzGrid, .qrzCoordinates: return true
        case .none, .ctyApproximate, .activationReference: return false
        }
    }
}

struct QSOFormState: Equatable, Codable {
    var call = ""
    var timestamp = Date()
    var frequency = ""
    var band = "20m"
    var mode = "SSB"
    var rstSent = "59"
    var rstReceived = "59"
    var name = ""
    var gridSquare = ""
    var country = ""
    var dxcc = ""
    var continent = ""
    var cqZone = ""
    var ituZone = ""
    var state = ""
    var county = ""
    var qth = ""
    var iota = ""
    var sota = ""
    var pota = ""
    var wwff = ""
    var sig = ""
    var sigInfo = ""
    var dok = ""
    var comment = ""
    var notes = ""
    var stationLocation = ""
    var radio = ""
    var rxFrequency = ""
    var rxBand = ""
    var txPower = ""
    var operatorCall = ""
    var propagation = ""
    var antennaPath = ""
    var email = ""
    var qslSent = ""
    var qslReceived = ""
    var qslMethod = ""
    var qslVia = ""
    var qslMessage = ""

    init() {}

    init(qso: QSO) {
        call = qso.call; timestamp = qso.start; frequency = qso.frequencyHz.map { String(format: "%.6f", Double($0) / 1_000_000) } ?? ""
        band = qso.band; mode = qso.submode.isEmpty ? qso.mode : qso.submode
        rstSent = qso.rstSent; rstReceived = qso.rstReceived; name = qso.name; gridSquare = qso.gridSquare
        country = qso.country; dxcc = qso.dxcc.map(String.init) ?? ""; continent = qso.continent
        cqZone = qso.cqZone; ituZone = qso.ituZone; state = qso.state; county = qso.county; qth = qso.qth
        iota = qso.iota; sota = qso.sotaReference; pota = qso.potaReference; wwff = qso.wwffReference
        sig = qso.sig; sigInfo = qso.sigInfo; dok = qso.dok; comment = qso.comment; notes = qso.notes
        stationLocation = qso.stationLocation; radio = qso.radio
        rxFrequency = qso.receiveFrequencyHz.map { String(format: "%.6f", Double($0) / 1_000_000) } ?? ""
        rxBand = qso.receiveBand; txPower = qso.txPower; operatorCall = qso.operatorCall
        propagation = qso.propagationMode; antennaPath = qso.antennaPath; email = qso.email
        qslSent = qso.qslSent; qslReceived = qso.qslReceived; qslMethod = qso.qslMethod
        qslVia = qso.qslVia; qslMessage = qso.qslMessage
    }

    mutating func resetKeepingStation() {
        let station = (stationLocation, radio, txPower, operatorCall)
        self = QSOFormState()
        (stationLocation, radio, txPower, operatorCall) = station
    }
}

private struct SavedQSODraft: Codable {
    let draft: QSOFormState
    let session: QSOSessionState
    let savedAt: Date
}

private struct AutomaticCallFields {
    var name: String?
    var gridSquare: String?
    var country: String?
    var dxcc: String?
    var continent: String?
    var cqZone: String?
    var ituZone: String?
    var state: String?
    var county: String?
    var qth: String?
    var email: String?
}

@MainActor
final class AppModel: ObservableObject {
    enum Destination: String, CaseIterable, Identifiable {
        case desk = "Operator Desk"
        case log = "Log QSO"
        case logbook = "Logbook"
        case insights = "Insights"
        case map = "World Map"
        case bandMaps = "Band Maps"
        case sync = "Sync"
        case settings = "Settings"
        var id: String { rawValue }
        var icon: String {
            switch self {
            case .desk: return "rectangle.3.group"
            case .log: return "plus.rectangle.on.folder"
            case .logbook: return "books.vertical"
            case .insights: return "chart.bar.xaxis"
            case .map: return "map"
            case .bandMaps: return "slider.vertical.3"
            case .sync: return "arrow.triangle.2.circlepath"
            case .settings: return "gearshape"
            }
        }
    }

    @Published var destination: Destination = .desk
    @Published var draft = QSOFormState() {
        didSet { persistDraftIfNeeded() }
    }
    @Published var qsos: [QSO] = []
    @Published var stats = LogbookStats.empty
    @Published var awardProgress = AwardProgressSnapshot.empty
    @Published var previous: [QSO] = []
    @Published var matrix: Set<BandModeCell> = []
    @Published var dxccSummary = DXCCSummary.empty
    @Published var search = ""
    @Published var settings: XLogSettings
    @Published var wavelogToken = ""
    @Published var qrzPassword = ""
    @Published var clubLogAPIKey = ""
    @Published var radioSnapshot: RadioSnapshot?
    @Published var radioStatus = "xCat offline"
    @Published var stationSnapshot: XCatStationSnapshot?
    @Published var stationStatus = "xCat telemetry unavailable"
    @Published var localWeather: StationWeather?
    @Published var weatherStatus = "Configure station grid"
    @Published var syncStatus = "Not configured"
    @Published var lookupStatus = "Ready"
    @Published var referenceState = ReferenceDataState()
    @Published private(set) var activationDirectory = ActivationReferenceDirectory()
    @Published var banner: AppBanner?
    @Published var isWorking = false
    @Published var pendingRestorePreview: XLogBackupPreview?
    @Published var restoreSettingsFromBackup = true
    @Published var restoreWorkspaceFromBackup = true
    @Published var lastSyncReport: SyncReport?
    @Published var conflicts: [SyncConflict] = []
    @Published var outbox: [SyncOutboxEntry] = []
    @Published var validationIssues: [QSOValidationIssue] = []
    @Published var pendingLogConfirmation = false
    @Published var qsoSession = QSOSessionState()
    @Published private(set) var activityEvents: [OperatorEvent] = []
    @Published private(set) var lastTuneLatencyMilliseconds: Int?
    @Published var clusterSpots: [ClusterSpot] = []
    @Published var clusterConnectedCount = 0
    @Published var clusterFeedUpdatedAt: Date?
    @Published var bandMapBands: [String] = ["20m"]
    @Published var detachedBandMapBands: [String] = Array(BandPlan.bands.prefix(10))
    @Published var deskBandMapFollowsRadio = true
    @Published var detachedBandMapLayout: BandMapLayout = .adaptiveGrid
    @Published var bandMapFontScale: Double = 1
    @Published var mapDisplayPreset: MapDisplayPreset = .detailed
    @Published var intelligenceBands: [String] = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"]
    @Published var clusterSpotOpensFullEditor = false
    @Published var sendSpotsToFlex = true
    @Published var automaticallyTurnRotor = true
    @Published var flexSpotPort = 12_062
    @Published private(set) var flexSpotStatus = "Waiting for xCluster spots"
    @Published private(set) var spotWorkflowStatus = "Following live radio"
    @Published private(set) var spotWorkflowBusy = false
    @Published var dxccEntities: [CountryInfo] = []
    @Published var dxccBoundaries: [DXCCBoundary] = []
    @Published var dxLatitude: Double?
    @Published var dxLongitude: Double?
    @Published var dxLocationSource: DXLocationSource = .none
    @Published var rotorPath: RotorPathSelection = .shortPath
    @Published private(set) var editingQSOID: UUID?
    @Published private(set) var canUndoDelete = false

    private let settingsStore = SettingsStore()
    private let secrets = SecretStore()
    private var database: LogbookDatabase?
    private var lookupTask: Task<Void, Never>?
    private var rotorTurnTask: Task<Void, Never>?
    private var ctyResolver = try? CTYResolver.bundled()
    private var syncTimer: Timer?
    private var radioTimer: Timer?
    private var clusterFeedTimer: Timer?
    private var weatherTimer: Timer?
    private var editingOriginal: QSO?
    private var lastDeleted: QSO?
    private var callContext = ""
    private var automaticCallFields = AutomaticCallFields()
    private var lastDraftRadioSnapshot: RadioSnapshot?
    private var pauseDraftRadioFollowUntil: Date?
    private var lastAutomaticRotorTarget = ""
    private var forwardedFlexSpotIDs: Set<UUID> = []
    private var transmitPowerCapture = TransmitPowerCapture()
    private var radioPollInFlight = false
    private var tuneInFlight = false
    private var lastReportedRadioSnapshot: RadioSnapshot?
    private var isRestoringDraft = false
    private let savedDraftKey = "OM0RX-xLog.savedQSODraft.v1"
    private let activityKey = "OM0RX-xLog.operatorActivity.v1"
    private var spotTuneGeneration = UUID()

    var isEditing: Bool { editingQSOID != nil }

    var currentRotorSolution: GreatCircleSolution? {
        let configuredHome = settings.gridSquare.isEmpty ? (stationSnapshot?.rotor.homeGrid ?? "") : settings.gridSquare
        guard let home = MaidenheadLocator.coordinate(configuredHome),
              let dxLatitude, let dxLongitude else { return nil }
        return GreatCircle.solve(
            from: GeoCoordinate(latitude: home.latitude, longitude: home.longitude),
            to: GeoCoordinate(latitude: dxLatitude, longitude: dxLongitude)
        )
    }

    var currentRotorBearing: Double? {
        guard let solution = currentRotorSolution else { return nil }
        return rotorPath == .shortPath ? solution.shortPathBearing : solution.longPathBearing
    }

    init() {
        settings = settingsStore.load()
        dxccEntities = ctyResolver?.entities ?? []
        dxccBoundaries = (try? DXCCBoundaryStore.bundled()) ?? []
        let defaults = UserDefaults.standard
        let legacyBands = defaults.stringArray(forKey: "OM0RX-xLog.bandMapBands")
        bandMapBands = defaults.stringArray(forKey: "OM0RX-xLog.deskBandMapBands") ?? ["20m"]
        detachedBandMapBands = defaults.stringArray(forKey: "OM0RX-xLog.detachedBandMapBands")
            ?? legacyBands
            ?? Array(BandPlan.bands.prefix(10))
        deskBandMapFollowsRadio = (defaults.object(forKey: "OM0RX-xLog.deskBandMapFollowsRadio") as? Bool) ?? true
        detachedBandMapLayout = defaults.string(forKey: "OM0RX-xLog.detachedBandMapLayout")
            .flatMap(BandMapLayout.init(rawValue:)) ?? .adaptiveGrid
        let storedBandMapScale = UserDefaults.standard.double(forKey: "OM0RX-xLog.bandMapFontScale")
        bandMapFontScale = storedBandMapScale == 0 ? 1 : min(2, max(0.8, storedBandMapScale))
        mapDisplayPreset = defaults.string(forKey: "OM0RX-xLog.mapDisplayPreset")
            .flatMap(MapDisplayPreset.init(rawValue:)) ?? .detailed
        intelligenceBands = defaults.stringArray(forKey: "OM0RX-xLog.intelligenceBands")
            ?? ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m"]
        clusterSpotOpensFullEditor = defaults.bool(forKey: "OM0RX-xLog.clusterSpotOpensFullEditor")
        sendSpotsToFlex = defaults.object(forKey: "OM0RX-xLog.sendSpotsToFlex") as? Bool ?? true
        automaticallyTurnRotor = defaults.object(forKey: "OM0RX-xLog.automaticallyTurnRotor") as? Bool ?? true
        flexSpotPort = defaults.object(forKey: "OM0RX-xLog.flexSpotPort") as? Int ?? 12_062
        wavelogToken = (try? secrets.load(.wavelogToken)) ?? ""
        qrzPassword = (try? secrets.load(.qrzPassword)) ?? ""
        clubLogAPIKey = (try? secrets.load(.clubLogAPIKey)) ?? ""
        syncStatus = isWavelogConfigured ? "Ready" : "Not configured"
        draft.operatorCall = settings.operatorCall
        draft.stationLocation = settings.stationLocation
        draft.radio = settings.defaultRadio
        draft.txPower = settings.defaultPower
        draft.antennaPath = rotorPath.adifValue
        if let data = defaults.data(forKey: activityKey),
           let savedEvents = try? JSONDecoder().decode([OperatorEvent].self, from: data) {
            activityEvents = Array(savedEvents.prefix(80))
        }
        restoreSavedDraft()
        do {
            database = try LogbookDatabase()
            reload()
        } catch {
            banner = AppBanner(message: error.localizedDescription, kind: .error)
        }
        configureTimers()
        Task {
            await pollRadio()
            var shouldRefreshReferenceData = false
            if let updater = try? ReferenceDataUpdater() {
                referenceState = await updater.currentState()
                loadDownloadedCTY()
                loadActivationDirectories()
                let lotwStale = referenceState.lotwUpdatedAt.map { Date().timeIntervalSince($0) > 7 * 86_400 } ?? true
                let clubStale = referenceState.clubLogUpdatedAt.map { Date().timeIntervalSince($0) > 86_400 } ?? true
                let activationStale = [ActivationReferenceKind.pota, .sota, .iota, .wwff].contains { kind in
                    referenceState.activationUpdatedAt[kind.rawValue].map { Date().timeIntervalSince($0) > 7 * 86_400 } ?? true
                }
                shouldRefreshReferenceData = lotwStale || (!clubLogAPIKey.isEmpty && clubStale) || activationStale
            }
            if settings.automaticSync, isWavelogConfigured {
                await synchronize()
            }
            if shouldRefreshReferenceData {
                await refreshReferenceData()
            }
        }
    }

    deinit {
        syncTimer?.invalidate()
        radioTimer?.invalidate()
        clusterFeedTimer?.invalidate()
        weatherTimer?.invalidate()
        lookupTask?.cancel()
        rotorTurnTask?.cancel()
    }

    func reload() {
        guard let database else { return }
        do {
            qsos = try database.fetch(limit: 2_000, search: search)
            stats = try database.stats()
            awardProgress = try database.awardProgress()
            refreshCallContext()
            conflicts = try database.conflicts()
            outbox = try database.outboxEntries()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func searchChanged() { reload() }

    func callChanged() {
        draft.call = draft.call.uppercased()
        if callContext != draft.call {
            if !callContext.isEmpty, !isEditing {
                let enteredCall = draft.call
                let timestamp = draft.timestamp
                let frequency = draft.frequency
                let band = draft.band
                let mode = draft.mode
                draft.resetKeepingStation()
                draft.call = enteredCall
                draft.timestamp = timestamp
                draft.frequency = frequency
                draft.band = band
                draft.mode = mode
            }
            clearAutomaticCallFields()
            callContext = draft.call
            rotorPath = .shortPath
            draft.antennaPath = rotorPath.adifValue
            lastAutomaticRotorTarget = ""
            resetTransmitPowerCapture()
            if draft.call.isEmpty {
                qsoSession = QSOSessionState()
            } else if !isEditing {
                qsoSession = QSOSessionState(phase: .active, startedAt: draft.timestamp, lastActivityAt: Date())
            }
        }
        lookupStatus = "Ready"
        dxLatitude = nil
        dxLongitude = nil
        dxLocationSource = .none
        if let country = ctyResolver?.resolve(draft.call, at: draft.timestamp) {
            if draft.country.isEmpty {
                draft.country = country.name.capitalized
                automaticCallFields.country = draft.country
            }
            if draft.dxcc.isEmpty {
                draft.dxcc = String(country.adif)
                automaticCallFields.dxcc = draft.dxcc
            }
            if draft.continent.isEmpty {
                draft.continent = country.continent
                automaticCallFields.continent = draft.continent
            }
            if draft.cqZone.isEmpty, country.cqZone > 0 {
                draft.cqZone = String(country.cqZone)
                automaticCallFields.cqZone = draft.cqZone
            }
            if draft.ituZone.isEmpty, country.ituZone > 0 {
                draft.ituZone = String(country.ituZone)
                automaticCallFields.ituZone = draft.ituZone
            }
            dxLatitude = country.latitude
            dxLongitude = country.longitude
            if country.latitude != nil, country.longitude != nil {
                dxLocationSource = .ctyApproximate
            }
        }
        refreshCallContext()
        lookupTask?.cancel()
        guard draft.call.count >= 3 else { return }
        let call = draft.call
        guard settings.qrzEnabled, !settings.qrzUsername.isEmpty, !qrzPassword.isEmpty else {
            lookupStatus = dxLatitude == nil ? "Ready" : "CTY matched"
            scheduleAutomaticRotorTurn(for: call)
            return
        }
        lookupStatus = "Waiting…"
        lookupTask = Task {
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled, call == draft.call else { return }
            await lookupCallsign(call)
        }
    }

    func readRadio() { Task { await pollRadio(copyToDraft: true) } }

    func activationReference(_ kind: ActivationReferenceKind, value: String) -> ActivationReference? {
        activationDirectory.exactMatch(value, kind: kind)
    }

    func hasActivationDirectory(_ kind: ActivationReferenceKind) -> Bool {
        activationDirectory.hasData(for: kind)
    }

    func activationReferenceSuggestions(_ kind: ActivationReferenceKind, value: String, limit: Int = 3) -> [ActivationReference] {
        activationDirectory.prefixMatches(value, kind: kind, limit: limit)
    }

    func useActivationReferenceLocation(_ reference: ActivationReference) {
        guard let latitude = reference.latitude, let longitude = reference.longitude else {
            banner = AppBanner(message: "\(reference.reference) does not publish a map location.", kind: .warning)
            return
        }
        dxLatitude = latitude
        dxLongitude = longitude
        dxLocationSource = .activationReference(reference.kind.label)
        if !reference.grid.isEmpty {
            draft.gridSquare = reference.grid.uppercased()
            automaticCallFields.gridSquare = draft.gridSquare
        }
        lastAutomaticRotorTarget = ""
        banner = AppBanner(
            message: "Using \(reference.reference) · \(reference.name) for this QSO's map target. Rotor movement remains manual.",
            kind: .info
        )
    }

    func performStationAction(_ action: String) {
        Task {
            let started = Date()
            do {
                try await sendStationAction(action)
                appendActivity(.init(kind: .station, title: "Station command accepted", detail: action.replacingOccurrences(of: "_", with: " "), duration: Date().timeIntervalSince(started)))
                banner = AppBanner(message: "Station \(action.replacingOccurrences(of: "_", with: " ")) accepted by xCat", kind: .success)
            } catch {
                appendActivity(.init(kind: .station, title: "Station command rejected", detail: "\(action): \(error.localizedDescription)", duration: Date().timeIntervalSince(started), succeeded: false))
                banner = AppBanner(message: "xCat rejected station \(action): \(error.localizedDescription)", kind: .error)
            }
        }
    }

    func turnRotorToCurrentDX(path: RotorPathSelection? = nil) {
        if let path {
            rotorPath = path
            draft.antennaPath = path.adifValue
        }
        guard let bearing = currentRotorBearing else {
            banner = AppBanner(message: "Set the station grid and load a DX callsign before turning the rotor.", kind: .warning)
            return
        }
        let targetBand = draft.band.isEmpty ? (radioSnapshot.map { BandPlan.band(for: $0.transmitFrequencyHz) } ?? "Other") : draft.band
        performStationAction(String(format: "rotor_goto %.1f %@", bearing, targetBand))
    }

    func addBandMap(_ band: String, detached: Bool = false) {
        if detached {
            guard !detachedBandMapBands.contains(band) else { return }
            detachedBandMapBands.append(band)
        } else {
            deskBandMapFollowsRadio = false
            guard !bandMapBands.contains(band) else { return }
            bandMapBands.append(band)
        }
        saveBandMaps()
    }

    func showAllBandMaps(detached: Bool = false) {
        if detached {
            detachedBandMapBands = BandPlan.bands
        } else {
            deskBandMapFollowsRadio = false
            bandMapBands = BandPlan.bands
        }
        saveBandMaps()
    }

    func setIntelligenceBand(_ band: String, enabled: Bool) {
        if enabled {
            guard !intelligenceBands.contains(band) else { return }
            intelligenceBands.append(band)
            intelligenceBands.sort { (BandPlan.bands.firstIndex(of: $0) ?? .max) < (BandPlan.bands.firstIndex(of: $1) ?? .max) }
        } else {
            guard intelligenceBands.count > 1 else { return }
            intelligenceBands.removeAll { $0 == band }
        }
        UserDefaults.standard.set(intelligenceBands, forKey: "OM0RX-xLog.intelligenceBands")
    }

    func setClusterSpotOpensFullEditor(_ enabled: Bool) {
        clusterSpotOpensFullEditor = enabled
        UserDefaults.standard.set(enabled, forKey: "OM0RX-xLog.clusterSpotOpensFullEditor")
    }

    func setSendSpotsToFlex(_ enabled: Bool) {
        sendSpotsToFlex = enabled
        UserDefaults.standard.set(enabled, forKey: "OM0RX-xLog.sendSpotsToFlex")
        flexSpotStatus = enabled ? "Ready to send xCluster spots" : "FLEX spot forwarding off"
        if enabled { loadClusterFeed() }
    }

    func setAutomaticallyTurnRotor(_ enabled: Bool) {
        automaticallyTurnRotor = enabled
        UserDefaults.standard.set(enabled, forKey: "OM0RX-xLog.automaticallyTurnRotor")
        if !enabled {
            rotorTurnTask?.cancel()
            spotWorkflowStatus = "Automatic rotor movement off"
        } else {
            spotWorkflowStatus = "Following live radio · automatic rotor ready"
        }
    }

    func setFlexSpotPort(_ port: Int) {
        flexSpotPort = min(max(port, 1), 65_535)
        UserDefaults.standard.set(flexSpotPort, forKey: "OM0RX-xLog.flexSpotPort")
    }

    func removeBandMap(_ band: String, detached: Bool = false) {
        let bands = detached ? detachedBandMapBands : bandMapBands
        guard bands.count > 1 else {
            banner = AppBanner(message: "Keep at least one band map open.", kind: .warning)
            return
        }
        if detached {
            detachedBandMapBands.removeAll { $0 == band }
        } else {
            deskBandMapFollowsRadio = false
            bandMapBands.removeAll { $0 == band }
        }
        saveBandMaps()
    }

    func setBandMap(_ band: String, enabled: Bool, detached: Bool = false) {
        enabled ? addBandMap(band, detached: detached) : removeBandMap(band, detached: detached)
    }

    func setDeskBandMapFollowsRadio(_ enabled: Bool) {
        deskBandMapFollowsRadio = enabled
        if enabled, let snapshot = radioSnapshot {
            let band = BandPlan.band(for: snapshot.frequencyHz)
            if !band.isEmpty { bandMapBands = [band] }
        }
        saveBandMaps()
    }

    func setDetachedBandMapLayout(_ layout: BandMapLayout) {
        detachedBandMapLayout = layout
        UserDefaults.standard.set(layout.rawValue, forKey: "OM0RX-xLog.detachedBandMapLayout")
    }

    func setBandMapFontScale(_ value: Double) {
        bandMapFontScale = min(2, max(0.8, (value * 10).rounded() / 10))
        UserDefaults.standard.set(bandMapFontScale, forKey: "OM0RX-xLog.bandMapFontScale")
    }

    func setMapDisplayPreset(_ preset: MapDisplayPreset) {
        mapDisplayPreset = preset
        UserDefaults.standard.set(preset.rawValue, forKey: "OM0RX-xLog.mapDisplayPreset")
    }

    func openClusterSpot(_ spot: ClusterSpot) {
        let awards = AwardReferenceParser.extract(comment: spot.comment, specialTags: spot.specialTags)
        var components = URLComponents()
        components.scheme = "om0rx-xlog"; components.host = "spot"
        components.queryItems = [
            URLQueryItem(name: "call", value: spot.callsign),
            URLQueryItem(name: "frequency", value: String(format: "%.6f", spot.frequencyKHz / 1_000)),
            URLQueryItem(name: "mode", value: spot.mode),
            URLQueryItem(name: "comment", value: spot.comment),
            URLQueryItem(name: "references", value: spot.comment),
            URLQueryItem(name: "special", value: spot.specialTags.joined(separator: ",")),
            URLQueryItem(name: "iota", value: awards.iota),
            URLQueryItem(name: "sota", value: awards.sota),
            URLQueryItem(name: "pota", value: awards.pota),
            URLQueryItem(name: "wwff", value: awards.wwff),
            URLQueryItem(name: "sig", value: awards.sig),
            URLQueryItem(name: "sig_info", value: awards.sigInfo),
        ]
        if let url = components.url { handleOpenURL(url) }
        dxLatitude = spot.latitude ?? dxLatitude
        dxLongitude = spot.longitude ?? dxLongitude
        scheduleAutomaticRotorTurn(for: spot.callsign.uppercased(), delay: .zero)
    }

    func handleOpenURL(_ url: URL) {
        let started = Date()
        guard url.scheme?.lowercased() == "om0rx-xlog", url.host?.lowercased() == "spot",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let values = (components.queryItems ?? []).reduce(into: [String: String]()) { result, item in
            if let value = item.value { result[item.name.lowercased()] = value }
        }
        clearCurrentQSO(copyLiveRadio: false)
        if let call = values["call"] { draft.call = call.uppercased() }
        if let frequency = values["frequency"] ?? values["freq"], let hz = BandPlan.frequencyHz(from: frequency) {
            draft.frequency = String(format: "%.6f", Double(hz) / 1_000_000)
            let band = BandPlan.band(for: hz)
            if !band.isEmpty { draft.band = band }
        }
        if let mode = values["mode"] { draft.mode = mode.uppercased() }
        if let note = values["comment"] ?? values["note"] { draft.comment = note }
        let specialTags = values["special"]?.split(separator: ",").map(String.init) ?? []
        let awards = AwardReferenceParser.extract(comment: values["references"] ?? draft.comment, specialTags: specialTags)
        draft.iota = values["iota"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.iota
        draft.sota = values["sota"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.sota
        draft.pota = values["pota"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.pota
        draft.wwff = values["wwff"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.wwff
        draft.sig = values["sig"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.sig
        draft.sigInfo = values["sig_info"].flatMap { $0.isEmpty ? nil : $0 } ?? awards.sigInfo
        callChanged()
        appendActivity(.init(
            kind: .tune,
            title: "Cluster spot received",
            detail: "\(draft.call) · \(draft.frequency) MHz · \(draft.mode)"
        ))
        destination = clusterSpotOpensFullEditor ? .log : .desk
        guard let frequencyHz = BandPlan.frequencyHz(from: draft.frequency) else { return }
        // Preserve the selected spot while xCat is changing the physical radio. Without
        // this short hand-off window the regular poll can briefly copy the old VFO back
        // into the log form before the tune command has completed.
        pauseDraftRadioFollowUntil = .distantFuture
        let generation = UUID()
        spotTuneGeneration = generation
        let targetMode = draft.mode
        let targetCall = draft.call
        spotWorkflowBusy = true
        spotWorkflowStatus = "Tuning \(targetCall) · \(draft.frequency) MHz and aiming rotor…"
        banner = AppBanner(message: spotWorkflowStatus, kind: .info)
        Task {
            guard spotTuneGeneration == generation else { return }
            tuneInFlight = true
            defer {
                if spotTuneGeneration == generation { tuneInFlight = false }
            }
            do {
                let client = XCatClient(host: settings.xcatHost, port: UInt16(clamping: settings.xcatRigCtlPort))
                try await client.tune(frequencyHz: frequencyHz, mode: targetMode)
                guard spotTuneGeneration == generation else { return }
                let commandDuration = Date().timeIntervalSince(started)
                appendActivity(.init(kind: .tune, title: "xCat accepted atomic tune", detail: "Frequency and mode accepted together", duration: commandDuration))
                try await client.waitForObservedSimplex(frequencyHz: frequencyHz, mode: targetMode)
                guard spotTuneGeneration == generation else { return }
                pauseDraftRadioFollowUntil = nil
                await pollRadio(copyToDraft: true)
                let duration = Date().timeIntervalSince(started)
                lastTuneLatencyMilliseconds = Int((duration * 1_000).rounded())
                spotWorkflowBusy = false
                spotWorkflowStatus = "\(targetCall) ready · \(draft.frequency) MHz · \(Int((duration * 1_000).rounded())) ms"
                appendActivity(.init(kind: .tune, title: "Spot tuned", detail: "\(draft.call) · \(draft.frequency) MHz · \(draft.mode)", duration: duration))
                banner = AppBanner(message: "\(targetCall) loaded; radio confirmed. \(automaticallyTurnRotor ? "Automatic rotor command sent when available." : "Rotor movement is manual.")", kind: .success)
            } catch {
                guard spotTuneGeneration == generation else { return }
                pauseDraftRadioFollowUntil = nil
                let duration = Date().timeIntervalSince(started)
                lastTuneLatencyMilliseconds = Int((duration * 1_000).rounded())
                spotWorkflowBusy = false
                spotWorkflowStatus = "Tune failed · \(error.localizedDescription)"
                appendActivity(.init(kind: .tune, title: "Spot tune failed", detail: error.localizedDescription, duration: duration, succeeded: false))
                banner = AppBanner(message: "\(draft.call) loaded; xCat tuning failed: \(error.localizedDescription)", kind: .error)
            }
        }
    }

    func logQSO(force: Bool = false) {
        guard let database else { return }
        var qso = makeDraftQSO()
        let call = qso.call
        let duplicate = isEditing ? nil : (try? database.possibleDuplicate(
            call: qso.call,
            band: qso.band,
            mode: qso.mode,
            around: qso.start
        ))
        validationIssues = QSOValidator.validate(qso, possibleDuplicate: duplicate)
        if validationIssues.contains(where: { $0.severity == .error }) {
            pendingLogConfirmation = false
            banner = AppBanner(message: validationIssues.first(where: { $0.severity == .error })?.message ?? "Correct the highlighted QSO fields.", kind: .error)
            appendActivity(.init(kind: .validation, title: "QSO validation blocked logging", detail: validationIssues.map(\.message).joined(separator: " "), succeeded: false))
            return
        }
        if !force, validationIssues.contains(where: { $0.severity == .warning }) {
            pendingLogConfirmation = true
            appendActivity(.init(kind: .validation, title: "QSO needs confirmation", detail: validationIssues.map(\.message).joined(separator: " "), succeeded: false))
            return
        }
        pendingLogConfirmation = false
        qso = applyingStationMetadata(to: qso)
        do {
            try database.save(qso)
            banner = AppBanner(message: isEditing ? "\(call) updated locally" : "\(call) saved locally", kind: .success)
            appendActivity(.init(kind: .draft, title: isEditing ? "QSO updated locally" : "QSO logged locally", detail: "\(call) · \(qso.band) \(qso.mode)"))
            editingOriginal = nil
            editingQSOID = nil
            draft.resetKeepingStation()
            resetTransmitPowerCapture()
            callContext = ""
            automaticCallFields = AutomaticCallFields()
            lookupStatus = "Ready"
            draft.timestamp = Date()
            qsoSession = QSOSessionState()
            validationIssues = []
            UserDefaults.standard.removeObject(forKey: savedDraftKey)
            reload()
            if settings.automaticSync { Task { await synchronize() } }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func edit(_ qso: QSO) {
        transmitPowerCapture.reset()
        editingOriginal = qso
        editingQSOID = qso.id
        draft = QSOFormState(qso: qso)
        qsoSession = QSOSessionState(phase: .editing, startedAt: qso.start, lastActivityAt: Date())
        rotorPath = qso.antennaPath.uppercased().hasPrefix("L") ? .longPath : .shortPath
        callContext = draft.call
        automaticCallFields = AutomaticCallFields()
        lookupStatus = "Ready"
        destination = .log
        refreshCallContext()
        banner = AppBanner(message: "Editing \(qso.call). Save to update the local record.", kind: .info)
    }

    func cancelEditing() {
        clearCurrentQSO()
    }

    func clearCurrentQSO(copyLiveRadio: Bool = true) {
        editingOriginal = nil
        editingQSOID = nil
        draft.resetKeepingStation()
        resetTransmitPowerCapture()
        callContext = ""
        automaticCallFields = AutomaticCallFields()
        lookupStatus = "Ready"
        draft.timestamp = Date()
        dxLatitude = nil
        dxLongitude = nil
        dxLocationSource = .none
        rotorPath = .shortPath
        draft.antennaPath = rotorPath.adifValue
        lastAutomaticRotorTarget = ""
        qsoSession = QSOSessionState()
        validationIssues = []
        pendingLogConfirmation = false
        UserDefaults.standard.removeObject(forKey: savedDraftKey)
        if copyLiveRadio, let radioSnapshot {
            applyRadioSnapshotToDraft(radioSnapshot)
        }
        refreshCallContext()
    }

    func delete(_ qso: QSO) {
        do {
            try database?.softDelete(qso)
            lastDeleted = qso
            canUndoDelete = true
            banner = AppBanner(message: "\(qso.call) moved out of the active log. Undo is available in Logbook.", kind: .warning)
            reload()
            if settings.automaticSync { Task { await synchronize() } }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func undoLastDelete() {
        guard let qso = lastDeleted else { return }
        do {
            try database?.save(qso)
            lastDeleted = nil
            canUndoDelete = false
            banner = AppBanner(message: "\(qso.call) restored", kind: .success)
            reload()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func resolve(_ conflict: SyncConflict, useRemote: Bool) {
        do {
            try database?.resolveConflict(conflict, useRemote: useRemote)
            banner = AppBanner(message: useRemote ? "Wavelog version accepted" : "Local version kept for the next sync", kind: .success)
            reload()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func resolve(_ conflict: SyncConflict, remoteFields: Set<String>) {
        do {
            let merged = try QSOConflictMerge.merge(conflict, remoteFields: remoteFields)
            try database?.resolveConflict(conflict, merged: merged)
            banner = AppBanner(message: "Merged \(conflict.localQSO.call); the selected fields will upload on the next sync.", kind: .success)
            reload()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func retrySync(_ entry: SyncOutboxEntry) {
        do {
            try database?.retrySync(localID: entry.id)
            appendActivity(.init(kind: .sync, title: "Retry requested", detail: entry.qso.call))
            reload()
            Task { await synchronize() }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func saveSettings() {
        settingsStore.save(settings)
        do {
            try secrets.save(wavelogToken, for: .wavelogToken)
            try secrets.save(qrzPassword, for: .qrzPassword)
            try secrets.save(clubLogAPIKey, for: .clubLogAPIKey)
            draft.operatorCall = settings.operatorCall
            draft.stationLocation = settings.stationLocation
            draft.radio = settings.defaultRadio
            draft.txPower = settings.defaultPower
            transmitPowerCapture.reset()
            if let station = stationSnapshot?.station, !isEditing {
                updateDraftTransmitPower(from: station)
            }
            banner = AppBanner(message: "Settings saved", kind: .success)
            configureTimers()
            syncStatus = isWavelogConfigured ? "Ready" : "Not configured"
            if settings.automaticSync, isWavelogConfigured {
                Task { await synchronize() }
            }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func synchronize() async {
        guard !isWorking else { return }
        guard let database, let baseURL = URL(string: settings.wavelogURL), settings.wavelogStationID > 0, !wavelogToken.isEmpty else {
            syncStatus = "Configure Wavelog"
            return
        }
        isWorking = true; syncStatus = "Syncing…"
        let started = Date()
        defer { isWorking = false }
        do {
            let config = try WavelogConfiguration(baseURL: baseURL, token: wavelogToken, stationID: settings.wavelogStationID)
            let report = try await SyncEngine(database: database, configuration: config).synchronize()
            lastSyncReport = report
            syncStatus = report.failed > 0 ? "\(report.failed) retrying" : (report.conflicts == 0 ? "Up to date" : "Needs review")
            appendActivity(.init(
                kind: .sync,
                title: report.failed > 0 ? "Wavelog sync completed with retries" : "Wavelog sync completed",
                detail: "\(report.pushed) sent · \(report.pulled) read · \(report.conflicts) conflicts · \(report.failed) failed",
                duration: Date().timeIntervalSince(started),
                succeeded: report.failed == 0
            ))
            if let updater = try? ReferenceDataUpdater(),
               let catalogState = try? await updater.refreshWavelogCatalog(baseURL: baseURL, token: wavelogToken) {
                referenceState = catalogState
            }
            reload()
            syncStatus = outbox.isEmpty
                ? (report.conflicts == 0 ? "Up to date" : "Needs review")
                : "\(outbox.count) waiting"
            if report.conflicts > 0 {
                banner = AppBanner(message: "\(report.conflicts) sync conflict\(report.conflicts == 1 ? "" : "s") need review.", kind: .warning)
                destination = .sync
            }
        } catch {
            syncStatus = "Sync failed"
            appendActivity(.init(kind: .sync, title: "Wavelog sync failed", detail: error.localizedDescription, duration: Date().timeIntervalSince(started), succeeded: false))
            banner = AppBanner(message: error.localizedDescription, kind: .error)
        }
    }

    func refreshReferenceData() async {
        guard let club = URL(string: settings.clubLogCTYURL), let lotw = URL(string: settings.lotwActivityURL) else {
            banner = AppBanner(message: "Reference-data URLs are invalid.", kind: .error); return
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let updater = try ReferenceDataUpdater()
            if clubLogAPIKey.isEmpty {
                referenceState = try await updater.refreshLoTW(lotw)
            } else {
                referenceState = try await updater.refresh(clubLogURL: club, clubLogAPIKey: clubLogAPIKey, lotwURL: lotw)
                loadDownloadedCTY()
            }
            referenceState = try await updater.refreshActivationDirectories()
            loadActivationDirectories()
            let directoryCount = referenceState.activationCounts.values.reduce(0, +)
            let clubMessage = clubLogAPIKey.isEmpty ? " CTY was not refreshed because no Club Log API key is configured." : ""
            banner = AppBanner(message: "Reference data updated: \(directoryCount.formatted()) activation references.\(clubMessage)", kind: clubLogAPIKey.isEmpty ? .warning : .success)
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    private func loadActivationDirectories() {
        guard let directory = try? ReferenceDataUpdater.defaultDirectory(),
              let loaded = try? ActivationReferenceDirectory(directory: directory) else { return }
        activationDirectory = loaded
    }

    func importADIF() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.data]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url, let text = try? String(contentsOf: url) else { return }
        let records = ADIFParser().records(in: text)
        do {
            for record in records {
                if var qso = QSO(adif: record) {
                    qso.isDirty = true
                    try database?.save(qso)
                }
            }
            banner = AppBanner(message: "Imported \(records.count) ADIF records", kind: .success)
            reload()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func exportADIF() {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = "OM0RX-xLog-export.adi"
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let body = qsos.map(\.adifRecord.adifDocument).joined()
        do {
            try body.write(to: url, atomically: true, encoding: .utf8)
            banner = AppBanner(message: "Exported \(qsos.count) QSOs", kind: .success)
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func createVerifiedBackup() {
        guard !isWorking, let database else { return }
        let panel = NSSavePanel()
        panel.title = "Create verified xLog backup"
        panel.prompt = "Create Backup"
        panel.canCreateDirectories = true
        if let backupType = UTType(filenameExtension: XLogBackupManager.packageExtension) {
            panel.allowedContentTypes = [backupType]
        }
        panel.nameFieldStringValue = "OM0RX-xLog-\(backupTimestamp()).\(XLogBackupManager.packageExtension)"
        guard panel.runModal() == .OK, var destination = panel.url else { return }
        if destination.pathExtension.lowercased() != XLogBackupManager.packageExtension {
            destination.appendPathExtension(XLogBackupManager.packageExtension)
        }

        let settings = settings
        let preferences = currentBackupPreferences()
        let referenceDataURL = try? ReferenceDataUpdater.defaultDirectory()
        let manager = XLogBackupManager()
        isWorking = true
        Task {
            do {
                let preview = try await Task.detached {
                    try manager.create(
                        database: database,
                        at: destination,
                        settings: settings,
                        preferences: preferences,
                        referenceDataURL: referenceDataURL
                    )
                }.value
                banner = AppBanner(
                    message: "Verified backup created: \(preview.manifest.qsoCount.formatted()) QSOs",
                    kind: .success
                )
            } catch {
                banner = AppBanner(message: error.localizedDescription, kind: .error)
            }
            isWorking = false
        }
    }

    func inspectBackupForRestore() {
        guard !isWorking else { return }
        let panel = NSOpenPanel()
        panel.title = "Inspect an xLog backup"
        panel.prompt = "Inspect Backup"
        panel.canChooseFiles = true
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }

        let manager = XLogBackupManager()
        isWorking = true
        Task {
            do {
                pendingRestorePreview = try await Task.detached {
                    try manager.inspect(at: url)
                }.value
                restoreSettingsFromBackup = pendingRestorePreview?.settings != nil
                restoreWorkspaceFromBackup = pendingRestorePreview?.preferences != nil
            } catch {
                banner = AppBanner(message: error.localizedDescription, kind: .error)
            }
            isWorking = false
        }
    }

    func cancelPendingRestore() {
        pendingRestorePreview = nil
    }

    func restorePendingBackup() {
        guard !isWorking,
              let preview = pendingRestorePreview,
              let database else { return }
        let liveURL = database.url
        let currentSettings = settings
        let currentPreferences = currentBackupPreferences()
        let restoreSettings = restoreSettingsFromBackup
        let restoreWorkspace = restoreWorkspaceFromBackup
        let manager = XLogBackupManager()
        let supportDirectory = liveURL.deletingLastPathComponent()
        let recoveryDirectory = supportDirectory.appendingPathComponent("Recovery", isDirectory: true)
        let recoveryURL = recoveryDirectory.appendingPathComponent(
            "OM0RX-xLog-pre-restore-\(backupTimestamp())-\(UUID().uuidString.prefix(6)).\(XLogBackupManager.packageExtension)",
            isDirectory: true
        )
        let referenceDataURL = try? ReferenceDataUpdater.defaultDirectory()

        pendingRestorePreview = nil
        syncTimer?.invalidate()
        isWorking = true
        Task {
            do {
                _ = try await Task.detached {
                    try manager.create(
                        database: database,
                        at: recoveryURL,
                        settings: currentSettings,
                        preferences: currentPreferences,
                        referenceDataURL: referenceDataURL
                    )
                }.value
                database.close()
                self.database = nil

                _ = try await Task.detached {
                    try manager.installDatabase(from: preview.packageURL, to: liveURL)
                }.value
                if preview.manifest.includesReferenceData, let referenceDataURL {
                    _ = try await Task.detached {
                        try manager.installReferenceData(from: preview.packageURL, to: referenceDataURL)
                    }.value
                }

                self.database = try LogbookDatabase(url: liveURL)
                if restoreSettings, let restoredSettings = preview.settings {
                    settings = restoredSettings
                    settingsStore.save(restoredSettings)
                }
                if restoreWorkspace, let preferences = preview.preferences {
                    applyBackupPreferences(preferences)
                }
                loadDownloadedCTY()
                reload()
                configureTimers()
                banner = AppBanner(
                    message: "Restored \(preview.manifest.qsoCount.formatted()) QSOs. Pre-restore backup saved in Recovery.",
                    kind: .success
                )
            } catch {
                if self.database == nil {
                    self.database = try? LogbookDatabase(url: liveURL)
                }
                configureTimers()
                banner = AppBanner(message: error.localizedDescription, kind: .error)
            }
            isWorking = false
        }
    }

    private func refreshCallContext() {
        guard let database, !draft.call.isEmpty else {
            previous = []
            matrix = []
            dxccSummary = .empty
            return
        }
        previous = (try? database.previous(call: draft.call)) ?? []
        matrix = (try? database.bandModeMatrix(call: draft.call)) ?? []
        dxccSummary = Int(draft.dxcc).flatMap { try? database.dxccSummary(dxcc: $0) } ?? .empty
    }

    private func lookupCallsign(_ call: String) async {
        do {
            let profile = try await QRZClient(username: settings.qrzUsername, password: qrzPassword).lookup(call)
            guard draft.call == call else { return }
            if draft.name.isEmpty {
                draft.name = profile.name
                automaticCallFields.name = draft.name
            }
            if draft.gridSquare.isEmpty {
                draft.gridSquare = profile.gridSquare
                automaticCallFields.gridSquare = draft.gridSquare
            }
            if draft.country.isEmpty {
                draft.country = profile.country
                automaticCallFields.country = draft.country
            }
            if draft.dxcc.isEmpty {
                draft.dxcc = profile.dxcc.map(String.init) ?? ""
                automaticCallFields.dxcc = draft.dxcc
            }
            if draft.cqZone.isEmpty {
                draft.cqZone = profile.cqZone
                automaticCallFields.cqZone = draft.cqZone
            }
            if draft.ituZone.isEmpty {
                draft.ituZone = profile.ituZone
                automaticCallFields.ituZone = draft.ituZone
            }
            if draft.state.isEmpty {
                draft.state = profile.state
                automaticCallFields.state = draft.state
            }
            if draft.county.isEmpty {
                draft.county = profile.county
                automaticCallFields.county = draft.county
            }
            if draft.qth.isEmpty {
                draft.qth = profile.qth
                automaticCallFields.qth = draft.qth
            }
            if draft.email.isEmpty {
                draft.email = profile.email
                automaticCallFields.email = draft.email
            }
            if let coordinate = MaidenheadLocator.coordinate(profile.gridSquare) {
                dxLatitude = coordinate.latitude
                dxLongitude = coordinate.longitude
                dxLocationSource = .qrzGrid
            } else if let latitude = profile.latitude, let longitude = profile.longitude {
                dxLatitude = latitude
                dxLongitude = longitude
                dxLocationSource = .qrzCoordinates
            }
            lookupStatus = "QRZ matched"
            refreshCallContext()
            await automaticallyTurnRotor(for: call)
        } catch {
            lookupStatus = "QRZ unavailable"
            await automaticallyTurnRotor(for: call)
        }
    }

    private func scheduleAutomaticRotorTurn(for call: String, delay: Duration = .milliseconds(650)) {
        rotorTurnTask?.cancel()
        rotorTurnTask = Task {
            if delay != .zero {
                try? await Task.sleep(for: delay)
            }
            guard !Task.isCancelled else { return }
            await automaticallyTurnRotor(for: call)
        }
    }

    private func automaticallyTurnRotor(for call: String) async {
        guard draft.call == call,
              automaticallyTurnRotor else { return }
        if stationSnapshot == nil { await pollRadio() }
        guard let stationSnapshot,
              stationSnapshot.rotor.connected == true,
              stationSnapshot.station.allowedActions.contains("rotor_goto") else {
            stationStatus = "Rotor unavailable for automatic \(rotorPath.rawValue) turn"
            return
        }
        let targetBand = draft.band.isEmpty ? (radioSnapshot.map { BandPlan.band(for: $0.transmitFrequencyHz) } ?? "Other") : draft.band
        guard let request = AutomaticRotorTurnPlanner.request(
            enabled: automaticallyTurnRotor,
            call: call,
            bearing: currentRotorBearing,
            band: targetBand,
            path: rotorPath.rawValue
        ), request.signature != lastAutomaticRotorTarget else { return }
        appendActivity(.init(kind: .station, title: "Automatic rotor turn requested", detail: "\(call) · \(rotorPath.rawValue) · \(Int(request.bearing.rounded()))°"))
        do {
            let started = Date()
            try await sendStationAction(request.command)
            lastAutomaticRotorTarget = request.signature
            stationStatus = String(format: "%@ automatic %@ turn to %03.0f°", call, rotorPath.rawValue, request.bearing)
            appendActivity(.init(kind: .station, title: "Automatic rotor turn accepted", detail: stationStatus, duration: Date().timeIntervalSince(started)))
            if spotWorkflowBusy {
                spotWorkflowStatus = String(format: "Radio settling · rotor turning to %03.0f°", request.bearing)
            }
        } catch {
            stationStatus = "Automatic rotor turn rejected: \(error.localizedDescription)"
            appendActivity(.init(kind: .station, title: "Automatic rotor turn failed", detail: error.localizedDescription, succeeded: false))
            banner = AppBanner(message: stationStatus, kind: .error)
        }
    }

    private func sendStationAction(_ action: String) async throws {
        try await XCatClient(host: settings.xcatHost, port: UInt16(clamping: settings.xcatRigCtlPort))
            .stationAction(action)
        try? await Task.sleep(for: .milliseconds(350))
        await pollRadio()
    }

    private func clearAutomaticCallFields() {
        if draft.name == automaticCallFields.name { draft.name = "" }
        if draft.gridSquare == automaticCallFields.gridSquare { draft.gridSquare = "" }
        if draft.country == automaticCallFields.country { draft.country = "" }
        if draft.dxcc == automaticCallFields.dxcc { draft.dxcc = "" }
        if draft.continent == automaticCallFields.continent { draft.continent = "" }
        if draft.cqZone == automaticCallFields.cqZone { draft.cqZone = "" }
        if draft.ituZone == automaticCallFields.ituZone { draft.ituZone = "" }
        if draft.state == automaticCallFields.state { draft.state = "" }
        if draft.county == automaticCallFields.county { draft.county = "" }
        if draft.qth == automaticCallFields.qth { draft.qth = "" }
        if draft.email == automaticCallFields.email { draft.email = "" }
        automaticCallFields = AutomaticCallFields()
    }

    private func pollRadio(copyToDraft: Bool = false) async {
        if radioPollInFlight, copyToDraft {
            for _ in 0..<20 where radioPollInFlight {
                try? await Task.sleep(for: .milliseconds(50))
            }
        }
        guard !radioPollInFlight else { return }
        guard !tuneInFlight || copyToDraft else { return }
        radioPollInFlight = true
        let started = Date()
        defer { radioPollInFlight = false }
        do {
            let port = UInt16(clamping: settings.xcatRigCtlPort)
            let client = XCatClient(host: settings.xcatHost, port: port)
            let combinedSnapshot = try? await client.stationSnapshot()
            let snapshot: RadioSnapshot
            if let embedded = combinedSnapshot?.radio?.snapshot {
                snapshot = embedded
            } else {
                snapshot = try await client.snapshot()
            }
            radioSnapshot = snapshot
            radioStatus = "xCat live"
            if shouldRecordRadioEvent(snapshot) {
                appendActivity(.init(
                    kind: .radio,
                    title: "Radio state confirmed",
                    detail: "\(snapshot.displayFrequency) MHz · \(snapshot.mode)",
                    duration: Date().timeIntervalSince(started)
                ))
            }
            lastReportedRadioSnapshot = snapshot
            if let combinedSnapshot {
                stationSnapshot = combinedSnapshot
                stationStatus = "Station live"
                if !isEditing {
                    updateDraftTransmitPower(from: combinedSnapshot.station)
                }
                if settings.gridSquare.isEmpty,
                   let homeGrid = stationSnapshot?.rotor.homeGrid,
                   MaidenheadLocator.coordinate(homeGrid) != nil {
                    settings.gridSquare = homeGrid.uppercased()
                    settingsStore.save(settings)
                }
            } else {
                stationSnapshot = nil
                stationStatus = "Update xCat for station telemetry"
            }
            if deskBandMapFollowsRadio {
                let band = BandPlan.band(for: snapshot.frequencyHz)
                if !band.isEmpty, bandMapBands != [band] {
                    bandMapBands = [band]
                    saveBandMaps()
                }
            }
            let followIsPaused = pauseDraftRadioFollowUntil.map { $0 > Date() } ?? false
            let radioChanged = snapshot != lastDraftRadioSnapshot
            if copyToDraft || (!isEditing && !followIsPaused && radioChanged) {
                applyRadioSnapshotToDraft(snapshot)
            }
        } catch {
            radioSnapshot = nil
            radioStatus = "xCat offline"
            stationSnapshot = nil
            stationStatus = "xCat telemetry unavailable"
        }
    }

    private func shouldRecordRadioEvent(_ snapshot: RadioSnapshot) -> Bool {
        guard let previous = lastReportedRadioSnapshot else { return true }
        if previous.mode != snapshot.mode
            || previous.isSplit != snapshot.isSplit
            || previous.receiveVFO != snapshot.receiveVFO
            || previous.transmitVFO != snapshot.transmitVFO {
            return true
        }
        if BandPlan.band(for: previous.receiveFrequencyHz) != BandPlan.band(for: snapshot.receiveFrequencyHz)
            || BandPlan.band(for: previous.transmitFrequencyHz) != BandPlan.band(for: snapshot.transmitFrequencyHz) {
            return true
        }
        // Fine tuning inside a passband is normal operating motion, not a
        // diagnostic event. Spot tunes have their own end-to-end timing entry.
        return abs(previous.receiveFrequencyHz - snapshot.receiveFrequencyHz) >= 5_000
            || abs(previous.transmitFrequencyHz - snapshot.transmitFrequencyHz) >= 5_000
    }

    private func applyRadioSnapshotToDraft(_ snapshot: RadioSnapshot) {
        let oldFrequency = BandPlan.frequencyHz(from: draft.frequency)
        let oldBand = draft.band
        let loggingFrequency = snapshot.isSplit ? snapshot.transmitFrequencyHz : snapshot.receiveFrequencyHz
        let newBand = BandPlan.band(for: loggingFrequency)
        let radioRouteChanged = oldFrequency.map { $0 != loggingFrequency } ?? false
            || (!oldBand.isEmpty && oldBand != newBand)
        // Split operation legitimately exposes two frequencies for one active
        // contact. It must populate FREQ/FREQ_RX without looking like a band
        // change and clearing the callsign. A normal simplex QSY keeps the
        // existing new-contact reset behaviour.
        let belongsToActiveSplitSession = !draft.call.isEmpty && (snapshot.isSplit || !draft.rxFrequency.isEmpty)
        if radioRouteChanged, !belongsToActiveSplitSession, !isEditing, hasContactSpecificDraftData {
            draft.resetKeepingStation()
            resetTransmitPowerCapture()
            callContext = ""
            automaticCallFields = AutomaticCallFields()
            lookupStatus = "Ready"
            dxLatitude = nil
            dxLongitude = nil
            dxLocationSource = .none
            rotorPath = .shortPath
            draft.antennaPath = rotorPath.adifValue
            lastAutomaticRotorTarget = ""
        }
        let previousMode = draft.mode
        draft.frequency = String(format: "%.6f", Double(loggingFrequency) / 1_000_000)
        draft.band = newBand
        draft.mode = snapshot.mode
        if !draft.call.isEmpty {
            let route = snapshot.isSplit
                ? "TX \(snapshot.transmitVFO) \(String(format: "%.6f", Double(snapshot.transmitFrequencyHz) / 1_000_000)) / RX \(snapshot.receiveVFO) \(String(format: "%.6f", Double(snapshot.receiveFrequencyHz) / 1_000_000)) · \(snapshot.mode)"
                : "\(String(format: "%.6f", Double(snapshot.receiveFrequencyHz) / 1_000_000)) · \(snapshot.mode)"
            if qsoSession.routeHistory.last != route {
                qsoSession.routeHistory.append(route)
                if qsoSession.routeHistory.count > 12 { qsoSession.routeHistory.removeFirst() }
            }
        }
        if snapshot.isSplit {
            draft.rxFrequency = String(format: "%.6f", Double(snapshot.receiveFrequencyHz) / 1_000_000)
            draft.rxBand = BandPlan.band(for: snapshot.receiveFrequencyHz)
            qsoSession.lastActivityAt = Date()
        } else {
            draft.rxFrequency = ""
            draft.rxBand = ""
        }

        // Keep reports the operator has entered. Only migrate the normal 59/599
        // defaults when the live radio changes between phone/digital and CW.
        if previousMode != snapshot.mode,
           ["59", "599"].contains(draft.rstSent),
           ["59", "599"].contains(draft.rstReceived) {
            let report = snapshot.mode == "CW" ? "599" : "59"
            draft.rstSent = report
            draft.rstReceived = report
        }
        lastDraftRadioSnapshot = snapshot
    }

    private func resetTransmitPowerCapture() {
        transmitPowerCapture.reset()
        guard !isEditing else { return }
        if let station = stationSnapshot?.station {
            updateDraftTransmitPower(from: station, captureMeasuredOutput: false)
        } else {
            draft.txPower = settings.defaultPower
        }
    }

    private func updateDraftTransmitPower(
        from station: XCatStationSnapshot.Station,
        captureMeasuredOutput: Bool = true
    ) {
        guard !isEditing else { return }
        if captureMeasuredOutput, !draft.call.isEmpty, let measured = station.txPowerWatts, measured > 0 {
            if qsoSession.firstTransmitAt == nil { qsoSession.firstTransmitAt = Date() }
            qsoSession.peakPowerWatts = max(qsoSession.peakPowerWatts ?? 0, measured)
            qsoSession.lastActivityAt = Date()
        }
        draft.txPower = transmitPowerCapture.resolve(
            measuredOutputWatts: captureMeasuredOutput && !draft.call.isEmpty ? station.txPowerWatts : nil,
            configuredDriveWatts: station.rfDriveWatts,
            fallback: settings.defaultPower
        )
    }

    private var hasContactSpecificDraftData: Bool {
        !draft.call.isEmpty || !draft.name.isEmpty || !draft.comment.isEmpty
            || !draft.gridSquare.isEmpty || !draft.country.isEmpty || !draft.county.isEmpty
            || !draft.pota.isEmpty || !draft.sota.isEmpty || !draft.iota.isEmpty
            || !draft.wwff.isEmpty || !draft.sigInfo.isEmpty
    }

    var draftValidationPreview: [QSOValidationIssue] {
        guard hasContactSpecificDraftData else { return [] }
        let qso = makeDraftQSO()
        let duplicate = isEditing ? nil : (try? database?.possibleDuplicate(
            call: qso.call,
            band: qso.band,
            mode: qso.mode,
            around: qso.start
        )) ?? nil
        return QSOValidator.validate(qso, possibleDuplicate: duplicate)
    }

    var automaticStationMetadata: [(String, String)] {
        var values: [(String, String)] = []
        if let peak = qsoSession.peakPowerWatts {
            values.append(("Peak TX", String(format: peak.rounded() == peak ? "%.0f W" : "%.1f W", peak)))
        } else if !draft.txPower.isEmpty {
            values.append(("TX power", "\(draft.txPower) W"))
        }
        if let azimuth = stationSnapshot?.rotor.azimuth { values.append(("Antenna azimuth", String(format: "%03.0f°", azimuth))) }
        if let route = stationSnapshot?.station.routeDetail, !route.isEmpty { values.append(("Station route", route)) }
        if !draft.antennaPath.isEmpty { values.append(("Path", draft.antennaPath == "L" ? "Long" : "Short")) }
        return values
    }

    private func makeDraftQSO() -> QSO {
        var qso = QSO(
            id: editingOriginal?.id ?? UUID(),
            wavelogID: editingOriginal?.wavelogID,
            call: draft.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            start: draft.timestamp,
            end: editingOriginal?.end ?? (qsoSession.phase == .active ? Date() : nil),
            band: draft.band,
            mode: draft.mode,
            frequencyHz: BandPlan.frequencyHz(from: draft.frequency),
            receiveFrequencyHz: BandPlan.frequencyHz(from: draft.rxFrequency),
            receiveBand: draft.rxBand,
            rstSent: draft.rstSent,
            rstReceived: draft.rstReceived,
            name: draft.name,
            gridSquare: draft.gridSquare,
            country: draft.country,
            dxcc: Int(draft.dxcc),
            continent: draft.continent,
            cqZone: draft.cqZone,
            ituZone: draft.ituZone,
            state: draft.state,
            county: draft.county,
            qth: draft.qth,
            iota: draft.iota,
            sotaReference: draft.sota,
            potaReference: draft.pota,
            wwffReference: draft.wwff,
            sig: draft.sig,
            sigInfo: draft.sigInfo,
            dok: draft.dok,
            comment: draft.comment,
            notes: draft.notes,
            stationProfileID: settings.wavelogStationID > 0 ? settings.wavelogStationID : nil,
            stationLocation: draft.stationLocation,
            radio: draft.radio,
            txPower: qsoSession.peakPowerWatts.map { String(format: $0.rounded() == $0 ? "%.0f" : "%.1f", $0) } ?? draft.txPower,
            operatorCall: draft.operatorCall,
            myCall: settings.stationCall,
            myGrid: settings.gridSquare,
            propagationMode: draft.propagation,
            antennaPath: draft.antennaPath,
            email: draft.email,
            qslSent: draft.qslSent,
            qslReceived: draft.qslReceived,
            qslMethod: draft.qslMethod,
            qslVia: draft.qslVia,
            qslMessage: draft.qslMessage
        )
        qso.lotwSent = editingOriginal?.lotwSent ?? ""
        qso.lotwReceived = editingOriginal?.lotwReceived ?? ""
        qso.extraFields = editingOriginal?.extraFields ?? [:]
        return qso
    }

    private func applyingStationMetadata(to qso: QSO) -> QSO {
        var value = qso
        if let peak = qsoSession.peakPowerWatts {
            value.txPower = String(format: peak.rounded() == peak ? "%.0f" : "%.1f", peak)
        }
        if let azimuth = stationSnapshot?.rotor.azimuth {
            value.extraFields["ANT_AZ"] = String(format: "%.0f", azimuth)
        }
        if let route = stationSnapshot?.station.routeDetail, !route.isEmpty {
            value.extraFields["MY_ANTENNA"] = route
        }
        if !draft.radio.isEmpty { value.extraFields["MY_RIG"] = draft.radio }
        if let firstTransmitAt = qsoSession.firstTransmitAt {
            value.extraFields["APP_OM0RX_FIRST_TX"] = ISO8601DateFormatter().string(from: firstTransmitAt)
        }
        if let state = stationSnapshot?.station.coordinatorState, !state.isEmpty {
            value.extraFields["APP_OM0RX_STATION_STATE"] = state
        }
        if !qsoSession.routeHistory.isEmpty {
            value.extraFields["APP_OM0RX_ROUTE_HISTORY"] = qsoSession.routeHistory.joined(separator: " | ")
        }
        return value
    }

    private func persistDraftIfNeeded() {
        guard !isRestoringDraft else { return }
        guard hasContactSpecificDraftData else { return }
        var session = qsoSession
        if session.phase == .idle {
            session.phase = isEditing ? .editing : .active
            session.startedAt = draft.timestamp
        }
        session.lastActivityAt = Date()
        let envelope = SavedQSODraft(draft: draft, session: session, savedAt: Date())
        if let data = try? JSONEncoder().encode(envelope) {
            UserDefaults.standard.set(data, forKey: savedDraftKey)
        }
    }

    private func restoreSavedDraft() {
        guard let data = UserDefaults.standard.data(forKey: savedDraftKey),
              let envelope = try? JSONDecoder().decode(SavedQSODraft.self, from: data),
              Date().timeIntervalSince(envelope.savedAt) < 7 * 86_400 else { return }
        isRestoringDraft = true
        draft = envelope.draft
        qsoSession = envelope.session
        qsoSession.recoveredAt = Date()
        isRestoringDraft = false
        appendActivity(.init(kind: .draft, title: "Recovered unfinished QSO", detail: envelope.draft.call.isEmpty ? "Unsaved draft" : envelope.draft.call))
    }

    private func appendActivity(_ event: OperatorEvent) {
        activityEvents.insert(event, at: 0)
        if activityEvents.count > 80 { activityEvents.removeLast(activityEvents.count - 80) }
        if let data = try? JSONEncoder().encode(activityEvents) {
            UserDefaults.standard.set(data, forKey: activityKey)
        }
    }

    private func configureTimers() {
        radioTimer?.invalidate()
        radioTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.pollRadio() }
        }
        clusterFeedTimer?.invalidate()
        loadClusterFeed()
        clusterFeedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.loadClusterFeed() }
        }
        weatherTimer?.invalidate()
        Task { await refreshWeather() }
        weatherTimer = Timer.scheduledTimer(withTimeInterval: 15 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.refreshWeather() }
        }
        syncTimer?.invalidate()
        guard settings.automaticSync else { return }
        syncTimer = Timer.scheduledTimer(withTimeInterval: TimeInterval(max(1, settings.syncIntervalMinutes) * 60), repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.synchronize() }
        }
    }

    private var isWavelogConfigured: Bool {
        URL(string: settings.wavelogURL) != nil && settings.wavelogStationID > 0 && !wavelogToken.isEmpty
    }

    func refreshWeather() async {
        let grid = settings.gridSquare.isEmpty ? (stationSnapshot?.rotor.homeGrid ?? "") : settings.gridSquare
        guard let coordinate = MaidenheadLocator.coordinate(grid) else {
            if localWeather == nil { weatherStatus = "Configure station grid" }
            return
        }
        do {
            let weather = try await WeatherClient.fetch(latitude: coordinate.latitude, longitude: coordinate.longitude)
            localWeather = weather
            weatherStatus = "Updated \(weather.fetchedAt.formatted(date: .omitted, time: .shortened))"
        } catch {
            weatherStatus = localWeather == nil ? "Weather unavailable" : "Using last weather update"
        }
    }

    private func loadClusterFeed() {
        guard let snapshot = try? ClusterSpotFeed.read() else {
            clusterSpots = []; clusterConnectedCount = 0; clusterFeedUpdatedAt = nil
            return
        }
        clusterSpots = snapshot.spots
        clusterConnectedCount = snapshot.connectedClusters
        clusterFeedUpdatedAt = snapshot.generatedAt
        forwardNewSpotsToFlex(snapshot.spots)
    }

    private func forwardNewSpotsToFlex(_ spots: [ClusterSpot]) {
        guard sendSpotsToFlex else { return }
        let pending = spots.filter { !forwardedFlexSpotIDs.contains($0.id) }
        guard !pending.isEmpty else { return }
        var sent = 0
        do {
            for spot in pending {
                try FlexSpotForwarder.send(
                    spot,
                    host: settings.xcatHost,
                    port: UInt16(clamping: flexSpotPort)
                )
                forwardedFlexSpotIDs.insert(spot.id)
                sent += 1
            }
            flexSpotStatus = "Sent \(sent) new spot\(sent == 1 ? "" : "s") to xCat"
            forwardedFlexSpotIDs.formIntersection(Set(spots.map(\.id)))
        } catch {
            flexSpotStatus = "FLEX spot forwarding failed"
        }
    }

    private func saveBandMaps() {
        UserDefaults.standard.set(bandMapBands, forKey: "OM0RX-xLog.deskBandMapBands")
        UserDefaults.standard.set(detachedBandMapBands, forKey: "OM0RX-xLog.detachedBandMapBands")
        UserDefaults.standard.set(deskBandMapFollowsRadio, forKey: "OM0RX-xLog.deskBandMapFollowsRadio")
    }

    private func currentBackupPreferences() -> XLogBackupPreferences {
        XLogBackupPreferences(
            deskBandMapBands: bandMapBands,
            detachedBandMapBands: detachedBandMapBands,
            deskBandMapFollowsRadio: deskBandMapFollowsRadio,
            detachedBandMapLayout: detachedBandMapLayout.rawValue,
            bandMapFontScale: bandMapFontScale,
            intelligenceBands: intelligenceBands,
            clusterSpotOpensFullEditor: clusterSpotOpensFullEditor
        )
    }

    private func applyBackupPreferences(_ value: XLogBackupPreferences) {
        let supported = Set(BandPlan.bands)
        bandMapBands = value.deskBandMapBands.filter(supported.contains)
        if bandMapBands.isEmpty { bandMapBands = ["20m"] }
        detachedBandMapBands = value.detachedBandMapBands.filter(supported.contains)
        if detachedBandMapBands.isEmpty { detachedBandMapBands = ["20m"] }
        deskBandMapFollowsRadio = value.deskBandMapFollowsRadio
        detachedBandMapLayout = BandMapLayout(rawValue: value.detachedBandMapLayout) ?? .adaptiveGrid
        bandMapFontScale = min(2, max(0.8, value.bandMapFontScale))
        intelligenceBands = value.intelligenceBands.filter(supported.contains)
        if intelligenceBands.isEmpty { intelligenceBands = ["20m"] }
        clusterSpotOpensFullEditor = value.clusterSpotOpensFullEditor
        saveBandMaps()
        let defaults = UserDefaults.standard
        defaults.set(detachedBandMapLayout.rawValue, forKey: "OM0RX-xLog.detachedBandMapLayout")
        defaults.set(bandMapFontScale, forKey: "OM0RX-xLog.bandMapFontScale")
        defaults.set(intelligenceBands, forKey: "OM0RX-xLog.intelligenceBands")
        defaults.set(clusterSpotOpensFullEditor, forKey: "OM0RX-xLog.clusterSpotOpensFullEditor")
    }

    private func backupTimestamp() -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd-HHmmss"
        return formatter.string(from: Date())
    }

    private func loadDownloadedCTY() {
        guard let directory = try? ReferenceDataUpdater.defaultDirectory() else { return }
        let url = directory.appendingPathComponent("cty.xml")
        if let resolver = try? CTYResolver(xmlURL: url) {
            ctyResolver = resolver
            dxccEntities = resolver.entities
            callChanged()
        }
    }
}

private extension RadioSnapshot {
    var displayFrequency: String { String(format: "%.6f", Double(frequencyHz) / 1_000_000) }
}
