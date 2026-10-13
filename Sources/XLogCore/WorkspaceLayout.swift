import Foundation

/// Stable identities are shared by portable layouts, canvas widgets and native
/// windows. Geometry is in logical points, never physical monitor pixels.
public enum WorkspacePanelID: String, Codable, CaseIterable, Sendable {
    case activeQSO = "active-qso", logQSO = "log-qso", logbook
    case intelligence = "callsign-intelligence", rotor, antenna
    case worldMap = "world-map", bandMaps = "band-maps", cluster = "dx-cluster"
    case stationControl = "station-control", stationStatus = "station-status"
    case stationIdentity = "station-identity", cw, alerts, propagation
    case settings, sync, awards, chaser = "chaser-dx"
    case spotHistory = "spot-history", monitor

    fileprivate static let version1Cases: [Self] = [.activeQSO, .logQSO, .logbook, .intelligence, .rotor, .antenna,
        .worldMap, .bandMaps, .cluster, .stationControl, .stationStatus, .stationIdentity, .cw, .alerts,
        .propagation, .settings, .sync, .awards, .chaser]

    public var minimumSize: (width: Double, height: Double) {
        switch self {
        case .activeQSO: return (520, 240)
        case .intelligence: return (360, 240)
        case .rotor, .antenna: return (240, 240)
        case .worldMap, .bandMaps, .cluster: return (280, 200)
        case .stationStatus, .stationIdentity, .propagation, .cw, .alerts: return (240, 80)
        default: return (640, 480)
        }
    }
}

public enum WorkspacePlacement: String, Codable, Sendable { case canvas, window, hidden }
public struct WorkspaceRect: Codable, Equatable, Sendable {
    public var x: Double, y: Double, width: Double, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) {
        self.x = x; self.y = y; self.width = width; self.height = height
    }
}
public struct WorkspacePanelLayout: Codable, Equatable, Sendable {
    public var id: WorkspacePanelID
    public var placement: WorkspacePlacement
    public var rect: WorkspaceRect
    public var z: Int
    public init(id: WorkspacePanelID, placement: WorkspacePlacement, rect: WorkspaceRect, z: Int) {
        self.id = id; self.placement = placement; self.rect = rect; self.z = z
    }
}
public struct WorkspaceLayoutPreset: Codable, Equatable, Sendable {
    public var id: String, name: String
    public var width: Double, height: Double
    public var locked: Bool, snap: Bool
    public var panels: [WorkspacePanelLayout]
    public init(id: String, name: String, width: Double, height: Double,
                locked: Bool, snap: Bool, panels: [WorkspacePanelLayout]) {
        self.id = id; self.name = name; self.width = width; self.height = height
        self.locked = locked; self.snap = snap; self.panels = panels
    }
    public func validate() throws {
        try validate(panelIDs: WorkspacePanelID.allCases)
    }
    fileprivate func validate(panelIDs: [WorkspacePanelID]) throws {
        guard !id.isEmpty, id.utf8.count <= 64,
              id.utf8.allSatisfy({ (97...122).contains($0) || (48...57).contains($0) || $0 == 45 }),
              !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              name.utf8.count <= 100, !name.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains),
              width.isFinite, height.isFinite, (640...16_384).contains(width), (480...16_384).contains(height),
              panels.count == panelIDs.count,
              Set(panels.map(\.id)) == Set(panelIDs) else { throw WorkspaceLayoutError.invalid }
        for panel in panels {
            let rect = panel.rect, minimum = panel.id.minimumSize
            guard [rect.x, rect.y, rect.width, rect.height].allSatisfy(\.isFinite),
                  (0...16_384).contains(rect.x), (0...16_384).contains(rect.y),
                  (minimum.width...16_384).contains(rect.width), (minimum.height...16_384).contains(rect.height),
                  (0...10_000).contains(panel.z),
                  panel.placement != .canvas || rect.x + rect.width <= width && rect.y + rect.height <= height
            else { throw WorkspaceLayoutError.invalid }
        }
    }
}
public struct WorkspaceLayoutDocument: Codable, Equatable, Sendable {
    public static let currentVersion = 2
    public var version: Int
    public var activePresetID: String
    public var presets: [WorkspaceLayoutPreset]
    public func validate() throws {
        guard version == Self.currentVersion else { throw WorkspaceLayoutError.invalid }
        try validate(panelIDs: WorkspacePanelID.allCases)
    }
    private func validate(panelIDs: [WorkspacePanelID]) throws {
        guard (1...12).contains(presets.count),
              Set(presets.map(\.id)).count == presets.count,
              presets.contains(where: { $0.id == activePresetID }) else { throw WorkspaceLayoutError.invalid }
        try presets.forEach { try $0.validate(panelIDs: panelIDs) }
    }

