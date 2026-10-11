import Foundation
import Testing
@testable import XLogCore

@Suite("Operator intelligence")
struct OperatorIntelligenceTests {
    @Test("Award progress uses the full database and separates worked from confirmed")
    func awardProgress() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let database = try LogbookDatabase(url: directory.appendingPathComponent("awards.sqlite"))

        try database.save(QSO(
            call: "W1AW", start: Date(timeIntervalSince1970: 1_700_000_000), band: "20m", mode: "SSB",
            gridSquare: "FN31PR", country: "United States", dxcc: 291, continent: "NA", cqZone: "5", state: "CT",
            lotwReceived: "Y"
        ))
        try database.save(QSO(
            call: "VK4JAZ", start: Date(timeIntervalSince1970: 1_710_000_000), band: "40m", mode: "CW",
            gridSquare: "QG62MM", country: "Australia", dxcc: 150, continent: "OC", cqZone: "30"
        ))
        try database.save(QSO(
            call: "OM0RX", start: Date(timeIntervalSince1970: 1_720_000_000), band: "20m", mode: "DATA", submode: "FT8",
            gridSquare: "JN88UQ", country: "Slovak Republic", dxcc: 504, continent: "EU", cqZone: "15", qslReceived: "V"
        ))
        try database.save(QSO(
            call: "KL7TEST", start: Date(timeIntervalSince1970: 1_730_000_000), band: "15m", mode: "SSB",
            gridSquare: "BP51AA", country: "Alaska", dxcc: 6, continent: "NA", cqZone: "1", state: "AK"
        ))

        let progress = try database.awardProgress()
        #expect(progress.qsoCount == 4)
        #expect(progress.confirmedQSOs == 2)
        #expect(progress.dxccWorked == 4)
        #expect(progress.dxccConfirmed == 2)
        #expect(progress.cqZonesWorked == 4)
        #expect(progress.statesWorked == 2)
        #expect(progress.statesConfirmed == 1)
        #expect(progress.gridsWorked == 4)
        #expect(progress.bandCounts["20m"] == 2)
        #expect(progress.modeCounts["CW"] == 1)
        #expect(progress.modeCounts["Phone"] == 2)
        #expect(progress.modeCounts["Digital"] == 1)
        #expect(progress.continentCounts["EU"] == 1)
    }

    @Test("Weather decoder maps current Open-Meteo conditions")
    func weatherDecode() throws {
        let data = Data("""
        {"current":{"time":"2026-10-12T04:15","temperature_2m":31.4,"apparent_temperature":34.1,"weather_code":2,"wind_speed_10m":18.5,"wind_direction_10m":95,"precipitation":0.2,"pressure_msl":1007.8,"cloud_cover":43}}
        """.utf8)
        let fetched = Date(timeIntervalSince1970: 1_800_000_000)
        let weather = try WeatherClient.decode(data, fetchedAt: fetched)
        #expect(weather.temperatureC == 31.4)
        #expect(weather.condition.description == "Partly cloudy")
        #expect(weather.condition.symbolName == "cloud.sun.fill")
        #expect(weather.windDirectionDegrees == 95)
        #expect(weather.fetchedAt == fetched)
        let url = try #require(WeatherClient.url(latitude: -12.46, longitude: 130.84))
        #expect(url.host == "api.open-meteo.com")
        #expect(url.query?.contains("weather_code") == true)
    }

    @Test("Cluster spots expose compact xCluster opportunity codes")
    func clusterOpportunityCodes() {
        #expect(spot(call: "New Call", dxcc: "Worked").opportunityCode == "NC")
        #expect(spot(call: "New Band", dxcc: "C/New Band").opportunityCode == "NB")
        #expect(spot(call: "New Mode", dxcc: "Confirmed").opportunityCode == "NM")
        #expect(spot(call: "New Band+Mode", dxcc: "Confirmed").opportunityCode == "NB+NM")
        #expect(spot(call: "Worked", dxcc: "ATNO").opportunityCode == "ATNO")
        #expect(spot(call: "Confirmed", dxcc: "Confirmed").opportunityCode == "C")
        #expect(spot(call: "Worked", dxcc: "Worked").opportunityCode == "W")
        #expect(spot(call: "Unknown", dxcc: "Unknown").opportunityCode == "--")
    }

    private func spot(call: String, dxcc: String) -> ClusterSpot {
        ClusterSpot(
            id: UUID(), receivedAt: .now, callsign: "OM0RX", frequencyKHz: 14_195,
            band: "20m", mode: "CW", country: "Slovak Republic", continent: "EU",
            latitude: nil, longitude: nil, comment: "test", callStatus: call,
            dxccStatus: dxcc, specialTags: [], score: 1, source: "test",
            statusHex: "#64D2FF", bandHex: "#64D2FF", modeHex: "#64D2FF"
        )
    }
}
