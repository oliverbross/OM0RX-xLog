import AppKit
import Foundation
import SwiftUI
import XLogCore

enum BandMapLayout: String, CaseIterable, Identifiable {
    case singleRow = "Single row"
    case adaptiveGrid = "Adaptive grid"
    var id: String { rawValue }
}

struct QSOFormState: Equatable {
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
    @Published var draft = QSOFormState()
    @Published var qsos: [QSO] = []
    @Published var stats = LogbookStats.empty
    @Published var previous: [QSO] = []
    @Published var matrix: Set<BandModeCell> = []
    @Published var search = ""
    @Published var settings: XLogSettings
    @Published var wavelogToken = ""
    @Published var qrzPassword = ""
    @Published var clubLogAPIKey = ""
    @Published var radioSnapshot: RadioSnapshot?
    @Published var radioStatus = "xCat offline"
    @Published var syncStatus = "Not configured"
    @Published var lookupStatus = "Ready"
    @Published var referenceState = ReferenceDataState()
    @Published var banner: AppBanner?
    @Published var isWorking = false
    @Published var lastSyncReport: SyncReport?
    @Published var conflicts: [SyncConflict] = []
    @Published var clusterSpots: [ClusterSpot] = []
    @Published var clusterConnectedCount = 0
    @Published var clusterFeedUpdatedAt: Date?
    @Published var bandMapBands: [String] = ["20m"]
    @Published var detachedBandMapBands: [String] = Array(BandPlan.bands.prefix(10))
    @Published var deskBandMapFollowsRadio = true
    @Published var detachedBandMapLayout: BandMapLayout = .adaptiveGrid
    @Published var bandMapFontScale: Double = 1
    @Published var dxccEntities: [CountryInfo] = []
    @Published var dxLatitude: Double?
    @Published var dxLongitude: Double?
    @Published private(set) var editingQSOID: UUID?
    @Published private(set) var canUndoDelete = false

    private let settingsStore = SettingsStore()
    private let secrets = SecretStore()
    private var database: LogbookDatabase?
    private var lookupTask: Task<Void, Never>?
    private var ctyResolver = try? CTYResolver.bundled()
    private var syncTimer: Timer?
    private var radioTimer: Timer?
    private var clusterFeedTimer: Timer?
    private var editingOriginal: QSO?
    private var lastDeleted: QSO?
    private var callContext = ""
    private var automaticCallFields = AutomaticCallFields()

    var isEditing: Bool { editingQSOID != nil }

    init() {
        settings = settingsStore.load()
        dxccEntities = ctyResolver?.entities ?? []
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
        wavelogToken = (try? secrets.load(.wavelogToken)) ?? ""
        qrzPassword = (try? secrets.load(.qrzPassword)) ?? ""
        clubLogAPIKey = (try? secrets.load(.clubLogAPIKey)) ?? ""
        syncStatus = isWavelogConfigured ? "Ready" : "Not configured"
        draft.operatorCall = settings.operatorCall
        draft.stationLocation = settings.stationLocation
        draft.radio = settings.defaultRadio
        draft.txPower = settings.defaultPower
        do {
            database = try LogbookDatabase()
            reload()
        } catch {
            banner = AppBanner(message: error.localizedDescription, kind: .error)
        }
        configureTimers()
        Task {
            await pollRadio()
            if settings.automaticSync, isWavelogConfigured {
                await synchronize()
            }
            if let updater = try? ReferenceDataUpdater() {
                referenceState = await updater.currentState()
                loadDownloadedCTY()
                let lotwStale = referenceState.lotwUpdatedAt.map { Date().timeIntervalSince($0) > 7 * 86_400 } ?? true
                let clubStale = referenceState.clubLogUpdatedAt.map { Date().timeIntervalSince($0) > 86_400 } ?? true
                if lotwStale || (!clubLogAPIKey.isEmpty && clubStale) {
                    await refreshReferenceData()
                }
            }
        }
    }

