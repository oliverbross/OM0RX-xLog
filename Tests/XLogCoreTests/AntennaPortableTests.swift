import Foundation
import Testing
@testable import XLogCore

@Suite("Antenna and portable immutable context")
struct AntennaPortableTests {
    @Test func deterministicMigrationAndRestore() throws {
        let raw = Data(#"{"display":"antenna","antenna":"wire","name":"Garden","bands":["20m"]}"#.utf8)
        let first = try JSONDecoder().decode(StationEquipment.self, from: raw)
        let restored = try JSONDecoder().decode(StationEquipment.self, from: JSONEncoder().encode(first))
        #expect(first == restored); #expect(first.profiles.count == 1)
        #expect(first.selectedProfileID == "legacy-antenna"); #expect(!first.automaticSelection)
    }
    @Test func bandSelectionNeverPicksArbitraryOrStale() {
        var equipment = StationEquipment()
        equipment.profiles = [AntennaProfile(id: "a", name: "A", bands: ["20m"]), AntennaProfile(id: "b", name: "B", bands: ["20m"])]
        equipment.selectedProfileID = "a"; equipment.automaticSelection = true
        #expect(equipment.profileChoice(transmitBand: "20m", fresh: true) == .choice(["a", "b"]))
        equipment.bandPreferences["20m"] = "b"
        #expect(equipment.profileChoice(transmitBand: "20m", fresh: true) == .selected(equipment.profiles[1]))
        #expect(equipment.profileChoice(transmitBand: "20m", fresh: false) == .selected(equipment.profiles[0]))
        #expect(equipment.profileChoice(transmitBand: "20m", fresh: true, manualOverride: true) == .selected(equipment.profiles[0]))
    }
    @Test func offsetIsInverseAndSnapshotsDoNotTrackEdits() {
        var antenna = AntennaProfile(id: "a", name: "Beam", azimuthOffsetDegrees: 20)
        #expect(antenna.antennaHeading(observedRotorHeading: 350) == 10)
        #expect(antenna.rotorTarget(antennaBearing: 10) == 350)
        antenna.azimuthOffsetDegrees = -20
        #expect(antenna.antennaHeading(observedRotorHeading: 10) == 350)
        #expect(antenna.rotorTarget(antennaBearing: 350) == 10)
        let original = antenna.applying(to: QSO(call: "K1ABC", band: "20m", mode: "CW", antennaPath: "L"))
        antenna.name = "Later"; antenna.archived = true
        #expect(original.extraFields["APP_OM0RXXLOG_ANTENNA_NAME"] == "Beam")
        #expect(original.adifRecord["ANT_PATH"] == "L")
        #expect(QSO(adif: original.adifRecord)?.extraFields["APP_OM0RXXLOG_ANTENNA_NAME"] == "Beam")
    }
    @Test func portableHomeSeparationAndSnapshotRoundtrip() throws {
        var settings = XLogSettings.defaults
        settings.stationCall = "OM0RX"; settings.gridSquare = "JN98"
        let preset = PortablePreset(name: "Park", stationCall: "VK8RX/P", operatorCall: "VK8RX", locator: "PH57", state: "NT", ownReferences: ["POTA": ["AU-0001", "AU-0002"]], power: "10")
        settings.portableOperating.presets = [preset]
        settings.portableOperating.activeContext = PortableActiveContext(preset: preset)
        try IntegrationSettingsSnapshot(revision: 0, settings: settings).validate()
        let draft = settings.applyingOperatingDefaults(to: QSO(call: "", band: "20m", mode: "CW"))
        settings.portableOperating.activeContext = nil
        #expect(settings.stationCall == "OM0RX"); #expect(settings.gridSquare == "JN98")
        #expect(draft.myCall == "VK8RX/P"); #expect(draft.myGrid == "PH57")
        #expect(draft.extraFields["MY_SIG_INFO"] == "AU-0001,AU-0002")
        let restored = try JSONDecoder().decode(XLogSettings.self, from: JSONEncoder().encode(settings))
        #expect(restored.portableOperating.presets == [preset]); #expect(restored.portableOperating.activeContext == nil)
    }
}