    /// Schema upgrades preserve operator revisions and every existing placement.
    /// Old backups remain readable; the next committed edit encodes version 2.
    public func migratedToCurrentVersion() throws -> Self {
        if version == Self.currentVersion { try validate(); return self }
        guard version == 1 else { throw WorkspaceLayoutError.invalid }
        try validate(panelIDs: WorkspacePanelID.version1Cases)
        var result = self
        result.version = Self.currentVersion
        for index in result.presets.indices {
            for (offset, id) in [WorkspacePanelID.spotHistory, .monitor].enumerated() {
                result.presets[index].panels.append(WorkspacePanelLayout(id: id, placement: .hidden,
                    rect: WorkspaceRect(x: 0, y: 0, width: 640, height: 480),
                    z: WorkspacePanelID.version1Cases.count + offset))
            }
        }
        try result.validate()
        return result
    }
    public static var defaults: Self {
        let panels = WorkspacePanelID.allCases.enumerated().map { index, id in
            WorkspacePanelLayout(id: id, placement: .hidden,
                rect: WorkspaceRect(x: 0, y: 0, width: max(640, id.minimumSize.width), height: max(480, id.minimumSize.height)), z: index)
        }
        var docked = WorkspaceLayoutPreset(id: "traditional", name: "Traditional", width: 1920, height: 1080,
                                          locked: true, snap: true, panels: panels)
        for (id, rect) in [(WorkspacePanelID.activeQSO, WorkspaceRect(x: 0, y: 0, width: 1140, height: 300)),
                           (.intelligence, WorkspaceRect(x: 1152, y: 0, width: 768, height: 300)),
                           (.worldMap, WorkspaceRect(x: 0, y: 312, width: 1100, height: 768)),
                           (.bandMaps, WorkspaceRect(x: 1112, y: 312, width: 808, height: 768))] {
            let index = docked.panels.firstIndex { $0.id == id }!
            docked.panels[index].placement = .canvas; docked.panels[index].rect = rect
        }
        var windowed = docked
        windowed.id = "windowed"; windowed.name = "Windowed"
        for index in windowed.panels.indices where windowed.panels[index].placement == .canvas {
            windowed.panels[index].placement = .window
        }
        return Self(version: Self.currentVersion, activePresetID: docked.id, presets: [docked, windowed])
    }
}

extension WorkspaceLayoutDocument {
    public init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        self = try Self(version: values.decode(Int.self, forKey: .version),
                        activePresetID: values.decode(String.self, forKey: .activePresetID),
                        presets: values.decode([WorkspaceLayoutPreset].self, forKey: .presets))
            .migratedToCurrentVersion()
    }
}
public struct WorkspaceLayoutSnapshot: Codable, Equatable, Sendable {
    public let revision: Int64
    public let document: WorkspaceLayoutDocument
    public init(revision: Int64, document: WorkspaceLayoutDocument) {
        self.revision = revision; self.document = document
    }
}
public enum WorkspaceLayoutError: Error { case invalid, conflict(WorkspaceLayoutSnapshot) }

/// Scoped changes never replace unrelated presets. A lost acknowledgement is
/// reconciled by reading the current revision, not by blindly replaying a write.
public struct WorkspaceLayoutMutation: Codable, Equatable, Sendable {
    public enum Action: String, Codable, Sendable { case placePanel, savePreset, deletePreset, activatePreset }
    public var expectedRevision: Int64
    public var action: Action
    public var presetID: String
    public var panel: WorkspacePanelLayout?
    public var preset: WorkspaceLayoutPreset?
    public init(expectedRevision: Int64, action: Action, presetID: String,
                panel: WorkspacePanelLayout? = nil, preset: WorkspaceLayoutPreset? = nil) {
        self.expectedRevision = expectedRevision; self.action = action; self.presetID = presetID
        self.panel = panel; self.preset = preset
    }
    func applying(to snapshot: WorkspaceLayoutSnapshot) throws -> WorkspaceLayoutSnapshot {
        guard (0..<9_007_199_254_740_991).contains(expectedRevision) else { throw WorkspaceLayoutError.invalid }
        guard snapshot.revision == expectedRevision else { throw WorkspaceLayoutError.conflict(snapshot) }
        var document = snapshot.document
        let index = document.presets.firstIndex { $0.id == presetID }
        switch action {
        case .placePanel:
            guard let index, let panel, preset == nil,
                  let item = document.presets[index].panels.firstIndex(where: { $0.id == panel.id }) else { throw WorkspaceLayoutError.invalid }
            document.presets[index].panels[item] = panel
        case .savePreset:
            guard panel == nil, let preset, preset.id == presetID else { throw WorkspaceLayoutError.invalid }
            if let index { document.presets[index] = preset } else { document.presets.append(preset) }
        case .deletePreset:
            guard let index, panel == nil, preset == nil, presetID != document.activePresetID else { throw WorkspaceLayoutError.invalid }
            document.presets.remove(at: index)
        case .activatePreset:
            guard index != nil, panel == nil, preset == nil else { throw WorkspaceLayoutError.invalid }
            document.activePresetID = presetID
        }
        try document.validate()
        return WorkspaceLayoutSnapshot(revision: snapshot.revision + 1, document: document)
    }
}