    deinit {
        syncTimer?.invalidate()
        radioTimer?.invalidate()
        clusterFeedTimer?.invalidate()
    }

    func reload() {
        guard let database else { return }
        do {
            qsos = try database.fetch(limit: 2_000, search: search)
            stats = try database.stats()
            refreshCallContext()
            conflicts = try database.conflicts()
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func searchChanged() { reload() }

    func callChanged() {
        draft.call = draft.call.uppercased()
        if callContext != draft.call {
            clearAutomaticCallFields()
            callContext = draft.call
        }
        lookupStatus = "Ready"
        dxLatitude = nil
        dxLongitude = nil
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
        }
        refreshCallContext()
        lookupTask?.cancel()
        guard settings.qrzEnabled, draft.call.count >= 3, !settings.qrzUsername.isEmpty, !qrzPassword.isEmpty else { return }
        lookupStatus = "Waiting…"
        let call = draft.call
        lookupTask = Task {
            try? await Task.sleep(for: .milliseconds(450))
            guard !Task.isCancelled, call == draft.call else { return }
            await lookupCallsign(call)
        }
    }

    func readRadio() { Task { await pollRadio(copyToDraft: true) } }

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

    func openClusterSpot(_ spot: ClusterSpot) {
        let previousDestination = destination
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
        if previousDestination == .desk || previousDestination == .map || previousDestination == .bandMaps {
            destination = previousDestination
        }
    }

    func handleOpenURL(_ url: URL) {
        guard url.scheme?.lowercased() == "om0rx-xlog", url.host?.lowercased() == "spot",
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return }
        let values = (components.queryItems ?? []).reduce(into: [String: String]()) { result, item in
            if let value = item.value { result[item.name.lowercased()] = value }
        }
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
        destination = .log
        guard let frequencyHz = BandPlan.frequencyHz(from: draft.frequency) else { return }
        Task {
            do {
                try await XCatClient(host: settings.xcatHost, port: UInt16(clamping: settings.xcatRigCtlPort))
                    .tune(frequencyHz: frequencyHz, mode: draft.mode)
                banner = AppBanner(message: "\(draft.call) loaded; xCat tuned radio and mode", kind: .success)
            } catch {
                banner = AppBanner(message: "\(draft.call) loaded; xCat tuning failed: \(error.localizedDescription)", kind: .error)
            }
        }
    }

