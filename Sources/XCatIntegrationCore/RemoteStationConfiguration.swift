// Copyright © 2026 Oliver Bross OM0RX
// SPDX-License-Identifier: GPL-3.0-only

import Foundation

public struct RemoteStationConfiguration: Codable, Equatable, Sendable {
    public static let bands = ["160m", "80m", "60m", "40m", "30m", "20m", "17m", "15m", "12m", "10m", "6m"]

    public var schemaVersion: Int
    public var flex: RemoteFlexConfiguration
    public var kpa500: RemoteSerialDeviceConfiguration
    public var kat500: RemoteSerialDeviceConfiguration
    public var commissioned: Bool
    public var policy: RemoteStationPolicy

    enum CodingKeys: String, CodingKey {
        case schemaVersion = "schema_version"
        case flex, kpa500, kat500, commissioned, policy
    }

    public static let placeholder = Self(
        schemaVersion: 1,
        flex: RemoteFlexConfiguration(model: "FLEX-8400", host: "", port: 4_992, sliceID: 0, stationName: "Maestro"),
        kpa500: RemoteSerialDeviceConfiguration(enabled: true, port: "COM17", baudrate: 38_400),
        kat500: RemoteSerialDeviceConfiguration(enabled: true, port: "COM15", baudrate: 38_400),
        commissioned: false,
        policy: RemoteStationPolicy.placeholder
    )
}

public struct RemoteFlexConfiguration: Codable, Equatable, Sendable {
    public var model: String
    public var host: String
    public var port: Int
    public var sliceID: Int
    public var stationName: String

    enum CodingKeys: String, CodingKey {
        case model, host, port
        case sliceID = "slice_id"
        case stationName = "station_name"
    }
}

public struct RemoteSerialDeviceConfiguration: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var port: String
    public var baudrate: Int
}

public struct RemoteFlexAntennaPolicy: Codable, Equatable, Sendable {
    public var enabled: Bool
    public var bands: [String: String]
}

public struct RemoteStationPolicy: Codable, Equatable, Sendable {
    public var followRadio: Bool
    public var digitalKPAPolicy: String
    public var flexAntenna: RemoteFlexAntennaPolicy
    public var katAntenna: [String: Int]
    public var katAntennaNames: [String: String]
    public var amplifierAllowedBands: [String]
    public var amplifierDriveW: [String: Int]
    public var barefootDriveW: [String: Int]
    public var digitalAmplifierAllowedBands: [String]
    public var digitalAmplifierDriveW: [String: Int]
    public var tunePowerW: Int
    public var tuneTargetSWR: Double
    public var tuneAbortSWR: Double
    public var tuneTimeoutSeconds: Double

    enum CodingKeys: String, CodingKey {
        case followRadio = "follow_radio"
        case digitalKPAPolicy = "digital_kpa_policy"
        case flexAntenna = "flex_antenna"
        case katAntenna = "kat_antenna"
        case katAntennaNames = "kat_antenna_names"
        case amplifierAllowedBands = "amplifier_allowed_bands"
        case amplifierDriveW = "amplifier_drive_w"
        case barefootDriveW = "barefoot_drive_w"
        case digitalAmplifierAllowedBands = "digital_amplifier_allowed_bands"
        case digitalAmplifierDriveW = "digital_amplifier_drive_w"
        case tunePowerW = "tune_power_w"
        case tuneTargetSWR = "tune_target_swr"
        case tuneAbortSWR = "tune_abort_swr"
        case tuneTimeoutSeconds = "tune_timeout_seconds"
    }

    static let placeholder = Self(
        followRadio: true,
        digitalKPAPolicy: "operate",
        flexAntenna: RemoteFlexAntennaPolicy(
            enabled: true,
            bands: Dictionary(uniqueKeysWithValues: RemoteStationConfiguration.bands.map { ($0, "ANT1") })
        ),
        katAntenna: Dictionary(uniqueKeysWithValues: RemoteStationConfiguration.bands.map { ($0, 1) }),
        katAntennaNames: ["1": "KAT ANT1", "2": "KAT ANT2", "3": "KAT ANT3"],
        amplifierAllowedBands: [],
        amplifierDriveW: Dictionary(uniqueKeysWithValues: RemoteStationConfiguration.bands.map { ($0, 25) }),
        barefootDriveW: Dictionary(uniqueKeysWithValues: RemoteStationConfiguration.bands.map { ($0, 25) }),
        digitalAmplifierAllowedBands: [],
        digitalAmplifierDriveW: Dictionary(uniqueKeysWithValues: RemoteStationConfiguration.bands.map { ($0, 25) }),
        tunePowerW: 25,
        tuneTargetSWR: 1.5,
        tuneAbortSWR: 3.0,
        tuneTimeoutSeconds: 30
    )
}

struct RemoteConfigResponse: Decodable {
    let success: Bool
    let config: RemoteStationConfiguration
    let restartRequired: Bool?

    enum CodingKeys: String, CodingKey {
        case success, config
        case restartRequired = "restart_required"
    }
}

struct RemoteConfigUpdateRequest: Encodable {
    let config: RemoteStationConfiguration
}
