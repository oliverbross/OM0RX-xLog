import Foundation
import Testing
@testable import XLogCore

@Suite("Station equipment preferences")
struct StationEquipmentTests {
    @Test("Old settings default to automatic equipment without changing identity or mode")
    func migration() throws {
        var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(XLogSettings.defaults)) as? [String: Any])
        object.removeValue(forKey: "stationEquipment")
        let settings = try JSONDecoder().decode(XLogSettings.self, from: JSONSerialization.data(withJSONObject: object))
        #expect(settings.stationEquipment == StationEquipment())
        #expect(settings.stationCall == XLogSettings.defaults.stationCall)
        #expect(settings.logbookMode == .local)
    }

    @Test("Antenna profile survives a settings round trip")
    func roundTrip() throws {
        var settings = XLogSettings.defaults
        settings.stationEquipment.display = .antenna
        settings.stationEquipment.antenna = .wire
        settings.stationEquipment.name = "Garden wire"
        settings.stationEquipment.bands = ["20m", "17m", "15m", "12m", "10m"]
        let restored = try JSONDecoder().decode(XLogSettings.self, from: JSONEncoder().encode(settings))
        #expect(restored == settings)
    }
}