    func logQSO() {
        guard let database else { return }
        let call = draft.call.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        guard !call.isEmpty else { banner = AppBanner(message: "Enter a callsign before logging.", kind: .warning); return }
        guard let frequencyHz = BandPlan.frequencyHz(from: draft.frequency) else {
            banner = AppBanner(message: "Enter a valid operating frequency.", kind: .warning); return
        }
        guard !draft.band.isEmpty, !draft.mode.isEmpty else {
            banner = AppBanner(message: "Choose both a band and mode.", kind: .warning); return
        }
        var qso = QSO(
            id: editingOriginal?.id ?? UUID(),
            wavelogID: editingOriginal?.wavelogID,
            call: call,
            start: draft.timestamp,
            band: draft.band,
            mode: draft.mode,
            frequencyHz: frequencyHz,
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
            txPower: draft.txPower,
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
        do {
            try database.save(qso)
            banner = AppBanner(message: isEditing ? "\(call) updated locally" : "\(call) saved locally", kind: .success)
            editingOriginal = nil
            editingQSOID = nil
            draft.resetKeepingStation()
            callContext = ""
            automaticCallFields = AutomaticCallFields()
            lookupStatus = "Ready"
            draft.timestamp = Date()
            reload()
            if settings.automaticSync { Task { await synchronize() } }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
    }

    func edit(_ qso: QSO) {
        editingOriginal = qso
        editingQSOID = qso.id
        draft = QSOFormState(qso: qso)
        callContext = draft.call
        automaticCallFields = AutomaticCallFields()
        lookupStatus = "Ready"
        destination = .log
        refreshCallContext()
        banner = AppBanner(message: "Editing \(qso.call). Save to update the local record.", kind: .info)
    }

    func cancelEditing() {
        editingOriginal = nil
        editingQSOID = nil
        draft.resetKeepingStation()
        callContext = ""
        automaticCallFields = AutomaticCallFields()
        lookupStatus = "Ready"
        draft.timestamp = Date()
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
        defer { isWorking = false }
        do {
            let config = try WavelogConfiguration(baseURL: baseURL, token: wavelogToken, stationID: settings.wavelogStationID)
            let report = try await SyncEngine(database: database, configuration: config).synchronize()
            lastSyncReport = report
            syncStatus = report.conflicts == 0 ? "Up to date" : "Needs review"
            if let updater = try? ReferenceDataUpdater(),
               let catalogState = try? await updater.refreshWavelogCatalog(baseURL: baseURL, token: wavelogToken) {
                referenceState = catalogState
            }
            reload()
            if report.conflicts > 0 {
                banner = AppBanner(message: "\(report.conflicts) sync conflict\(report.conflicts == 1 ? "" : "s") need review.", kind: .warning)
                destination = .sync
            }
        } catch {
            syncStatus = "Sync failed"
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
                banner = AppBanner(message: "LoTW activity updated. Add a Club Log API key to update cty.xml.", kind: .warning)
            } else {
                referenceState = try await updater.refresh(clubLogURL: club, clubLogAPIKey: clubLogAPIKey, lotwURL: lotw)
                loadDownloadedCTY()
                banner = AppBanner(message: "Reference data updated", kind: .success)
            }
        } catch { banner = AppBanner(message: error.localizedDescription, kind: .error) }
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

    private func refreshCallContext() {
        guard let database, !draft.call.isEmpty else { previous = []; matrix = []; return }
        previous = (try? database.previous(call: draft.call)) ?? []
        matrix = (try? database.bandModeMatrix(call: draft.call)) ?? []
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
            }
            lookupStatus = "QRZ matched"
        } catch {
            lookupStatus = "QRZ unavailable"
        }
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
        do {
            let port = UInt16(clamping: settings.xcatRigCtlPort)
            let snapshot = try await XCatClient(host: settings.xcatHost, port: port).snapshot()
            radioSnapshot = snapshot
            radioStatus = "xCat live"
            if deskBandMapFollowsRadio {
                let band = BandPlan.band(for: snapshot.frequencyHz)
                if !band.isEmpty, bandMapBands != [band] {
                    bandMapBands = [band]
                    saveBandMaps()
                }
            }
            if copyToDraft {
                draft.frequency = snapshot.displayFrequency
                draft.band = BandPlan.band(for: snapshot.frequencyHz)
                draft.mode = snapshot.mode
                draft.rstSent = snapshot.mode == "CW" ? "599" : "59"
                draft.rstReceived = draft.rstSent
            }
        } catch {
            radioSnapshot = nil
            radioStatus = "xCat offline"
        }
    }

    private func configureTimers() {
        radioTimer?.invalidate()
        radioTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in
            Task { @MainActor in await self?.pollRadio() }
        }
        clusterFeedTimer?.invalidate()
        loadClusterFeed()
        clusterFeedTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.loadClusterFeed() }
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

    private func loadClusterFeed() {
        guard let snapshot = try? ClusterSpotFeed.read() else {
            clusterSpots = []; clusterConnectedCount = 0; clusterFeedUpdatedAt = nil
            return
        }
        clusterSpots = snapshot.spots
        clusterConnectedCount = snapshot.connectedClusters
        clusterFeedUpdatedAt = snapshot.generatedAt
    }

    private func saveBandMaps() {
        UserDefaults.standard.set(bandMapBands, forKey: "OM0RX-xLog.deskBandMapBands")
        UserDefaults.standard.set(detachedBandMapBands, forKey: "OM0RX-xLog.detachedBandMapBands")
        UserDefaults.standard.set(deskBandMapFollowsRadio, forKey: "OM0RX-xLog.deskBandMapFollowsRadio")
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
