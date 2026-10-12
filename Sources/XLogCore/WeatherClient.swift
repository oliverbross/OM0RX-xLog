import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct StationWeather: Equatable, Sendable {
    public var temperatureC: Double
    public var apparentTemperatureC: Double
    public var weatherCode: Int
    public var windSpeedKMH: Double
    public var windDirectionDegrees: Double
    public var precipitationMM: Double
    public var pressureHPa: Double
    public var cloudCoverPercent: Double
    public var observedAt: Date
    public var fetchedAt: Date

    public var condition: WeatherCondition { WeatherCondition(code: weatherCode) }
}

public struct WeatherCondition: Equatable, Sendable {
    public let code: Int

    public var description: String {
        switch code {
        case 0: return "Clear"
        case 1: return "Mostly clear"
        case 2: return "Partly cloudy"
        case 3: return "Overcast"
        case 45, 48: return "Fog"
        case 51, 53, 55, 56, 57: return "Drizzle"
        case 61, 63, 65, 66, 67: return "Rain"
        case 71, 73, 75, 77: return "Snow"
        case 80, 81, 82: return "Showers"
        case 85, 86: return "Snow showers"
        case 95, 96, 99: return "Thunderstorm"
        default: return "Conditions"
        }
    }

    public var symbolName: String {
        switch code {
        case 0: return "sun.max.fill"
        case 1, 2: return "cloud.sun.fill"
        case 3: return "cloud.fill"
        case 45, 48: return "cloud.fog.fill"
        case 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82: return "cloud.rain.fill"
        case 71, 73, 75, 77, 85, 86: return "cloud.snow.fill"
        case 95, 96, 99: return "cloud.bolt.rain.fill"
        default: return "cloud.fill"
        }
    }
}

public enum WeatherClient {
    public static func url(latitude: Double, longitude: Double) -> URL? {
        var components = URLComponents(string: "https://api.open-meteo.com/v1/forecast")
        components?.queryItems = [
            URLQueryItem(name: "latitude", value: String(format: "%.5f", latitude)),
            URLQueryItem(name: "longitude", value: String(format: "%.5f", longitude)),
            URLQueryItem(name: "current", value: "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,wind_direction_10m,precipitation,pressure_msl,cloud_cover"),
            URLQueryItem(name: "timezone", value: "UTC"),
        ]
        return components?.url
    }

    public static func fetch(latitude: Double, longitude: Double, session: URLSession = .shared) async throws -> StationWeather {
        guard let target = url(latitude: latitude, longitude: longitude) else { throw URLError(.badURL) }
        var request = URLRequest(url: target)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadRevalidatingCacheData
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw URLError(.badServerResponse)
        }
        return try decode(data, fetchedAt: Date())
    }

    public static func decode(_ data: Data, fetchedAt: Date = Date()) throws -> StationWeather {
        let response = try JSONDecoder().decode(OpenMeteoResponse.self, from: data)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let observedAt = formatter.date(from: response.current.time)
            ?? ISO8601DateFormatter().date(from: response.current.time + ":00Z")
            ?? fetchedAt
        return StationWeather(
            temperatureC: response.current.temperature,
            apparentTemperatureC: response.current.apparentTemperature,
            weatherCode: response.current.weatherCode,
            windSpeedKMH: response.current.windSpeed,
            windDirectionDegrees: response.current.windDirection,
            precipitationMM: response.current.precipitation,
            pressureHPa: response.current.pressure,
            cloudCoverPercent: response.current.cloudCover,
            observedAt: observedAt,
            fetchedAt: fetchedAt
        )
    }
}

private struct OpenMeteoResponse: Decodable {
    struct Current: Decodable {
        let time: String
        let temperature: Double
        let apparentTemperature: Double
        let weatherCode: Int
        let windSpeed: Double
        let windDirection: Double
        let precipitation: Double
        let pressure: Double
        let cloudCover: Double

        enum CodingKeys: String, CodingKey {
            case time
            case temperature = "temperature_2m"
            case apparentTemperature = "apparent_temperature"
            case weatherCode = "weather_code"
            case windSpeed = "wind_speed_10m"
            case windDirection = "wind_direction_10m"
            case precipitation
            case pressure = "pressure_msl"
            case cloudCover = "cloud_cover"
        }
    }

    let current: Current
}
